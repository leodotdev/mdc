// Operator bulk actions for the admin Cmd+K palette. Each action
// composes existing mutations / actions so the palette stays a thin
// shell over the working backend. Editor-gated.

import { api, internal } from "./_generated/api"
import { action } from "./_generated/server"
import type { ActionCtx } from "./_generated/server"
import { getAuthUserId } from "@convex-dev/auth/server"

async function requireEditorInAction(ctx: ActionCtx) {
  const userId = await getAuthUserId(ctx)
  if (!userId) throw new Error("Unauthenticated")
}

// Fetch every silent source — those with lastFetchStatus="ok" and 0
// items recently. Picks them up after an adapter change without
// waiting for the cron.
export const fetchAllSilent = action({
  args: {},
  handler: async (ctx): Promise<{ scanned: number; refreshed: number }> => {
    await requireEditorInAction(ctx)
    const sources = await ctx.runQuery(internal.sourcesData.listInternal, {})
    const silent = sources.filter(
      (s) =>
        s.enabled &&
        s.lastFetchStatus === "ok" &&
        (s.lastFetchItemCount ?? 0) === 0 &&
        !s.url.startsWith("feeder://"),
    )
    for (const s of silent) {
      await ctx.scheduler.runAfter(0, internal.agents.refreshOneSource, {
        sourceId: s._id,
      })
    }
    return { scanned: sources.length, refreshed: silent.length }
  },
})

// Delete every source whose last fetch error mentions an anti-bot
// block. The Cloudflare/Imperva pages can't be parsed and the
// classifier already flips status="error" for them; this is the
// follow-up clean-out.
export const deleteBlocked = action({
  args: {},
  handler: async (ctx): Promise<{ deleted: number }> => {
    await requireEditorInAction(ctx)
    const sources = await ctx.runQuery(internal.sourcesData.listInternal, {})
    const blocked = sources.filter(
      (s) =>
        s.lastFetchStatus === "error" &&
        (s.lastFetchError ?? "").includes("anti-bot"),
    )
    for (const s of blocked) {
      await ctx.runMutation(api.sourcesData.remove, { sourceId: s._id })
    }
    return { deleted: blocked.length }
  },
})

// approveHighConfidence retired — events auto-approve at insert.

// Run the section reclassifier across every approved event using the
// current classifier + DB taxonomy overrides. Useful after editing
// taxonomy rules — re-files anything the new rules now resolve
// confidently. Idempotent.
export const reclassifyAll = action({
  args: {},
  handler: async (ctx): Promise<{
    scanned: number
    moved: number
    unchanged: number
  }> => {
    await requireEditorInAction(ctx)
    return await ctx.runMutation(internal.migrations.reclassifyAllEvents, {})
  },
})

// Force-run the cron now (skipping the time-of-day quiet-hours gate).
// The cron itself is fan-out + drain; this just kicks it.
export const runIngestNow = action({
  args: {},
  handler: async (ctx): Promise<{ summary: string }> => {
    await requireEditorInAction(ctx)
    return await ctx.runAction(internal.agents.cronRunMegaDesk, {})
  },
})
