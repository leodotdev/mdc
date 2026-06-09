// Popularity rollup. Nightly cron walks every approved event, counts
// rows in `eventViews` from the trailing 30 days via `by_event_time`,
// and patches `events.viewCount30d` + `viewCountUpdatedAt`. A second
// pass prunes log rows older than the window so the table stays
// bounded. The denormalized counter is what the "Popular" rail
// queries read at request time, so the work happens once a day at
// 03:30 ET instead of on every page load.
//
// v1 tradeoff: popularity refreshes once a day, not per-view. We
// avoid the OCC contention of a write-on-every-click counter and
// accept the lag. A fast-path counter on `recordView` could layer on
// top of this without changing the rail consumers.

import { v } from "convex/values"

import { internal } from "./_generated/api"
import { internalAction, internalMutation } from "./_generated/server"

const WINDOW_MS = 30 * 24 * 3_600_000

// Batched per-event refresh. Pages by `_creationTime` so we never
// load the whole events table in one mutation.
export const refreshOneBatch = internalMutation({
  args: { cursor: v.optional(v.number()) },
  handler: async (
    ctx,
    { cursor },
  ): Promise<{
    scanned: number
    patched: number
    nextCursor: number | null
  }> => {
    const BATCH = 100
    const now = Date.now()
    const windowStart = now - WINDOW_MS
    const batch = await ctx.db
      .query("events")
      .withIndex("by_status_starts", (idx) => idx.eq("status", "approved"))
      .order("asc")
      .filter((f) =>
        cursor === undefined
          ? true
          : f.gt(f.field("_creationTime"), cursor),
      )
      .take(BATCH)
    let patched = 0
    for (const event of batch) {
      // by_event_time: O(log n + k). For a viral row k might be large
      // but `collect()` is bounded by the window already.
      const rows = await ctx.db
        .query("eventViews")
        .withIndex("by_event_time", (idx) =>
          idx.eq("eventId", event._id).gte("viewedAt", windowStart),
        )
        .collect()
      const count = rows.length
      const prev = event.viewCount30d ?? 0
      // Skip the write when nothing changed AND we've stamped this
      // row before. Without the second guard, brand-new events with
      // zero views never get `viewCountUpdatedAt` set, which makes
      // the admin view "haven't been touched ever" hard to read.
      if (prev === count && event.viewCountUpdatedAt) continue
      await ctx.db.patch(event._id, {
        viewCount30d: count,
        viewCountUpdatedAt: now,
      })
      patched += 1
    }
    const nextCursor =
      batch.length === BATCH
        ? (batch[batch.length - 1]._creationTime as number)
        : null
    return { scanned: batch.length, patched, nextCursor }
  },
})

// Batched prune of expired view rows. `by_time` drains in time order
// so we never scan the live tail. Loops until `hasMore=false`.
export const pruneOneBatch = internalMutation({
  args: {},
  handler: async (ctx) => {
    const BATCH = 500
    const cutoff = Date.now() - WINDOW_MS
    const rows = await ctx.db
      .query("eventViews")
      .withIndex("by_time", (idx) => idx.lt("viewedAt", cutoff))
      .take(BATCH)
    for (const row of rows) await ctx.db.delete(row._id)
    return { deleted: rows.length, hasMore: rows.length === BATCH }
  },
})

// Cron tick — refresh every event, then prune the log. Idempotent:
// running twice in a row just rewrites the same counters and the
// second prune is a no-op.
export const cronTick = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    refreshBatches: number
    refreshScanned: number
    refreshPatched: number
    pruneBatches: number
    pruneDeleted: number
  }> => {
    let refreshBatches = 0
    let refreshScanned = 0
    let refreshPatched = 0
    let cursor: number | null = null
    const MAX_REFRESH_BATCHES = 100
    for (let i = 0; i < MAX_REFRESH_BATCHES; i += 1) {
      const result: {
        scanned: number
        patched: number
        nextCursor: number | null
      } = await ctx.runMutation(internal.popularity.refreshOneBatch, {
        cursor: cursor ?? undefined,
      })
      refreshScanned += result.scanned
      refreshPatched += result.patched
      refreshBatches += 1
      cursor = result.nextCursor
      if (cursor === null) break
    }

    let pruneBatches = 0
    let pruneDeleted = 0
    const MAX_PRUNE_BATCHES = 100
    for (let i = 0; i < MAX_PRUNE_BATCHES; i += 1) {
      const result: { deleted: number; hasMore: boolean } =
        await ctx.runMutation(internal.popularity.pruneOneBatch, {})
      pruneDeleted += result.deleted
      pruneBatches += 1
      if (!result.hasMore) break
    }
    return {
      refreshBatches,
      refreshScanned,
      refreshPatched,
      pruneBatches,
      pruneDeleted,
    }
  },
})
