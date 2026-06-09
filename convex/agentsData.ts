import { v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { requireEditor } from "./lib/guard"
import type { Id } from "./_generated/dataModel"
import type { QueryCtx } from "./_generated/server"

// `videoEmbedFrom` + extractor helpers + `insertDraft` mutation were
// removed with the article-era purge. Event ingest doesn't go through
// this file (see convex/events.ts:insertExtracted) and articles no
// longer ship from the desk.

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireEditor(ctx)
    const agents = await ctx.db.query("agents").collect()
    return await Promise.all(
      agents.map(async (a) => {
        const [section, author] = await Promise.all([
          ctx.db.get(a.sectionId),
          ctx.db.get(a.authorId),
        ])
        return { ...a, section, author }
      }),
    )
  },
})

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique()
    if (!agent) return null
    const [section, author] = await Promise.all([
      ctx.db.get(agent.sectionId),
      ctx.db.get(agent.authorId),
    ])
    return { ...agent, section, author }
  },
})

/**
 * Sections this desk can file events under: its primary section + every
 * direct child. Used by the desk action to constrain the LLM's section
 * choice — Arts desk picks from {arts, music, film, ...} but never
 * lands an event under Sports.
 */
export const allowedSectionsForAgent = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const agent = await ctx.db.get(agentId)
    if (!agent) return []
    const primary = await ctx.db.get(agent.sectionId)
    if (!primary) return []
    const children = await ctx.db
      .query("sections")
      .withIndex("by_parent", (q) => q.eq("parentId", agent.sectionId))
      .collect()
    return [primary, ...children].map((s) => ({
      _id: s._id,
      slug: s.slug,
      name: s.name,
      description: s.description,
    }))
  },
})

export const updatePrompt = mutation({
  args: {
    agentId: v.id("agents"),
    systemPrompt: v.optional(v.string()),
    model: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
    maxItemsPerRun: v.optional(v.number()),
    maxDraftsPerRun: v.optional(v.number()),
    lookbackHours: v.optional(v.number()),
  },
  handler: async (ctx, { agentId, ...patch }) => {
    await requireEditor(ctx)
    const cleaned: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) cleaned[key] = value
    }
    if (Object.keys(cleaned).length > 0) await ctx.db.patch(agentId, cleaned)
  },
})

// ---------- run lifecycle ----------

export const startRun = mutation({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const id = await ctx.db.insert("agentRuns", {
      agentId,
      startedAt: Date.now(),
      status: "running",
      log: [],
      itemsConsidered: 0,
      draftsCreated: 0,
    })
    await ctx.db.patch(agentId, { lastRunAt: Date.now() })
    return id
  },
})

export const appendLog = mutation({
  args: { runId: v.id("agentRuns"), line: v.string() },
  handler: async (ctx, { runId, line }) => {
    const run = await ctx.db.get(runId)
    if (!run) return
    await ctx.db.patch(runId, {
      log: [...run.log, `[${new Date().toISOString()}] ${line}`],
    })
  },
})

export const finishRun = mutation({
  args: {
    runId: v.id("agentRuns"),
    status: v.union(
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    itemsConsidered: v.number(),
    draftsCreated: v.number(),
    errorMessage: v.optional(v.string()),
    /** Why this run was skipped (e.g. "budget-cap"). */
    skippedReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      status: args.status,
      finishedAt: Date.now(),
      itemsConsidered: args.itemsConsidered,
      draftsCreated: args.draftsCreated,
      errorMessage: args.errorMessage,
      skippedReason: args.skippedReason,
    })
  },
})

// ---------- ingestion + selection ----------

// Expand an agent's section to the set of section IDs it "owns" — the
// agent's primary section plus every direct child. Lets a desk like the
// Science desk pull sources tagged Science, Climate, OR Nature without
// having to add `science` to every existing source.
async function sectionTreeFor(
  ctx: QueryCtx,
  sectionId: Id<"sections">,
): Promise<Set<string>> {
  const owned = new Set<string>([sectionId])
  const children = await ctx.db
    .query("sections")
    .withIndex("by_parent", (q) => q.eq("parentId", sectionId))
    .collect()
  for (const c of children) owned.add(c._id)
  return owned
}

export const enabledSourcesForAgent = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const agent = await ctx.db.get(agentId)
    if (!agent) return []
    const owned = await sectionTreeFor(ctx, agent.sectionId)
    const all = await ctx.db
      .query("sources")
      .withIndex("by_enabled", (q) => q.eq("enabled", true))
      .collect()
    return all
      .filter((s) =>
        (s.sectionIds ?? []).some(
          (sectionId) => owned.has(sectionId),
        ),
      )
      .map((s) => ({
        _id: s._id,
        type: s.type,
        url: s.url,
        config: s.config,
        name: s.name,
      }))
  },
})

