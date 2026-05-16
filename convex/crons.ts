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
//   "story onsite" drops to ~30 min instead of ~2h. Budget gate skips
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

// W2 — Mega-desk every hour. Frequent enough that the front page
// reflects today's news; cheap enough at Sonnet pricing that 24
// runs/day stays well under the daily budget cap. The previous 30-min
// cadence + Opus combo burned ~$25/12h; this keeps daily spend in the
// $1–3 range. Budget gate caps spend; ticks that hit the cap write a
// "skipped" run row so /admin/runs makes the cap visible.
crons.interval(
  "run mega desk",
  { hours: 1 },
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

// W7 — Near-dup pass every 6 hours. Pure string + tag math, no LLM.
crons.interval(
  "dedup pass",
  { hours: 6 },
  internal.dedup.cronTick,
  {},
)

// W8 — Post-publish merge sweep every hour. Finds article pairs that
// share enough surface signal (citation URLs + title overlap), asks
// Haiku to verify, and absorbs verified duplicates into the canonical
// winner. Cross-section pairs are allowed — same incident filed under
// different sections is exactly what we need to catch. Cite-only
// merge: winner keeps title/dek/body, loser is archived with
// `mergedIntoId` + slug redirect.
crons.interval(
  "merge sweep",
  { hours: 1 },
  internal.articles.mergeSweep,
  {},
)

// Translation backfill — every 6h drains any published rows whose ES
// translation is missing or stale. The on-publish scheduler handles the
// hot path; this cron catches budget-capped, network-failed, or
// app-restart-orphaned rows so nothing stays untranslated.
crons.interval(
  "translate articles backfill",
  { hours: 6 },
  internal.articles.bulkTranslateInternal,
  { maxArticles: 10 },
)
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

// Right-rail widgets — daily Opus batch at 04:30 ET (08:30 UTC during
// EDT). Single call, ~7-12¢, produces fun-fact / on-this-day / landmark
// / animal-fact / quote entries for the homepage right rail.
crons.daily(
  "daily widget refresh",
  { hourUTC: 8, minuteUTC: 30 },
  internal.widgets.dailyRefresh,
  {},
)

export default crons
