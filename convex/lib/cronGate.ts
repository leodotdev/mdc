// Cron gate — flip `CRONS_ENABLED` to `"true"` on the deployment that
// should actually run scheduled LLM jobs. Default-off on dev so the
// per-developer Convex deployment doesn't double-spend the prod
// Anthropic key.
//
// Manual triggers (the /admin "Run now" buttons) bypass this — the
// gate only short-circuits cron-fired entry points.
//
// Set on prod with:
//   npx convex env set CRONS_ENABLED true --prod
// Leave unset (or "false") on dev.

export function cronsEnabled(): boolean {
  return process.env.CRONS_ENABLED === "true"
}
