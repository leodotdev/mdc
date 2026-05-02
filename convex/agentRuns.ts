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
