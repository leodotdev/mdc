import { v } from "convex/values"
import { mutation, query } from "./_generated/server"

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("sections").withIndex("by_order").collect()
  },
})

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    return await ctx.db
      .query("sections")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique()
  },
})

export const getById = query({
  args: { id: v.id("sections") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id)
  },
})

export const upsert = mutation({
  args: {
    slug: v.string(),
    name: v.string(),
    description: v.string(),
    accentColor: v.string(),
    order: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sections")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, args)
      return existing._id
    }
    return await ctx.db.insert("sections", args)
  },
})
