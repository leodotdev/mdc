import { v } from "convex/values"

import { internalQuery, mutation, query } from "./_generated/server"
import { BUDGET_DAILY_CENTS_DEFAULT } from "./lib/budget"
import { requireEditor } from "./lib/guard"

// Site-wide flags. Single-row pattern: we always read/write the first
// document, treating the table as a singleton. Adding a flag = add a
// field on the schema validator; no migration needed for existing rows
// because Convex tolerates absent optional fields on read (we apply
// defaults below).

const DEFAULT_ADS_ENABLED = true
const DEFAULT_LLM_ENABLED = true

export const get = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("siteSettings").first()
    return {
      adsEnabled: row?.adsEnabled ?? DEFAULT_ADS_ENABLED,
      dailyBudgetCents: row?.dailyBudgetCents ?? BUDGET_DAILY_CENTS_DEFAULT,
      llmEnabled: row?.llmEnabled ?? DEFAULT_LLM_ENABLED,
    }
  },
})

// Internal-only read for backend short-circuit checks. Avoids the
// editor-gate on the public `get` query so action contexts can call
// it without an auth identity.
export const llmEnabledInternal = internalQuery({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    const row = await ctx.db.query("siteSettings").first()
    return row?.llmEnabled ?? DEFAULT_LLM_ENABLED
  },
})

export const setLlmEnabled = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }) => {
    await requireEditor(ctx)
    const row = await ctx.db.query("siteSettings").first()
    const now = Date.now()
    if (row) {
      await ctx.db.patch(row._id, { llmEnabled: enabled, updatedAt: now })
    } else {
      await ctx.db.insert("siteSettings", {
        adsEnabled: DEFAULT_ADS_ENABLED,
        llmEnabled: enabled,
        updatedAt: now,
      })
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

export const setDailyBudgetCents = mutation({
  args: { cents: v.number() },
  handler: async (ctx, { cents }) => {
    await requireEditor(ctx)
    // Sanity bounds — anything below 50¢ effectively turns the system
    // off; anything above $50/day risks runaway spend if a bug slips
    // past us again. Editor can extend the upper bound by editing
    // these constants.
    const clamped = Math.max(50, Math.min(cents, 5000))
    const row = await ctx.db.query("siteSettings").first()
    const now = Date.now()
    if (row) {
      await ctx.db.patch(row._id, {
        dailyBudgetCents: clamped,
        updatedAt: now,
      })
    } else {
      await ctx.db.insert("siteSettings", {
        adsEnabled: DEFAULT_ADS_ENABLED,
        dailyBudgetCents: clamped,
        updatedAt: now,
      })
    }
    return { dailyBudgetCents: clamped }
  },
})
