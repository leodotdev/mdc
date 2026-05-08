// Daily LLM budget tracker. Crons + actions call `internal.budget.reserve`
// before each LLM call; over-cap reservations return `{ allowed: false }`
// and the caller logs "Skipped LLM call — daily budget hit" and bails.
//
// Estimates were too low under Opus + 200-item batches and the system
// burned $25/12h before we caught it. Bumped after that incident:
//   - Sonnet 4.6 mega-desk run (50 items, ~20 articles output): ~$0.10
//   - Sonnet 4.6 translation: ~$0.01
//   - Haiku merge verification: ~$0.01
//   - Opus 4.7 (any caller): kept high so anything still on Opus
//     trips the gate aggressively.
//
// The cap is enforced before the call, not after — and our estimates
// are a hard ceiling for what the gate counts, so being generous with
// the estimate is the safe direction.
export const BUDGET_DAILY_CENTS = 250
export const BUDGET_WARNING_CENTS = 200 // toast warning threshold

// Conservative cents-per-call estimate by model. Used to deduct from the
// budget before the LLM call.
export function estimatedCallCents(model: string): number {
  // Opus at 50-item input + 20-article output ≈ 15-20¢. Estimate
  // generously so the gate trips before runaway burst.
  if (model.startsWith("claude-opus")) return 20 // ~$0.20
  if (model.startsWith("claude-haiku")) return 1
  // Sonnet — mega-desk's primary model. ~10¢ per 50-item batch is a
  // realistic upper bound; small calls (translation, single-article
  // expansion) come in well under this and the over-estimate just
  // means they count more conservatively against the daily cap.
  return 10
}

// Miami-time YYYY-MM-DD key for budget bucketing.
export function todayDayKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}
