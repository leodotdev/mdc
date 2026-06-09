// Recurrence expansion. Daily cron that walks every approved event
// with a recurrenceRule, computes the next ~30 days of occurrences,
// and stores them on the event row as `recurrenceInstances`. Lets
// the renderer surface "next 3 dates" without re-parsing RRULEs on
// every page load, and gives future date-range queries an indexed
// path to recurring events without spawning N row-per-instance
// duplicates.

import { internal } from "./_generated/api"
import { internalAction, internalMutation } from "./_generated/server"
import { nextOccurrences } from "./lib/rrule"

const HORIZON_DAYS = 30
const MAX_INSTANCES = 60

export const cronTick = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ scanned: number; updated: number }> => {
    return await ctx.runMutation(internal.recurrence.expandTick, {})
  },
})

export const expandTick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const horizon = now + HORIZON_DAYS * 24 * 3_600_000
    const events = await ctx.db
      .query("events")
      .withIndex("by_status_published", (q) => q.eq("status", "approved"))
      .order("desc")
      .take(3000)
    let scanned = 0
    let updated = 0
    for (const e of events) {
      if (!e.recurrenceRule) continue
      scanned += 1
      // Walk forward starting from the event's own `startsAt`; clip
      // to the horizon window. nextOccurrences honors COUNT/UNTIL,
      // so we don't need to bound further.
      const all = nextOccurrences(e.recurrenceRule, e.startsAt, MAX_INSTANCES)
      const inWindow = all.filter((t) => t >= now && t <= horizon)
      const prev = e.recurrenceInstances ?? []
      const same =
        prev.length === inWindow.length &&
        prev.every((t, i) => t === inWindow[i])
      if (same) continue
      await ctx.db.patch(e._id, { recurrenceInstances: inWindow })
      updated += 1
    }
    return { scanned, updated }
  },
})
