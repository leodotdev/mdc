// Source health — daily auto-disable of failing sources. The companion
// auto-discovery system was removed: source curation is manual through
// the /admin/sources UI now. The remaining cron just turns off feeds
// that have been broken (≥10 consecutive errors) or stale (no inserts
// in 14 days) so the editor sees only live sources without having to
// chase them down.

import { internal } from "./_generated/api"
import { internalAction, internalMutation } from "./_generated/server"

// Lower than the legacy 10 because the mega-desk now polls every
// 30 min — 5 consecutive errors at that cadence is 2.5h of failing,
// plenty of signal to disable.
const ERROR_CAP = 5
const STALE_INSERTS_MS = 14 * 24 * 3_600_000 // 14d

export const cronHealthTick = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    scanned: number
    disabledForErrors: number
    disabledForInactivity: number
  }> => {
    const result = await ctx.runMutation(
      internal.sourceHealth.disableUnhealthy,
      {},
    )
    return result
  },
})

export const disableUnhealthy = internalMutation({
  args: {},
  handler: async (ctx) => {
    const sources = await ctx.db.query("sources").collect()
    const now = Date.now()
    let disabledForErrors = 0
    let disabledForInactivity = 0
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
      if (!tooManyErrors && !inactive) continue
      const reason = tooManyErrors
        ? `${s.consecutiveErrors ?? 0} consecutive errors`
        : `no new items in ${Math.round(STALE_INSERTS_MS / (24 * 3_600_000))}d`
      await ctx.db.patch(s._id, {
        enabled: false,
        autoDisabledAt: now,
        autoDisabledReason: reason,
      })
      if (tooManyErrors) disabledForErrors += 1
      else disabledForInactivity += 1
    }
    return {
      scanned: sources.length,
      disabledForErrors,
      disabledForInactivity,
    }
  },
})
