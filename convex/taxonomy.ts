// DB-backed taxonomy overrides. The classifier reads these alongside
// the hardcoded baseline in `convex/lib/classify.ts`; DB hits take
// precedence so editors can fix a misclassification (or add a new
// venue) in the admin without a redeploy.
//
// Tables:
//   taxonomyVenues          venueKey → sectionSlug
//   taxonomyHosts           host → sectionSlug
//   taxonomyKeywords        regex → sectionSlug + tags
//   taxonomyAudienceBlocks  regex → drop event as private audience

import { v } from "convex/values"
import {
  mutation,
  query,
  internalQuery,
} from "./_generated/server"
import { requireEditor } from "./lib/guard"

// ── Internal-only snapshot for the classifier ───────────────────────────
// Loaded once per ingest pass and passed into `classifyEvent(input, taxonomy)`.
// Cheap query — these tables are small (dozens of rows).
export const snapshot = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [venues, hosts, keywords, audienceBlocks] = await Promise.all([
      ctx.db.query("taxonomyVenues").collect(),
      ctx.db.query("taxonomyHosts").collect(),
      ctx.db.query("taxonomyKeywords").withIndex("by_order").collect(),
      ctx.db.query("taxonomyAudienceBlocks").collect(),
    ])
    return {
      venues: venues.map((v) => ({
        venueKey: v.venueKey,
        sectionSlug: v.sectionSlug,
      })),
      hosts: hosts.map((h) => ({
        host: h.host,
        sectionSlug: h.sectionSlug,
      })),
      keywords: keywords.map((k) => ({
        pattern: k.pattern,
        sectionSlug: k.sectionSlug,
        tags: k.tags,
        order: k.order,
      })),
      audienceBlocks: audienceBlocks.map((a) => ({ pattern: a.pattern })),
    }
  },
})

// ── Editor-facing read ──────────────────────────────────────────────────
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireEditor(ctx)
    const [venues, hosts, keywords, audienceBlocks] = await Promise.all([
      ctx.db.query("taxonomyVenues").collect(),
      ctx.db.query("taxonomyHosts").collect(),
      ctx.db.query("taxonomyKeywords").withIndex("by_order").collect(),
      ctx.db.query("taxonomyAudienceBlocks").collect(),
    ])
    return { venues, hosts, keywords, audienceBlocks }
  },
})

// ── Venues ─────────────────────────────────────────────────────────────
export const addVenue = mutation({
  args: {
    venueKey: v.string(),
    sectionSlug: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireEditor(ctx)
    const key = args.venueKey.trim().toLowerCase()
    if (!key) throw new Error("venueKey required")
    const existing = await ctx.db
      .query("taxonomyVenues")
      .withIndex("by_venueKey", (q) => q.eq("venueKey", key))
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, {
        sectionSlug: args.sectionSlug,
        note: args.note,
      })
      return existing._id
    }
    return await ctx.db.insert("taxonomyVenues", { ...args, venueKey: key })
  },
})
export const removeVenue = mutation({
  args: { id: v.id("taxonomyVenues") },
  handler: async (ctx, { id }) => {
    await requireEditor(ctx)
    await ctx.db.delete(id)
  },
})

// ── Hosts ──────────────────────────────────────────────────────────────
export const addHost = mutation({
  args: {
    host: v.string(),
    sectionSlug: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireEditor(ctx)
    const host = args.host.trim().toLowerCase().replace(/^www\./, "")
    if (!host) throw new Error("host required")
    const existing = await ctx.db
      .query("taxonomyHosts")
      .withIndex("by_host", (q) => q.eq("host", host))
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, {
        sectionSlug: args.sectionSlug,
        note: args.note,
      })
      return existing._id
    }
    return await ctx.db.insert("taxonomyHosts", { ...args, host })
  },
})
export const removeHost = mutation({
  args: { id: v.id("taxonomyHosts") },
  handler: async (ctx, { id }) => {
    await requireEditor(ctx)
    await ctx.db.delete(id)
  },
})

// ── Keywords ───────────────────────────────────────────────────────────
export const addKeyword = mutation({
  args: {
    pattern: v.string(),
    sectionSlug: v.string(),
    tags: v.array(v.string()),
    order: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireEditor(ctx)
    // Validate the regex compiles before storing — keeps the
    // classifier from crashing later on a bad pattern.
    try {
      new RegExp(args.pattern, "i")
    } catch (e) {
      throw new Error(
        `Invalid regex: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
    return await ctx.db.insert("taxonomyKeywords", {
      ...args,
      order: args.order ?? 100,
    })
  },
})
export const removeKeyword = mutation({
  args: { id: v.id("taxonomyKeywords") },
  handler: async (ctx, { id }) => {
    await requireEditor(ctx)
    await ctx.db.delete(id)
  },
})

// ── Audience blocks ────────────────────────────────────────────────────
export const addAudienceBlock = mutation({
  args: { pattern: v.string(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireEditor(ctx)
    try {
      new RegExp(args.pattern, "i")
    } catch (e) {
      throw new Error(
        `Invalid regex: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
    return await ctx.db.insert("taxonomyAudienceBlocks", args)
  },
})
export const removeAudienceBlock = mutation({
  args: { id: v.id("taxonomyAudienceBlocks") },
  handler: async (ctx, { id }) => {
    await requireEditor(ctx)
    await ctx.db.delete(id)
  },
})
