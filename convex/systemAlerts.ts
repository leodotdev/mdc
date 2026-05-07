import { v } from "convex/values"

import { internal } from "./_generated/api"
import {
  internalAction,
  internalMutation,
  query,
} from "./_generated/server"

// System alerts — written by the run-watchdog cron when something's
// off. Public read for the dashboard to surface "the cron stalled"
// without an editor having to dig into logs.

const STALE_RUN_MS = 90 * 60 * 1000 // 90 min

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    return await ctx.db
      .query("systemAlerts")
      .withIndex("by_created")
      .order("desc")
      .take(limit ?? 20)
  },
})

export const unresolvedCount = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("systemAlerts")
      .withIndex("by_created")
      .order("desc")
      .take(50)
    return rows.filter((r) => !r.resolvedAt).length
  },
})

// Watchdog tick — called from cron. Looks at the most-recent agentRun
// and, if it's older than the threshold, ensures there's an open
// "stale-runs" alert. When a run lands, the alert auto-resolves.
export const cronWatchdogTick = internalAction({
  args: {},
  handler: async (ctx): Promise<{ alerted: boolean; resolved: boolean }> => {
    return await ctx.runMutation(
      internal.systemAlerts.evaluateStaleRunsAlert,
      {},
    )
  },
})

export const evaluateStaleRunsAlert = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const last = await ctx.db
      .query("agentRuns")
      .withIndex("by_started")
      .order("desc")
      .first()
    const sinceLast = last ? now - last.startedAt : Infinity
    const stale = sinceLast > STALE_RUN_MS

    const existing = await ctx.db
      .query("systemAlerts")
      .withIndex("by_kind", (q) => q.eq("kind", "stale-runs"))
      .order("desc")
      .first()
    const open = existing && !existing.resolvedAt

    if (stale && !open) {
      await ctx.db.insert("systemAlerts", {
        kind: "stale-runs",
        severity: "warning",
        message: last
          ? `Mega-desk hasn't run in ${Math.round(sinceLast / 60_000)} min — last run started ${new Date(last.startedAt).toISOString()}.`
          : "Mega-desk has never run on this deployment.",
        createdAt: now,
      })
      return { alerted: true, resolved: false }
    }
    if (!stale && open) {
      await ctx.db.patch(existing._id, { resolvedAt: now })
      return { alerted: false, resolved: true }
    }
    return { alerted: false, resolved: false }
  },
})

// Manual dismiss — surfaced as a button on the dashboard alert card.
export const resolve = internalMutation({
  args: { id: v.id("systemAlerts") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { resolvedAt: Date.now() })
  },
})
