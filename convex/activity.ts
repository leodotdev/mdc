// Chronological activity feed for the admin dashboard. Merges three
// signals into one normalized stream:
//
//   1. Mega-desk runs       — cron started / succeeded / failed / skipped
//   2. System alerts        — anything written to `systemAlerts`
//                              (coverage SLA, stale runs, etc.)
//   3. Recent event approvals — qualityScore-routed events landing live
//                                (synthesized from events.publishedAt)
//
// Each entry shares the same shape so the dashboard can render a single
// vertical timeline without per-source branching.

import { v } from "convex/values"
import { query } from "./_generated/server"
import { requireEditor } from "./lib/guard"

export type ActivityEntry = {
  ts: number
  kind: "cron" | "alert" | "event"
  /** One-line human-readable summary. Short enough for a list row. */
  label: string
  /** Status tag used for color: "ok" / "warn" / "error" / "info". */
  status: "ok" | "warn" | "error" | "info"
  /** Optional in-app link the row should navigate to on click. */
  href?: string
}

export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }): Promise<Array<ActivityEntry>> => {
    await requireEditor(ctx)
    const cap = limit ?? 30
    const sinceMs = Date.now() - 7 * 24 * 3_600_000

    // ── Cron runs ─────────────────────────────────────────────────────
    const runs = await ctx.db
      .query("agentRuns")
      .withIndex("by_started")
      .order("desc")
      .take(50)
    const runEntries: Array<ActivityEntry> = runs
      .filter((r) => r.startedAt >= sinceMs)
      .map((r) => {
        const ts = r.finishedAt ?? r.startedAt
        if (r.status === "succeeded") {
          return {
            ts,
            kind: "cron" as const,
            label: `Cron tick succeeded — ${r.itemsConsidered ?? 0} items considered`,
            status: "ok" as const,
            href: "/admin/runs",
          }
        }
        if (r.status === "failed") {
          return {
            ts,
            kind: "cron" as const,
            label: `Cron tick FAILED — ${(r.errorMessage ?? "no message").slice(0, 60)}`,
            status: "error" as const,
            href: "/admin/runs",
          }
        }
        if (r.status === "skipped") {
          return {
            ts,
            kind: "cron" as const,
            label: `Cron tick skipped — ${r.skippedReason ?? "no reason"}`,
            status: "info" as const,
            href: "/admin/runs",
          }
        }
        return {
          ts,
          kind: "cron" as const,
          label: `Cron tick running…`,
          status: "info" as const,
          href: "/admin/runs",
        }
      })

    // ── System alerts ────────────────────────────────────────────────
    const alerts = await ctx.db
      .query("systemAlerts")
      .withIndex("by_created")
      .order("desc")
      .take(30)
    const alertEntries: Array<ActivityEntry> = alerts
      .filter((a) => a.createdAt >= sinceMs)
      .map((a) => ({
        ts: a.createdAt,
        kind: "alert" as const,
        label: `${a.resolvedAt ? "Resolved: " : ""}${a.message}`,
        status:
          a.resolvedAt !== undefined
            ? ("ok" as const)
            : a.severity === "error"
              ? ("error" as const)
              : ("warn" as const),
      }))

    // ── Recent event approvals ───────────────────────────────────────
    const recentEvents = await ctx.db
      .query("events")
      .withIndex("by_status_published", (q) => q.eq("status", "approved"))
      .order("desc")
      .take(50)
    const eventEntries: Array<ActivityEntry> = recentEvents
      .filter((e) => (e.publishedAt ?? e.createdAt) >= sinceMs)
      .slice(0, 20)
      .map((e) => ({
        ts: e.publishedAt ?? e.createdAt,
        kind: "event" as const,
        label: `Event published: ${e.title.slice(0, 70)}`,
        status: "ok" as const,
        href: `/event/${e.slug ?? e._id}`,
      }))

    return [...runEntries, ...alertEntries, ...eventEntries]
      .sort((a, b) => b.ts - a.ts)
      .slice(0, cap)
  },
})