export const unconsumedItemsForAgent = query({
  args: {
    agentId: v.id("agents"),
    sinceMs: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, { agentId, sinceMs, limit }) => {
    const agent = await ctx.db.get(agentId)
    if (!agent) return []
    const owned = await sectionTreeFor(ctx, agent.sectionId)
    const sourcesForSection = await ctx.db.query("sources").collect()
    const ourSourceIds = new Set(
      sourcesForSection
        .filter((s) =>
          (s.sectionIds ?? []).some(
            (sectionId) => owned.has(sectionId),
          ),
        )
        .map((s) => s._id),
    )
    const items = await ctx.db
      .query("ingestedItems")
      .withIndex("by_consumed_fetched", (q) => q.eq("consumed", false))
      .order("desc")
      .take(limit * 4)
    const filtered = items.filter(
      (i) => ourSourceIds.has(i.sourceId) && i.fetchedAt >= sinceMs,
    )
    // Hydrate with source name for prompt
    const withSource = await Promise.all(
      filtered.slice(0, limit).map(async (i) => {
        const src = await ctx.db.get(i.sourceId)
        return { item: i, sourceName: src?.name ?? "(unknown)" }
      }),
    )
    return withSource
  },
})

// Mega-desk variant — pull every unconsumed item across every enabled
// source, irrespective of section. The mega-desk decides routing
// itself in the LLM call, so this query just supplies the firehose
// (capped at `limit`).
//
// The index orders by `fetchedAt` desc (which is when WE fetched the
// source), but we re-sort by `publishedAt` desc in memory before
// slicing — the system should prefer items the original outlet
// published most recently, not items WE happened to fetch most
// recently. The over-fetch (limit * 4) gives the re-sort enough
// material to surface fresh items even when a source dumps an old
// batch on its first fetch.
export const unconsumedItemsAll = query({
  args: {
    sinceMs: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, { sinceMs, limit }) => {
    const enabledSourceIds = new Set(
      (await ctx.db.query("sources").collect())
        .filter((s) => s.enabled)
        .map((s) => s._id),
    )
    // Pull a wider window than the cap so the per-source cap below
    // has room to round-robin across sources before hitting `limit`.
    const items = await ctx.db
      .query("ingestedItems")
      .withIndex("by_consumed_fetched", (q) => q.eq("consumed", false))
      .order("desc")
      .take(limit * 10)
    const filtered = items
      .filter((i) => enabledSourceIds.has(i.sourceId) && i.fetchedAt >= sinceMs)
      .sort(
        (a, b) =>
          (b.publishedAt ?? b.fetchedAt) - (a.publishedAt ?? a.fetchedAt),
      )
    // Per-source cap: round-robin balance so MNT's 400+ items don't
    // shut out smaller hyperlocal feeds. Was 5 (Opus-era); 40 fits
    // the LLM-free pipeline + a 200-item batch (≈5 sources at full
    // depth, or 10 sources tapering).
    const PER_SOURCE_CAP = 40
    const perSource = new Map<string, number>()
    const balanced: typeof filtered = []
    for (const item of filtered) {
      if (balanced.length >= limit) break
      const key = item.sourceId as unknown as string
      const taken = perSource.get(key) ?? 0
      if (taken >= PER_SOURCE_CAP) continue
      perSource.set(key, taken + 1)
      balanced.push(item)
    }
    // If we ran short of `limit` due to the cap, fill the rest from
    // whichever items remain (LLM still wants a full batch when the
    // pool is small).
    if (balanced.length < limit) {
      const taken = new Set(balanced.map((i) => i._id))
      for (const item of filtered) {
        if (balanced.length >= limit) break
        if (taken.has(item._id)) continue
        balanced.push(item)
      }
    }
    return await Promise.all(
      balanced.slice(0, limit).map(async (i) => {
        const src = await ctx.db.get(i.sourceId)
        return { item: i, sourceName: src?.name ?? "(unknown)" }
      }),
    )
  },
})

export const markItemsConsumed = mutation({
  args: { itemIds: v.array(v.id("ingestedItems")) },
  handler: async (ctx, { itemIds }) => {
    for (const id of itemIds) {
      await ctx.db.patch(id, { consumed: true })
    }
  },
})

