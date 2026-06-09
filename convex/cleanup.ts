// Daily hygiene crons. Bounded scans (no full-table walks). Runs every
// day at 04:00 ET via crons.ts. All idempotent — re-runs no-op once
// every row is in the right state.
//
// What it does:
//   - Auto-archive approved events whose endsAt (or startsAt + 24h) has
//     passed by 24h. Keeps the public events feed tight.
//   - Delete consumed ingestedItems older than 90 days. Saves storage —
//     anything not consumed in 90 days is functionally dead.

import { internalAction, internalMutation, query  } from "./_generated/server"
import { internal } from "./_generated/api"

const PAST_EVENT_GRACE_MS = 24 * 3_600_000 // 24h after end
const ITEM_RETENTION_MS = 90 * 24 * 3_600_000 // 90 days

// One archival pass over events that ended yesterday or earlier. Cap each
// batch to keep transactions bounded.
export const archivePastEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const horizon = now - PAST_EVENT_GRACE_MS
    // Approved events with startsAt before the grace boundary. We don't
    // index on endsAt, so reuse startsAt and check endsAt in the filter.
    const candidates = await ctx.db
      .query("events")
      .withIndex("by_status_starts", (q) =>
        q.eq("status", "approved").lt("startsAt", horizon),
      )
      .take(200)
    let archived = 0
    for (const e of candidates) {
      const endsAt = e.endsAt ?? e.startsAt
      if (endsAt > horizon) continue
      // Recurring-event horizon: a recurring series whose
      // canonical startsAt is in the past stays live as long as
      // recurrenceInstances has a future entry. The renderer reads
      // through `effectiveStartsAt(event)` to show the next
      // occurrence. Only archive when both are exhausted.
      if (e.recurrenceRule) {
        const instances = e.recurrenceInstances ?? []
        const hasFutureInstance = instances.some((t) => t > now)
        if (hasFutureInstance) continue
      }
      await ctx.db.patch(e._id, { status: "archived" })
      archived += 1
    }
    return { scanned: candidates.length, archived }
  },
})

// Delete consumed ingestedItems older than 90 days. Unconsumed items are
// preserved indefinitely — they may still get drafted from later.
export const purgeOldItems = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - ITEM_RETENTION_MS
    const candidates = await ctx.db
      .query("ingestedItems")
      .withIndex("by_consumed_fetched", (q) =>
        q.eq("consumed", true).lt("fetchedAt", cutoff),
      )
      .take(500)
    let deleted = 0
    for (const item of candidates) {
      await ctx.db.delete(item._id)
      deleted += 1
    }
    return { scanned: candidates.length, deleted }
  },
})

// Cron tick — runs both passes. Each is independently idempotent so
// partial failures don't compound.
export const cronTick = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    eventsArchived: number
    itemsDeleted: number
  }> => {
    const events = await ctx.runMutation(
      internal.cleanup.archivePastEvents,
      {},
    )
    const items = await ctx.runMutation(internal.cleanup.purgeOldItems, {})
    return {
      eventsArchived: events.archived,
      itemsDeleted: items.deleted,
    }
  },
})

// Public stats query for the live status panel — counts what *would* be
// archived right now, so the editor can see whether cleanup is keeping
// up. Cheap (bounded by the same indices the cleanup uses).
export const pendingCleanup = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const eventHorizon = now - PAST_EVENT_GRACE_MS
    const pastEvents = await ctx.db
      .query("events")
      .withIndex("by_status_starts", (q) =>
        q.eq("status", "approved").lt("startsAt", eventHorizon),
      )
      .take(50)
    const eventsToArchive = pastEvents.filter(
      (e) => (e.endsAt ?? e.startsAt) <= eventHorizon,
    ).length
    return {
      eventsToArchive,
    }
  },
})
