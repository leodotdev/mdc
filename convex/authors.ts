import { v } from "convex/values"
import { mutation, query } from "./_generated/server"

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("authors").collect()
  },
})

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    return await ctx.db
      .query("authors")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique()
  },
})

export const upsert = mutation({
  args: {
    slug: v.string(),
    name: v.string(),
    bio: v.string(),
    avatar: v.optional(v.string()),
    title: v.optional(v.string()),
    kind: v.union(v.literal("agent"), v.literal("human")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("authors")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, args)
      return existing._id
    }
    return await ctx.db.insert("authors", args)
  },
})
