import { v } from "convex/values"

import {
  internalMutation,
  mutation,
  query,
} from "./_generated/server"
import { requireEditor } from "./lib/guard"
import type { Doc } from "./_generated/dataModel"
import type { QueryCtx } from "./_generated/server"

const kindValidator = v.union(
  v.literal("general"),
  v.literal("meeting"),
  v.literal("notice"),
  v.literal("holiday"),
  v.literal("deal"),
)

// Hard ceiling on candidate scans for time-windowed queries — bounds query
// work even if the volume balloons.
const SCAN_CAP = 500

const eventInputValidator = v.object({
  title: v.string(),
  description: v.string(),
  startsAt: v.number(),
  endsAt: v.optional(v.number()),
  allDay: v.boolean(),
  kind: v.optional(kindValidator),
  locationName: v.optional(v.string()),
  locationAddress: v.optional(v.string()),
  neighborhood: v.optional(v.string()),
  url: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  price: v.optional(v.string()),
  sectionId: v.optional(v.id("sections")),
  articleId: v.optional(v.id("articles")),
})

async function hydrate(ctx: QueryCtx, event: Doc<"events">) {
  const section = event.sectionId ? await ctx.db.get(event.sectionId) : null
  const article = event.articleId ? await ctx.db.get(event.articleId) : null
  // Only surface published linked articles publicly so unpublished drafts
  // can't leak through the events feed.
  const publishedArticle =
    article && article.status === "published"
      ? { _id: article._id, slug: article.slug, title: article.title }
      : null
  return { ...event, section, article: publishedArticle }
}

// ───────── Public queries ─────────

/**
 * Approved events between [startsAt, endsAt). Used by the public /events page
 * for month-grid + list views. Optional `kind` filter narrows to one type.
 */
export const inRange = query({
  args: {
    rangeStart: v.number(),
    rangeEnd: v.number(),
    kind: v.optional(kindValidator),
  },
  handler: async (ctx, { rangeStart, rangeEnd, kind }) => {
    const events = await ctx.db
      .query("events")
      .withIndex("by_status_starts", (q) =>
        q
          .eq("status", "approved")
          .gte("startsAt", rangeStart)
          .lt("startsAt", rangeEnd),
      )
      .order("asc")
      .take(SCAN_CAP)
    const filtered = kind
      ? events.filter((e) => (e.kind ?? "general") === kind)
      : events
    return await Promise.all(filtered.map((e) => hydrate(ctx, e)))
  },
})

/**
 * Approved upcoming events. Used by the homepage right column + event
 * widget previews. Default lookahead 14 days, cap 10 results.
 */
export const upcoming = query({
  args: {
    limit: v.optional(v.number()),
    days: v.optional(v.number()),
  },
  handler: async (ctx, { limit, days }) => {
    const now = Date.now()
    const horizon = now + (days ?? 14) * 24 * 3_600_000
    const events = await ctx.db
      .query("events")
      .withIndex("by_status_starts", (q) =>
        q.eq("status", "approved").gte("startsAt", now).lt("startsAt", horizon),
      )
      .order("asc")
      .take(limit ?? 10)
    return await Promise.all(events.map((e) => hydrate(ctx, e)))
  },
})

export const get = query({
  args: { id: v.id("events") },
  handler: async (ctx, { id }) => {
    const event = await ctx.db.get(id)
    if (!event || event.status !== "approved") return null
    return await hydrate(ctx, event)
  },
})

// ───────── Editorial / admin ─────────

export const reviewQueue = query({
  args: {},
  handler: async (ctx) => {
    await requireEditor(ctx)
    const events = await ctx.db
      .query("events")
      .withIndex("by_status_starts", (q) => q.eq("status", "pending_review"))
      .order("asc")
      .collect()
    return await Promise.all(events.map((e) => hydrate(ctx, e)))
  },
})

/**
 * All events (any status) starting after a cutoff. Powers the admin events
 * table — combines approved + pending so editors see the full picture.
 * Past events older than `pastDays` are excluded to keep the table tight.
 */
export const adminList = query({
  args: { pastDays: v.optional(v.number()) },
  handler: async (ctx, { pastDays }) => {
    await requireEditor(ctx)
    const since = Date.now() - (pastDays ?? 7) * 24 * 3_600_000
    const events = await ctx.db
      .query("events")
      .withIndex("by_starts", (q) => q.gte("startsAt", since))
      .order("asc")
      .take(SCAN_CAP)
    return await Promise.all(events.map((e) => hydrate(ctx, e)))
  },
})

