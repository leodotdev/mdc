import { v } from "convex/values"

import { internalMutation, query } from "./_generated/server"
import {
  BUDGET_DAILY_CENTS,
  BUDGET_WARNING_CENTS,
  todayDayKey,
} from "./lib/budget"

// Today's budget row, or `null` when nothing's been spent yet today.
export const today = query({
  args: {},
  handler: async (ctx) => {
    const dayKey = todayDayKey()
    const row = await ctx.db
      .query("llmBudget")
      .withIndex("by_day", (q) => q.eq("dayKey", dayKey))
      .first()
    return {
      dayKey,
      centsSpent: row?.centsSpent ?? 0,
      callsToday: row?.callsToday ?? 0,
      capCents: BUDGET_DAILY_CENTS,
      warningCents: BUDGET_WARNING_CENTS,
      overBudget: (row?.centsSpent ?? 0) >= BUDGET_DAILY_CENTS,
    }
  },
})

// Atomic budget gate. Returns `{ allowed: true }` and bumps centsSpent
// when there's headroom; `{ allowed: false }` when over cap. Callers
// (mega-desk, merge sweep, translation, widget refresh) must call this
// BEFORE the LLM call and bail on `allowed: false`.
//
// Internal so only Convex actions can reach it — no public client write.
export const reserve = internalMutation({
  args: {
    estimatedCents: v.number(),
    label: v.string(),
  },
  handler: async (ctx, { estimatedCents, label }) => {
    const dayKey = todayDayKey()
    const row = await ctx.db
      .query("llmBudget")
      .withIndex("by_day", (q) => q.eq("dayKey", dayKey))
      .first()
    const before = row?.centsSpent ?? 0
    if (before + estimatedCents > BUDGET_DAILY_CENTS) {
      return {
        allowed: false,
        centsSpent: before,
        capCents: BUDGET_DAILY_CENTS,
      }
    }
    if (row) {
      await ctx.db.patch(row._id, {
        centsSpent: before + estimatedCents,
        callsToday: (row.callsToday ?? 0) + 1,
        lastUpdatedAt: Date.now(),
      })
    } else {
      await ctx.db.insert("llmBudget", {
        dayKey,
        centsSpent: estimatedCents,
        callsToday: 1,
        lastUpdatedAt: Date.now(),
      })
    }
    void label // included for future per-label spend tracking
    return {
      allowed: true,
      centsSpent: before + estimatedCents,
      capCents: BUDGET_DAILY_CENTS,
    }
  },
})

// Last 14 days of budget rows for the admin chart.
export const recent = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db
      .query("llmBudget")
      .order("desc")
      .take(14)
    return all.map((r) => ({
      dayKey: r.dayKey,
      centsSpent: r.centsSpent,
      callsToday: r.callsToday,
    }))
  },
})
