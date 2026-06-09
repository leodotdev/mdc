// Self-running schedule. Convex evaluates this on every push and rewires
// the live cron table; deleting an entry here removes the schedule on
// next deploy. Each cron triggers an internalAction (no auth context) —
// individual LLM calls inside still pass through `internal.budget.reserve`
// to stay within the $20/month cap.
//
// Cadence rationale (W2 — mega-desk):
//   Every 1 hour = 24 ticks/day × 1 Opus call ≈ $1.50-$3.00/day, gated
//   by the daily budget cap (raised to match). High cadence keeps the
//   site feeling live — the average lag from "source publishes" to
//   "event onsite" drops to ~30 min instead of ~2h. Budget gate skips
//   later runs gracefully if a busy news day spikes call cost.
//
// Cadence rationale (W4 — image watchdog): every 6h is enough to catch
// hotlink-protection breakage shortly after publication. Cheap (no LLM).
//
// Cadence rationale (W6 — cleanup): once a day at 04:00 ET when traffic
// is lowest. Idempotent.
//
// Cadence rationale (W5 — source health daily, source discovery weekly):
//   Source health is cheap; weekly discovery uses the LLM so it's bounded.

import { cronJobs } from "convex/server"
import { internal } from "./_generated/api"

const crons = cronJobs()

// W2 — Mega-desk 3x daily (06:00 / 12:00 / 18:00 ET). Per-source
// fetches are scheduled as individual actions inside the tick to
// avoid the 64 MB OOM that happened when all 95 sources ran in one
// process. Three windows per day matches editor expectations and
// keeps Mapbox/Cloudflare/Haiku spend bounded. UTC offsets straddle
// DST: 10/16/22 UTC = 06/12/18 ET during EDT (and 05/11/17 ET during
// EST, which is fine — still spread across the day).
// W2 — Mega-desk every 6 hours. 4 ticks/day evenly spaced means no
// single source is ever >6h stale, even across the overnight ET gap.
// The per-source refresh fan-out + drain pattern keeps each tick
// bounded by ~3 min total wall time.
crons.interval(
  "mega desk",
  { hours: 6 },
  internal.agents.cronRunMegaDesk,
  {},
)

// W2.5 — Run watchdog every 15 minutes. Writes a `systemAlerts` row
// when the most-recent agentRun is older than 90 min so a stalled
// deploy is visible on the admin dashboard.
crons.interval(
  "run watchdog",
  { minutes: 15 },
  internal.systemAlerts.cronWatchdogTick,
  {},
)

// W4 — Probe hero images every 6 hours.
crons.interval(
  "image watchdog",
  { hours: 6 },
  internal.imageWatchdog.cronTick,
  {},
)

// W6 — Daily cleanup at 04:00 Miami time (08:00 UTC during EDT, 09:00 UTC
// during EST). Convex cron uses UTC; we pick 09:00 UTC so it always fires
// in the early-morning window regardless of DST.
crons.daily(
  "daily cleanup",
  { hourUTC: 9, minuteUTC: 0 },
  internal.cleanup.cronTick,
  {},
)

// W5 — Source health every 4 hours. Auto-disables feeds that hit the
// consecutive-error cap so the mega-desk stops wasting fetches on dead
// URLs. Tighter than daily so quarantine actually kicks in within a
// single day's outage.
crons.interval(
  "source health",
  { hours: 4 },
  internal.sourceHealth.cronHealthTick,
  {},
)

// W7 (dedup pass), W8 (merge sweep), and the article translation
// backfill were removed with the article-era purge. Event-side dedup
// runs inline in `events.insertExtracted`; events have their own
// translation backfill below.
crons.interval(
  "translate events backfill",
  { hours: 6 },
  internal.events.bulkTranslateEventsInternal,
  { maxEvents: 10 },
)
// Enrichment backfill — every 6h drains events the deterministic
// ingest inserted with empty tags (either the source had no
// structured tags, or the on-publish Haiku enrichment was budget-
// blocked). Cheap Haiku calls; budget-gated.
crons.interval(
  "enrich events backfill",
  { hours: 6 },
  internal.events.bulkEnrichEventsInternal,
  { maxEvents: 10 },
)

// Coverage SLA — daily. Counts events per section in the last 14d,
// patches eventsLast14d, and writes/resolves systemAlerts rows for
// sections below their minEventsLast14d floor.
crons.daily(
  "coverage sla",
  { hourUTC: 9, minuteUTC: 15 },
  internal.coverage.cronTick,
  {},
)

// Recurrence expansion — nightly. Computes the next 30 days of
// occurrences for every recurring event and stores them on the row.
// Cheap (pure date math), idempotent.
crons.daily(
  "recurrence expansion",
  { hourUTC: 8, minuteUTC: 45 },
  internal.recurrence.cronTick,
  {},
)

// Source discovery — weekly Monday 06:00 UTC. Walks recent events,
// collects unique citation/event-URL hostnames, surfaces any that
// aren't already a source as a `sourceSuggestions` row. Cheap (no
// LLM) and editor-gated — discovered rows still need approval in
// /admin/sources before they're ingested.
crons.weekly(
  "source discovery",
  { dayOfWeek: "monday", hourUTC: 6, minuteUTC: 0 },
  internal.discovery.weeklyTick,
  {},
)

// Right-rail widgets — daily Opus batch at 04:30 ET (08:30 UTC during
// EDT). Single call, ~7-12¢, produces fun-fact / on-this-day / landmark
// / animal-fact / quote entries for the homepage right rail.
crons.daily(
  "daily widget refresh",
  { hourUTC: 8, minuteUTC: 30 },
  internal.widgets.dailyRefresh,
  {},
)

// Popularity rollup — daily at 03:30 ET (07:30 UTC during EDT).
// Counts trailing-30d views per event from `eventViews`, patches the
// denormalized `events.viewCount30d`, prunes the log. The Popular
// rail reads the denormalized counter; this is what makes it sortable
// in O(log n) instead of an N-event aggregation per request.
crons.daily(
  "popularity rollup",
  { hourUTC: 7, minuteUTC: 30 },
  internal.popularity.cronTick,
  {},
)

export default crons
