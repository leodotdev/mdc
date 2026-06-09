// Source health — daily auto-disable of failing sources + rolling
// 30-day event-yield counter. The cron tick:
//   1. Recomputes `eventsLast30d` + `lastEventAt` per source by
//      walking the events table once.
//   2. Disables sources that look broken (5+ consecutive errors) or
//      genuinely silent (no events in 30d AND >= 10 fetches done).
//   3. Bumps poll cadence on high-yield sources (>=20 events/30d) so
//      the firehose feeds get scanned more often.

import { internal } from "./_generated/api"
import {
  internalAction,
  internalMutation,
  query,
} from "./_generated/server"
import { requireEditor } from "./lib/guard"

// Lower than the legacy 10 because the mega-desk now polls every
// 30 min — 5 consecutive errors at that cadence is 2.5h of failing,
// plenty of signal to disable.
const ERROR_CAP = 5
const STALE_INSERTS_MS = 14 * 24 * 3_600_000 // 14d
const SILENT_WINDOW_MS = 30 * 24 * 3_600_000 // 30d
const SILENT_FETCH_MIN = 10
const HIGH_YIELD_THRESHOLD = 20
const HIGH_YIELD_POLL_MINUTES = 15
// Twice the 6h mega-desk cron interval. Anything older than this on
// an enabled source means the per-source refresh action failed silently
// across at least one full tick (timeout, OOM in the adapter, etc.).
const STALE_SOURCE_MS = 12 * 3_600_000

export const cronHealthTick = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    scanned: number
    disabledForErrors: number
    disabledForInactivity: number
    disabledForSilence: number
    promoted: number
    yieldRefreshed: number
  }> => {
    const yieldStats = await ctx.runMutation(
      internal.sourceHealth.refreshEventYields,
      {},
    )
    const dis = await ctx.runMutation(
      internal.sourceHealth.disableUnhealthy,
      {},
    )
    // Stale retry runs on the same tick so any source that missed the
    // last mega-desk window gets a one-off refresh + a systemAlerts
    // entry if the cluster of stragglers is unusually large.
    await ctx.runMutation(internal.sourceHealth.retryStaleSources, {})
    return { ...dis, ...yieldStats }
  },
})

// Recompute eventsLast30d + lastEventAt for every source. Walks events
// in the trailing 30d window once, joins via derivedFromItems[0] →
// sourceId. Cheap enough to run nightly given the dataset size; if
// events grow past ~50k we'd want to maintain the counters
// incrementally at insert/delete instead.
export const refreshEventYields = internalMutation({
  args: {},
  handler: async (ctx) => {
    const sinceMs = Date.now() - SILENT_WINDOW_MS
    const events = await ctx.db
      .query("events")
      .withIndex("by_status_published", (q) => q.eq("status", "approved"))
      .order("desc")
      .take(5000)
    type Stat = { count: number; lastEventAt: number }
    const stats = new Map<string, Stat>()
    for (const e of events) {
      const itemId = e.derivedFromItems?.[0]
      if (!itemId) continue
      const item = await ctx.db.get(itemId)
      if (!item) continue
      const sid = item.sourceId as unknown as string
      const ts = e.publishedAt ?? e.createdAt
      const s = stats.get(sid)
      if (!s) {
        stats.set(sid, { count: 0, lastEventAt: ts })
      }
      const stat = stats.get(sid)!
      if (ts >= sinceMs) stat.count += 1
      if (ts > stat.lastEventAt) stat.lastEventAt = ts
    }
    const sources = await ctx.db.query("sources").collect()
    let yieldRefreshed = 0
    let promoted = 0
    for (const src of sources) {
      const stat = stats.get(src._id as unknown as string)
      const prevYield = src.eventsLast30d ?? 0
      const nextYield = stat?.count ?? 0
      const nextLastEventAt = stat?.lastEventAt ?? src.lastEventAt
      // Promote high-yield sources to faster polling once. Don't
      // demote silent sources here — disableUnhealthy handles that.
      const shouldPromote =
        nextYield >= HIGH_YIELD_THRESHOLD &&
        (src.pollIntervalMinutes ?? 60) > HIGH_YIELD_POLL_MINUTES &&
        src.enabled
      if (
        prevYield === nextYield &&
        nextLastEventAt === src.lastEventAt &&
        !shouldPromote
      ) {
        continue
      }
      const patch: Record<string, unknown> = {
        eventsLast30d: nextYield,
      }
      if (nextLastEventAt !== undefined) {
        patch.lastEventAt = nextLastEventAt
      }
      if (shouldPromote) {
        patch.pollIntervalMinutes = HIGH_YIELD_POLL_MINUTES
        promoted += 1
      }
      await ctx.db.patch(src._id, patch)
      yieldRefreshed += 1
    }
    return { yieldRefreshed, promoted }
  },
})

