import { v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { requireEditor } from "./lib/guard"

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireEditor(ctx)
    return await ctx.db.query("sources").collect()
  },
})

export const get = query({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => {
    await requireEditor(ctx)
    return await ctx.db.get(sourceId)
  },
})

export const getForAdapter = query({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => {
    // Called from within `agents.runDesk` action context — that action
    // is itself editor-gated; the underlying query does not double-check
    // because actions don't have an authenticated identity for runQuery
    // calls invoked from within the action handler.
    const s = await ctx.db.get(sourceId)
    if (!s) return null
    return { type: s.type, url: s.url, config: s.config }
  },
})

export const create = mutation({
  args: {
    name: v.string(),
    type: v.union(
      v.literal("rss"),
      v.literal("reddit"),
      v.literal("youtube"),
      v.literal("x"),
      v.literal("web"),
      v.literal("wikipedia-otd"),
    ),
    url: v.string(),
    sectionIds: v.array(v.id("sections")),
    enabled: v.boolean(),
    config: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await requireEditor(ctx)
    return await ctx.db.insert("sources", args)
  },
})

export const update = mutation({
  args: {
    sourceId: v.id("sources"),
    name: v.optional(v.string()),
    url: v.optional(v.string()),
    sectionIds: v.optional(v.array(v.id("sections"))),
    enabled: v.optional(v.boolean()),
    config: v.optional(v.any()),
  },
  handler: async (ctx, { sourceId, ...patch }) => {
    await requireEditor(ctx)
    const cleaned: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) cleaned[key] = value
    }
    if (Object.keys(cleaned).length > 0) {
      await ctx.db.patch(sourceId, cleaned)
    }
  },
})

export const remove = mutation({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => {
    await requireEditor(ctx)
    await ctx.db.delete(sourceId)
  },
})

export const recordFetch = mutation({
  args: {
    sourceId: v.id("sources"),
    status: v.string(),
    error: v.optional(v.string()),
    items: v.array(
      v.object({
        externalId: v.string(),
        url: v.string(),
        title: v.string(),
        snippet: v.optional(v.string()),
        body: v.optional(v.string()),
        mediaUrl: v.optional(v.string()),
        publishedAt: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { sourceId, status, error, items }) => {
    const now = Date.now()
    let inserted = 0
    for (const item of items) {
      const existing = await ctx.db
        .query("ingestedItems")
        .withIndex("by_source_external", (q) =>
          q.eq("sourceId", sourceId).eq("externalId", item.externalId),
        )
        .unique()
      if (existing) continue
      await ctx.db.insert("ingestedItems", {
        sourceId,
        externalId: item.externalId,
        url: item.url,
        title: item.title,
        snippet: item.snippet,
        body: item.body,
        mediaUrl: item.mediaUrl,
        publishedAt: item.publishedAt,
        fetchedAt: now,
        consumed: false,
      })
      inserted += 1
    }
    await ctx.db.patch(sourceId, {
      lastFetchedAt: now,
      lastFetchStatus: status,
      lastFetchError: error,
      lastFetchItemCount: items.length,
      lastFetchNewCount: inserted,
    })
    return { inserted }
  },
})
