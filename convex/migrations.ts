import { v } from "convex/values"

import { buildSearchableText } from "./articles"
import { internalMutation } from "./_generated/server"

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
