import { v } from "convex/values"
import { query } from "./_generated/server"

export const recentForAgent = query({
  args: { agentId: v.id("agents"), limit: v.number() },
  handler: async (ctx, { agentId, limit }) => {
    return await ctx.db
      .query("agentRuns")
      .withIndex("by_agent_started", (q) => q.eq("agentId", agentId))
      .order("desc")
      .take(limit)
  },
})

export const get = query({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, { runId }) => {
    return await ctx.db.get(runId)
  },
})

export const recent = query({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const runs = await ctx.db
      .query("agentRuns")
      .withIndex("by_started")
      .order("desc")
      .take(limit)
    return await Promise.all(
      runs.map(async (run) => ({
        ...run,
        agent: await ctx.db.get(run.agentId),
      })),
    )
  },
})

// One row per agent — the agent's most-recent run plus a breakdown of
// what that run actually produced. Used by the dashboard's "Recent
// runs" table so the row order maps onto the section taxonomy (one
// beat per row) and the editor can see honest numbers per axis:
//
//   itemsConsidered — raw source items the desk pulled in
//   draftsCreated   — articles drafted (from the run record)
//   eventsCreated   — events with this agentRunId (filter scan)
//   nextRunAt       — startedAt + 4h, matching the cron interval. Approx
//                     until Convex exposes the cron schedule directly;
//                     drift bounded to a few seconds per tick.
export const latestPerAgent = query({
  args: {},
  handler: async (ctx) => {
    // Cron is 3x daily (06/12/18 ET) — pick the longest gap (overnight)
    // so the "overdue" badge doesn't trip on the expected 8-12h windows.
    const EXPECTED_INTERVAL_MS = 12 * 60 * 60 * 1000
    const FOUR_HOURS_MS = EXPECTED_INTERVAL_MS
    const agents = await ctx.db.query("agents").collect()
    const rows = await Promise.all(
      agents.map(async (agent) => {
        const run = await ctx.db
          .query("agentRuns")
          .withIndex("by_agent_started", (q) => q.eq("agentId", agent._id))
          .order("desc")
          .first()
        let eventsCount = 0
        if (run) {
          const events = await ctx.db
            .query("events")
            .filter((q) => q.eq(q.field("agentRunId"), run._id))
            .collect()
          eventsCount = events.length
        }
        const nextRunAt = run ? run.startedAt + FOUR_HOURS_MS : null
        // Surface the run's "last meaningful line" so the editor can see
        // why a run with 30+ items produced 0 drafts. Priority: explicit
        // skip / error / LLM-result lines; fall back to the very last
        // line. This is the single line shown in the dashboard's Notes
        // column — full log lives on the per-desk page.
        const summary = summarizeLog(run?.log ?? [])
        return {
          agent,
          run,
          itemsConsidered: run?.itemsConsidered ?? 0,
          draftsCreated: run?.draftsCreated ?? 0,
          eventsCreated: eventsCount,
          nextRunAt,
          summary,
        }
      }),
    )
    rows.sort(
      (a, b) => (b.run?.startedAt ?? 0) - (a.run?.startedAt ?? 0),
    )
    return rows
  },
})

// Single-row dashboard heartbeat. The mega-desk is one agent — the
// editor only needs the most recent run's state, not a per-desk table.
// Returned shape powers both the heartbeat strip (status + timing) and
// the Pipeline card (counts + summary).
export const megaSummary = query({
  args: {},
  handler: async (ctx) => {
    // Cron is 3x daily (06/12/18 ET) — pick the longest gap (overnight)
    // so the "overdue" badge doesn't trip on the expected 8-12h windows.
    const EXPECTED_INTERVAL_MS = 12 * 60 * 60 * 1000
    const FOUR_HOURS_MS = EXPECTED_INTERVAL_MS
    const last = await ctx.db
      .query("agentRuns")
      .withIndex("by_started")
      .order("desc")
      .first()
    if (!last) return null
    return {
      runId: last._id,
      status: last.status,
      startedAt: last.startedAt,
      finishedAt: last.finishedAt,
      itemsConsidered: last.itemsConsidered ?? 0,
      draftsCreated: last.draftsCreated ?? 0,
      errorMessage: last.errorMessage,
      skippedReason: last.skippedReason,
      summary: summarizeLog(last.log ?? []),
      nextRunAt: last.startedAt + FOUR_HOURS_MS,
    }
  },
})

// Pull the most informative line out of a run's log. Walks backward and
// preferentially returns a skip / error / LLM-result line; falls back to
// the last entry. Returns "" when the log is empty.
function summarizeLog(log: ReadonlyArray<string>): string {
  if (log.length === 0) return ""
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const line = log[i]
    if (
      line.startsWith("Skipped LLM call") ||
      line.startsWith("LLM returned") ||
      line.includes("FAILED") ||
      line.includes("error")
    ) {
      return line
    }
  }
  return log[log.length - 1]
}
