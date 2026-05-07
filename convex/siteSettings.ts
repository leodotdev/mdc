import { v } from "convex/values"

import { mutation, query } from "./_generated/server"
import { requireEditor } from "./lib/guard"

// Site-wide flags. Single-row pattern: we always read/write the first
// document, treating the table as a singleton. Adding a flag = add a
// field on the schema validator; no migration needed for existing rows
// because Convex tolerates absent optional fields on read (we apply
// defaults below).

const DEFAULT_ADS_ENABLED = true

export const get = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("siteSettings").first()
    return {
      adsEnabled: row?.adsEnabled ?? DEFAULT_ADS_ENABLED,
    }
  },
})

export const setAdsEnabled = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }) => {
    await requireEditor(ctx)
    const row = await ctx.db.query("siteSettings").first()
    const now = Date.now()
    if (row) {
      await ctx.db.patch(row._id, { adsEnabled: enabled, updatedAt: now })
    } else {
      await ctx.db.insert("siteSettings", {
        adsEnabled: enabled,
        updatedAt: now,
      })
    }
  },
})
