// Daily hygiene crons. Bounded scans (no full-table walks). Runs every
// day at 04:00 ET via crons.ts. All idempotent — re-runs no-op once
// every row is in the right state.
//
// What it does:
//   - Auto-archive approved events whose endsAt (or startsAt + 24h) has
//     passed by 24h. Keeps the public events feed tight.
//   - Auto-archive pending-review article drafts older than 7 days that
//     never made it to publish. Keeps the queue from growing forever.
//   - Delete consumed ingestedItems older than 90 days. Saves storage —
//     anything not consumed in 90 days is functionally dead.

import { internalAction, internalMutation, query  } from "./_generated/server"
import { internal } from "./_generated/api"

const PAST_EVENT_GRACE_MS = 24 * 3_600_000 // 24h after end
const STALE_DRAFT_AGE_MS = 7 * 24 * 3_600_000 // 7 days
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
      await ctx.db.patch(e._id, { status: "archived" })
      archived += 1
    }
    return { scanned: candidates.length, archived }
  },
})

// Pending-review article drafts that never got approved. We only archive,
// never delete — gives the editor a recovery path via Convex dashboard.
export const archiveStaleDrafts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_DRAFT_AGE_MS
    const candidates = await ctx.db
      .query("articles")
      .withIndex("by_status_created", (q) =>
        q.eq("status", "pending_review").lt("createdAt", cutoff),
      )
      .take(200)
    let archived = 0
    for (const a of candidates) {
      await ctx.db.patch(a._id, { status: "archived" })
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

// Cron tick — runs all three passes. Each is independently idempotent
// so partial failures don't compound.
export const cronTick = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    eventsArchived: number
    draftsArchived: number
    itemsDeleted: number
  }> => {
    const events = await ctx.runMutation(
      internal.cleanup.archivePastEvents,
      {},
    )
    const drafts = await ctx.runMutation(
      internal.cleanup.archiveStaleDrafts,
      {},
    )
    const items = await ctx.runMutation(internal.cleanup.purgeOldItems, {})
    return {
      eventsArchived: events.archived,
      draftsArchived: drafts.archived,
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
    const draftCutoff = now - STALE_DRAFT_AGE_MS
    const staleDrafts = await ctx.db
      .query("articles")
      .withIndex("by_status_created", (q) =>
        q.eq("status", "pending_review").lt("createdAt", draftCutoff),
      )
      .take(50)
    return {
      eventsToArchive,
      staleDrafts: staleDrafts.length,
    }
  },
})
