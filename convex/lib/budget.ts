// Daily LLM budget tracker. Crons + actions call `internal.budget.reserve`
// before each LLM call; over-cap reservations return `{ allowed: false }`
// and the caller logs "Skipped LLM call — daily budget hit" and bails.
//
// Cost estimates per call (Anthropic pricing as of 2026-Q2):
//   - Sonnet 4.6 draft: ~$0.014 (~3.5k input + 600 output tokens)
//   - Sonnet 4.6 translation: ~$0.005
//   - Haiku merge verification: ~$0.005
//   - Opus 4.7 mega-desk run: ~$0.07-0.15 depending on item count
//
// Cap is soft — once tripped, downstream LLM calls no-op until next
// day. The mega-desk's 1h cadence + the merge-sweep + daily widget
// refresh together typically land at $1.80–2.50/day.

// $2.50/day ≈ $75/month. Sized for a 1h-cadence mega-desk (24 runs/day)
// using Opus 4.7. With per-run cost averaging 7-12¢, real spend lands
// around $1.80-$2.50/day — the cap is the ceiling, not the target. On
// burst-y news days the gate kicks in mid-day and later runs no-op
// gracefully.
export const BUDGET_DAILY_CENTS = 250
export const BUDGET_WARNING_CENTS = 200 // toast warning threshold

// Conservative cents-per-call estimate by model. Used to deduct from the
// budget before the LLM call (we don't see actual usage tokens until
// after, and most calls are within ±30% of these values).
export function estimatedCallCents(model: string): number {
  if (model.startsWith("claude-opus")) return 7 // ~$0.07
  if (model.startsWith("claude-haiku")) return 1 // ~$0.005-0.01
  // Sonnet + everything else
  return 2 // ~$0.014-0.02
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