export const create = mutation({
  args: {
    event: eventInputValidator,
    status: v.optional(
      v.union(
        v.literal("pending_review"),
        v.literal("approved"),
        v.literal("rejected"),
      ),
    ),
  },
  handler: async (ctx, { event, status }) => {
    await requireEditor(ctx)
    return await ctx.db.insert("events", {
      ...event,
      status: status ?? "approved",
      createdAt: Date.now(),
    })
  },
})

export const update = mutation({
  args: {
    id: v.id("events"),
    patch: v.object({
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      startsAt: v.optional(v.number()),
      endsAt: v.optional(v.number()),
      allDay: v.optional(v.boolean()),
      kind: v.optional(kindValidator),
      locationName: v.optional(v.string()),
      locationAddress: v.optional(v.string()),
      neighborhood: v.optional(v.string()),
      url: v.optional(v.string()),
      imageUrl: v.optional(v.string()),
      price: v.optional(v.string()),
      sectionId: v.optional(v.id("sections")),
      articleId: v.optional(v.id("articles")),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireEditor(ctx)
    const cleaned: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) cleaned[key] = value
    }
    if (Object.keys(cleaned).length > 0) await ctx.db.patch(id, cleaned)
  },
})

export const setStatus = mutation({
  args: {
    id: v.id("events"),
    status: v.union(
      v.literal("pending_review"),
      v.literal("approved"),
      v.literal("rejected"),
    ),
  },
  handler: async (ctx, { id, status }) => {
    await requireEditor(ctx)
    await ctx.db.patch(id, { status })
  },
})

export const remove = mutation({
  args: { id: v.id("events") },
  handler: async (ctx, { id }) => {
    await requireEditor(ctx)
    await ctx.db.delete(id)
  },
})

// Future-facing events for a desk's section that the agent could enrich.
// Used by the bulk enrich pass to find events missing imageUrl, missing
// articleId, or that have a stale stub description.
export const futureForAgent = query({
  args: {
    agentId: v.id("agents"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { agentId, limit }) => {
    const agent = await ctx.db.get(agentId)
    if (!agent) return []
    const cap = limit ?? 30
    const all = await ctx.db
      .query("events")
      .withIndex("by_starts", (q) => q.gte("startsAt", Date.now()))
      .order("asc")
      .take(cap * 4)
    return all
      .filter((e) => e.sectionId === agent.sectionId)
      .slice(0, cap)
  },
})

// Apply enrichment to an existing event. Additive — only fills missing
// fields by default (imageUrl, articleId), but can also replace when an
// editor explicitly invokes it. Internal so only desk actions can call it.
export const enrichEvent = internalMutation({
  args: {
    id: v.id("events"),
    patch: v.object({
      imageUrl: v.optional(v.string()),
      articleId: v.optional(v.id("articles")),
      neighborhood: v.optional(v.string()),
      locationAddress: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const event = await ctx.db.get(id)
    if (!event) return { changed: false }
    if (event.status === "rejected") return { changed: false }
    const updates: Record<string, unknown> = {}
    if (patch.imageUrl && !event.imageUrl) updates.imageUrl = patch.imageUrl
    if (patch.articleId && !event.articleId) updates.articleId = patch.articleId
    if (patch.neighborhood && !event.neighborhood)
      updates.neighborhood = patch.neighborhood
    if (patch.locationAddress && !event.locationAddress)
      updates.locationAddress = patch.locationAddress
    if (Object.keys(updates).length === 0) return { changed: false }
    await ctx.db.patch(id, updates)
    return { changed: true, changedFields: Object.keys(updates) }
  },
})

// Insert pending events extracted by a desk's LLM. Internal — only callable
// from desk actions, never from the public client. Always lands in
// `pending_review` for editor approval.
export const insertExtracted = internalMutation({
  args: {
    event: eventInputValidator,
    agentSlug: v.string(),
    agentRunId: v.id("agentRuns"),
    derivedFromItems: v.array(v.id("ingestedItems")),
  },
  handler: async (ctx, { event, agentSlug, agentRunId, derivedFromItems }) => {
    return await ctx.db.insert("events", {
      ...event,
      status: "pending_review",
      agentSlug,
      agentRunId,
      derivedFromItems,
      createdAt: Date.now(),
    })
  },
})
