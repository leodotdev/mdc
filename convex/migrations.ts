import { v } from "convex/values"

import { internal } from "./_generated/api"
import { buildSearchableText } from "./articles"
import { internalAction, internalMutation } from "./_generated/server"

// One-shot strip for redundant location tags. Every story on
// miami.community is local by definition, so tags like "miami-dade" carry
// no signal and clutter the tag list.
//
// Run with:
//   npx convex run migrations:stripTag '{"tag":"miami-dade"}'
export const stripTag = internalMutation({
  args: { tag: v.string() },
  handler: async (ctx, { tag }) => {
    const articles = await ctx.db.query("articles").collect()
    let cleared = 0
    for (const a of articles) {
      if (!a.tags.includes(tag)) continue
      const next = a.tags.filter((t) => t !== tag)
      await ctx.db.patch(a._id, { tags: next })
      cleared += 1
    }
    return { scanned: articles.length, cleared }
  },
})

// Backfill `searchableText` on every article from its current title + dek
// + tags so the search index covers legacy docs. Idempotent — re-running
// just refreshes the blob.
//
// Run with:
//   npx convex run migrations:backfillSearchable
export const backfillSearchable = internalMutation({
  args: {},
  handler: async (ctx) => {
    const articles = await ctx.db.query("articles").collect()
    let updated = 0
    for (const a of articles) {
      const next = buildSearchableText({
        title: a.title,
        dek: a.dek,
        tags: a.tags,
      })
      if (a.searchableText === next) continue
      await ctx.db.patch(a._id, { searchableText: next })
      updated += 1
    }
    return { scanned: articles.length, updated }
  },
})

// =====================================================================
// Article wipe — events-only pivot Phase 4 (narrow). Deletes every row
// from the articles table plus every article_authors join. Idempotent.
//
// Reason: the events-only pivot made articles dead content. The
// front-end no longer reads from the table; the LLM no longer writes
// to it. Keeping the rows around just bloats the schema search index
// and adds noise to the admin dashboard.
//
// Run dev:  npx convex run migrations:wipeArticles
// Run prod: npx convex run migrations:wipeArticles --prod
//
// Note: events.relatedArticleIds entries will be left dangling — the
// hydrate path already handles a null ctx.db.get() gracefully (see
// events.ts:hydrate). storyArcs with only event members are unaffected;
// arcs with only article members become empty but harmless. We don't
// touch the storyArcs table — a later cleanup pass can prune empties
// if it's worth the round trip.
// =====================================================================

export const wipeArticlesBatch = internalMutation({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, { batchSize }) => {
    // 200 articles × (~1 join row each) ≈ 400 writes per call, well
    // under Convex's per-transaction write limit.
    const cap = batchSize ?? 200
    const articles = await ctx.db.query("articles").take(cap)
    let deletedArticles = 0
    let deletedAuthorJoins = 0
    for (const a of articles) {
      const joins = await ctx.db
        .query("article_authors")
        .withIndex("by_article", (q) => q.eq("articleId", a._id))
        .collect()
      for (const j of joins) {
        await ctx.db.delete(j._id)
        deletedAuthorJoins += 1
      }
      await ctx.db.delete(a._id)
      deletedArticles += 1
    }
    return {
      deletedArticles,
      deletedAuthorJoins,
      hasMore: articles.length === cap,
    }
  },
})

export const wipeArticles = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    totalArticles: number
    totalAuthorJoins: number
    batches: number
  }> => {
    let totalArticles = 0
    let totalAuthorJoins = 0
    let batches = 0
    // Safety ceiling — refuses to loop forever if something is wrong.
    // 50 batches × 200 = 10k articles, plenty for our scale.
    const MAX_BATCHES = 200
    for (let i = 0; i < MAX_BATCHES; i += 1) {
      const result: {
        deletedArticles: number
        deletedAuthorJoins: number
        hasMore: boolean
      } = await ctx.runMutation(
        internal.migrations.wipeArticlesBatch,
        {},
      )
      totalArticles += result.deletedArticles
      totalAuthorJoins += result.deletedAuthorJoins
      batches += 1
      if (!result.hasMore) break
    }
    return { totalArticles, totalAuthorJoins, batches }
  },
})
