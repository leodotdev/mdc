import { v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { buildSearchableText } from "./articles"
import { requireEditor } from "./lib/guard"
import { linkRelated } from "./lib/storyArcs"

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

// Pick the desk that should own a given article — used by the per-story
// enrichment action so the editor doesn't have to select a desk manually.
// Strategy: prefer the desk that originally drafted it (article.agentSlug),
// fall back to any enabled desk that primaries the article's section, then
// any enabled desk whose section is a parent of the article's section.
// Returns null when no desk is appropriate (rare — e.g. orphaned section).
export const deskForArticle = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, { articleId }) => {
    const article = await ctx.db.get(articleId)
    if (!article) return null
    if (article.agentSlug) {
      const named = await ctx.db
        .query("agents")
        .withIndex("by_slug", (q) => q.eq("slug", article.agentSlug!))
        .unique()
      if (named) return named
    }
    const direct = await ctx.db
      .query("agents")
      .withIndex("by_section", (q) => q.eq("sectionId", article.sectionId))
      .collect()
    const enabledDirect = direct.find((a) => a.enabled) ?? direct[0]
    if (enabledDirect) return enabledDirect
    // Fall back to the parent section's desk (sub-section pieces inherit).
    const section = await ctx.db.get(article.sectionId)
    if (section?.parentId) {
      const parentDesks = await ctx.db
        .query("agents")
        .withIndex("by_section", (q) => q.eq("sectionId", section.parentId!))
        .collect()
      return parentDesks.find((a) => a.enabled) ?? parentDesks[0] ?? null
    }
    return null
  },
})

/**
 * Sections this desk can file stories under: its primary section + every
 * direct child. Used by the desk action to constrain the LLM's section
 * choice — Arts desk picks from {arts, music, film, ...} but never lands
 * a story under News.
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
    status: v.union(v.literal("succeeded"), v.literal("failed")),
    itemsConsidered: v.number(),
    draftsCreated: v.number(),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      status: args.status,
      finishedAt: Date.now(),
      itemsConsidered: args.itemsConsidered,
      draftsCreated: args.draftsCreated,
      errorMessage: args.errorMessage,
    })
  },
})

// ---------- ingestion + selection ----------

export const enabledSourcesForAgent = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const agent = await ctx.db.get(agentId)
    if (!agent) return []
    const all = await ctx.db
      .query("sources")
      .withIndex("by_enabled", (q) => q.eq("enabled", true))
      .collect()
    return all
      .filter((s) =>
        s.sectionIds.some(
          (sectionId) => sectionId === agent.sectionId,
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
    const sourcesForSection = await ctx.db.query("sources").collect()
    const ourSourceIds = new Set(
      sourcesForSection
        .filter((s) =>
          s.sectionIds.some(
            (sectionId) => sectionId === agent.sectionId,
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

export const markItemsConsumed = mutation({
  args: { itemIds: v.array(v.id("ingestedItems")) },
  handler: async (ctx, { itemIds }) => {
    for (const id of itemIds) {
      await ctx.db.patch(id, { consumed: true })
    }
  },
})

export const insertDraft = mutation({
  args: {
    article: v.object({
      slug: v.string(),
      title: v.string(),
      dek: v.string(),
      body: v.string(),
      sectionId: v.id("sections"),
      tags: v.array(v.string()),
      heroImage: v.optional(v.string()),
      heroCaption: v.optional(v.string()),
      heroSource: v.optional(
        v.union(
          v.literal("source"),
          v.literal("unsplash"),
          v.literal("wikimedia"),
          v.literal("none"),
        ),
      ),
      citations: v.array(
        v.object({
          url: v.string(),
          title: v.string(),
          publisher: v.optional(v.string()),
          fetchedAt: v.number(),
          snippet: v.optional(v.string()),
        }),
      ),
      agentSlug: v.string(),
      agentRunId: v.id("agentRuns"),
      derivedFromItems: v.array(v.id("ingestedItems")),
      publishedAt: v.optional(v.number()),
      neighborhoods: v.optional(v.array(v.string())),
    }),
    authorIds: v.array(v.id("authors")),
    relatedIds: v.optional(v.array(v.id("articles"))),
  },
  handler: async (ctx, { article, authorIds, relatedIds }) => {
    // Avoid slug collisions by appending a short suffix
    let slug = article.slug
    let suffix = 0
    while (
      await ctx.db
        .query("articles")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .unique()
    ) {
      suffix += 1
      slug = `${article.slug}-${suffix}`
    }
    const articleId = await ctx.db.insert("articles", {
      ...article,
      slug,
      status: "pending_review",
      createdAt: Date.now(),
      relatedArticleIds: relatedIds ?? [],
      searchableText: buildSearchableText({
        title: article.title,
        dek: article.dek,
        tags: article.tags,
      }),
    })
    for (const authorId of authorIds) {
      await ctx.db.insert("article_authors", { articleId, authorId })
    }
    if (relatedIds && relatedIds.length > 0) {
      await linkRelated(ctx, articleId, relatedIds, article.title)
    }
    // Seed the article's revision timeline.
    await ctx.db.insert("articleRevisions", {
      articleId,
      at: Date.now(),
      kind: "draft_created",
      agentSlug: article.agentSlug,
      agentRunId: article.agentRunId,
      citationsAdded: article.citations.length,
      sourceItemsAdded: article.derivedFromItems.length,
    })
    return articleId
  },
})