export const disableUnhealthy = internalMutation({
  args: {},
  handler: async (ctx) => {
    const sources = await ctx.db.query("sources").collect()
    const now = Date.now()
    let disabledForErrors = 0
    let disabledForInactivity = 0
    let disabledForSilence = 0
    for (const s of sources) {
      if (!s.enabled) continue
      const tooManyErrors = (s.consecutiveErrors ?? 0) >= ERROR_CAP
      // "Inactive" = source has been around long enough to fetch (have a
      // lastFetchedAt) AND its lastFetchedAt is older than the freshness
      // window AND it never inserted anything new in that window. Filters
      // out brand-new sources that just haven't run yet.
      const inactive =
        s.lastFetchedAt &&
        now - s.lastFetchedAt > STALE_INSERTS_MS &&
        (s.lastFetchNewCount ?? 0) === 0
      // "Silent" = source is OLD (≥30 days since creation, plenty of
      // fetch ticks), has refreshed event-yields, and produced ZERO
      // events in the last 30 days. Distinct from inactive: silent
      // sources can be returning 200s + items, but those items don't
      // pass the event-shape filter (no startsAt / no location). Their
      // adapter type is probably wrong or the page changed shape.
      const ageMs = now - s._creationTime
      const silent =
        ageMs >= SILENT_WINDOW_MS &&
        s.eventsLast30d !== undefined &&
        s.eventsLast30d === 0 &&
        (s.consecutiveErrors ?? 0) === 0
      void SILENT_FETCH_MIN
      if (!tooManyErrors && !inactive && !silent) continue
      let reason: string
      if (tooManyErrors) {
        reason = `${s.consecutiveErrors ?? 0} consecutive errors`
        disabledForErrors += 1
      } else if (silent && !inactive) {
        reason = "0 events in 30d — check adapter type"
        disabledForSilence += 1
      } else {
        reason = `no new items in ${Math.round(STALE_INSERTS_MS / (24 * 3_600_000))}d`
        disabledForInactivity += 1
      }
      await ctx.db.patch(s._id, {
        enabled: false,
        autoDisabledAt: now,
        autoDisabledReason: reason,
      })
    }
    return {
      scanned: sources.length,
      disabledForErrors,
      disabledForInactivity,
      disabledForSilence,
    }
  },
})

// ── Stale-source watchdog ────────────────────────────────────────────
// Surfaces enabled sources whose lastFetchedAt is older than 12h (twice
// the cron interval) so the editor can see when individual adapter
// actions are silently failing. The remediation action below retries
// each stale source by scheduling a one-off refreshOneSource call.

export const staleSources = query({
  args: {},
  handler: async (ctx) => {
    await requireEditor(ctx)
    const cutoff = Date.now() - STALE_SOURCE_MS
    const all = await ctx.db.query("sources").collect()
    return all
      .filter(
        (s) =>
          s.enabled &&
          !s.url.startsWith("feeder://") &&
          (s.lastFetchedAt === undefined || s.lastFetchedAt < cutoff),
      )
      .map((s) => ({
        _id: s._id,
        name: s.name,
        url: s.url,
        type: s.type,
        lastFetchedAt: s.lastFetchedAt,
        lastFetchError: s.lastFetchError,
      }))
      .sort(
        (a, b) =>
          (a.lastFetchedAt ?? 0) - (b.lastFetchedAt ?? 0),
      )
  },
})

// Retries every stale source by scheduling a refreshOneSource action.
// Runs on the same cron interval as cronHealthTick — anything that
// missed the previous mega-desk tick gets a second chance before the
// next one fires. Also writes a `systemAlerts` row when ≥3 sources
// are stale, so the dashboard surfaces the regression even when the
// cron itself looks healthy.
export const retryStaleSources = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number; alerted: boolean }> => {
    const now = Date.now()
    const cutoff = now - STALE_SOURCE_MS
    const all = await ctx.db.query("sources").collect()
    const stale = all.filter(
      (s) =>
        s.enabled &&
        !s.url.startsWith("feeder://") &&
        (s.lastFetchedAt === undefined || s.lastFetchedAt < cutoff),
    )
    for (let i = 0; i < stale.length; i += 1) {
      await ctx.scheduler.runAfter(
        i * 1500,
        internal.agents.refreshOneSource,
        { sourceId: stale[i]._id },
      )
    }
    // Alert when ≥3 sources are stale — single stragglers happen and
    // self-heal, but a cluster means something broke in the cron path.
    let alerted = false
    if (stale.length >= 3) {
      const kind = "sources:stale"
      const existing = await ctx.db
        .query("systemAlerts")
        .withIndex("by_kind", (q) => q.eq("kind", kind))
        .filter((q) => q.eq(q.field("resolvedAt"), undefined))
        .first()
      const message = `${stale.length} enabled sources haven't refreshed in 12h+ — retry scheduled. Examples: ${stale
        .slice(0, 3)
        .map((s) => s.name)
        .join(", ")}`
      if (existing) {
        await ctx.db.patch(existing._id, { message, createdAt: now })
      } else {
        await ctx.db.insert("systemAlerts", {
          kind,
          severity: "warning",
          message,
          createdAt: now,
        })
      }
      alerted = true
    } else {
      // Auto-resolve a previous alert once the count drops.
      const existing = await ctx.db
        .query("systemAlerts")
        .withIndex("by_kind", (q) => q.eq("kind", "sources:stale"))
        .filter((q) => q.eq(q.field("resolvedAt"), undefined))
        .first()
      if (existing) {
        await ctx.db.patch(existing._id, { resolvedAt: now })
      }
    }
    return { scheduled: stale.length, alerted }
  },
})

export const retryStaleSourcesAction = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number; alerted: boolean }> => {
    return await ctx.runMutation(internal.sourceHealth.retryStaleSources, {})
  },
})
