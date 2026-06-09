import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useConvex } from "convex/react"
import {
  AlertTriangle,
  ExternalLink,
  Trash2,
} from "lucide-react"

import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { relativeTime } from "@/lib/dates"
import { cn } from "@/lib/utils"

// /admin — mission control. Three things, no more:
//
//   1. STATUS STRIP   one-line health summary (cron / events / budget)
//   2. REVIEW QUEUE   pending events the editor needs to triage, inline
//   3. RIGHT RAIL     coverage gaps · activity feed · discovery suggestions
//
// Settings (daily budget cap, ads toggle) and all the article-era
// telemetry (sparklines, anomalies, merges, translation backlog,
// recently-published list, local stats) moved off this page with the
// article-purge cleanup. Manual trigger cards replaced by the Cmd+K
// command palette mounted on the _admin layout.

export const Route = createFileRoute("/_admin/admin/")({
  component: DashboardPage,
})

function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <StatusStrip />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <PublishedTodayColumn />
        <RightRail />
      </div>
    </div>
  )
}

// ── Status strip ────────────────────────────────────────────────────────
function StatusStrip() {
  const summary = useQuery(convexQuery(api.agentRuns.megaSummary, {}))
  const budget = useQuery(convexQuery(api.budget.today, {}))
  const alerts = useQuery(convexQuery(api.systemAlerts.unresolvedCount, {}))
  const settings = useQuery(convexQuery(api.siteSettings.get, {}))

  const lastRunLabel = summary.data
    ? summary.data.status === "succeeded"
      ? `Last run ${relativeTime(summary.data.finishedAt ?? summary.data.startedAt)}`
      : summary.data.status === "running"
        ? "Run in progress…"
        : summary.data.status === "failed"
          ? `Last run FAILED ${relativeTime(summary.data.startedAt)}`
          : `Last run skipped ${relativeTime(summary.data.startedAt)}`
    : "No runs yet"
  const lastRunDot =
    summary.data?.status === "succeeded"
      ? "bg-emerald-500"
      : summary.data?.status === "failed"
        ? "bg-destructive"
        : summary.data?.status === "running"
          ? "bg-blue-500 animate-pulse"
          : "bg-muted-foreground"

  const budgetPct = budget.data
    ? Math.min(100, (budget.data.centsSpent / budget.data.capCents) * 100)
    : 0

  return (
    <header className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-sans text-2xl font-semibold tracking-[-0.02em]">
          miami.community
        </h1>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="inline-flex items-center gap-2">
            <span className={cn("size-2 rounded-full", lastRunDot)} />
            <Link
              to="/admin/runs"
              className="text-muted-foreground hover:text-foreground"
            >
              {lastRunLabel}
            </Link>
          </span>
          {budget.data ? (
            <span
              className="inline-flex items-center gap-2"
              title={`Daily cap $${(budget.data.capCents / 100).toFixed(2)}`}
            >
              <span className="meta text-xs tabular-nums">
                ${(budget.data.centsSpent / 100).toFixed(2)} / $
                {(budget.data.capCents / 100).toFixed(2)}
              </span>
              <span className="block h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                <span
                  className={cn(
                    "block h-full rounded-full",
                    budget.data.overBudget
                      ? "bg-destructive"
                      : "bg-foreground/70",
                  )}
                  style={{ width: `${budgetPct}%` }}
                />
              </span>
            </span>
          ) : null}
          {alerts.data && alerts.data > 0 ? (
            <span className="text-destructive inline-flex items-center gap-1">
              <AlertTriangle className="size-3.5" />
              {alerts.data} alert{alerts.data === 1 ? "" : "s"}
            </span>
          ) : null}
          {settings.data && settings.data.llmEnabled === false ? (
            <Link
              to="/admin/settings"
              className="inline-flex items-center gap-1 text-amber-600"
              title="LLM is OFF (Lights Out)"
            >
              <span className="size-2 rounded-full bg-amber-500" />
              LLM off
            </Link>
          ) : null}
          <Link
            to="/admin/sources"
            className="text-muted-foreground hover:text-foreground"
          >
            Sources →
          </Link>
        </div>
      </div>
    </header>
  )
}

// ── Published today (main column) ───────────────────────────────────────
// The review queue is gone now that everything auto-approves. This rail
// shows the most-recently-published events so the editor can spot-check
// what's flowing without needing to act on anything.
function PublishedTodayColumn() {
  const convex = useConvex()
  const queryClient = useQueryClient()
  const recent = useQuery(convexQuery(api.events.upcoming, { limit: 25 }))
  const refetch = () =>
    queryClient.invalidateQueries({
      queryKey: convexQuery(api.events.upcoming, { limit: 25 }).queryKey,
    })
  const remove = useMutation({
    mutationFn: async (id: Id<"events">) =>
      await convex.mutation(api.events.remove, { id }),
    onSuccess: refetch,
  })

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-sans text-lg font-semibold tracking-[-0.01em]">
          Latest published
        </h2>
        <Link
          to="/admin/published"
          className="meta text-xs hover:text-foreground"
        >
          Open full list ↗
        </Link>
      </div>
      {recent.data === undefined ? (
        <p className="meta text-sm">Loading…</p>
      ) : recent.data.length === 0 ? (
        <p className="meta rounded-md border bg-card p-6 text-center text-sm">
          No events yet. Run an ingest tick from the Cmd+K palette.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-md border bg-card divide-y">
          {recent.data.map((e) => (
            <li
              key={e._id}
              className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30"
            >
              <div className="min-w-0 flex-1">
                <p className="font-sans line-clamp-1 text-sm font-medium">
                  {e.title}
                </p>
                <p className="meta mt-0.5 line-clamp-1 text-xs">
                  {e.section?.name ?? "—"}
                  {e.locationName ? ` · ${e.locationName}` : null}
                  {typeof e.qualityScore === "number"
                    ? ` · score ${e.qualityScore.toFixed(2)}`
                    : null}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {e.url ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    title="Open source"
                    aria-label="Open source"
                    render={
                      <a href={e.url} target="_blank" rel="noreferrer" />
                    }
                  >
                    <ExternalLink className="size-3.5" />
                  </Button>
                ) : null}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title="Delete"
                  aria-label="Delete"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm(`Delete "${e.title}"?`)) {
                      remove.mutate(e._id)
                    }
                  }}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── Right rail ─────────────────────────────────────────────────────────
function RightRail() {
  return (
    <aside className="flex flex-col gap-6">
      <StaleSourcesPanel />
      <CoverageGapsPanel />
      <ActivityPanel />
      <DiscoveryPanel />
    </aside>
  )
}

function StaleSourcesPanel() {
  const stale = useQuery(convexQuery(api.sourceHealth.staleSources, {}))
  return (
    <section className="rounded-md border bg-card">
      <PanelHeader
        title="Stale sources"
        sub="haven't refreshed in 12h+ (retry auto-scheduled hourly)"
      />
      {stale.data === undefined ? (
        <p className="meta px-4 py-3 text-xs">Loading…</p>
      ) : stale.data.length === 0 ? (
        <p className="meta px-4 py-3 text-xs">
          Every enabled source refreshed in the last 12h.
        </p>
      ) : (
        <ul className="divide-y text-sm">
          {stale.data.slice(0, 8).map((s) => {
            const age = s.lastFetchedAt
              ? relativeTime(s.lastFetchedAt)
              : "never"
            return (
              <li
                key={s._id}
                className="flex items-center justify-between gap-3 px-4 py-2"
              >
                <span className="truncate text-xs">
                  <span className="font-medium">{s.name}</span>
                  <span className="meta ml-2">{age}</span>
                </span>
                <Link
                  to="/admin/sources"
                  className="meta text-[0.65rem] hover:underline"
                >
                  open →
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function CoverageGapsPanel() {
  const gaps = useQuery(convexQuery(api.coverage.undercovered, {}))
  return (
    <section className="rounded-md border bg-card">
      <PanelHeader title="Coverage gaps" sub="sections below 14d floor" />
      {gaps.data === undefined ? (
        <p className="meta px-4 py-3 text-xs">Loading…</p>
      ) : gaps.data.length === 0 ? (
        <p className="meta px-4 py-3 text-xs">
          Every section is at or above its floor.
        </p>
      ) : (
        <ul className="divide-y text-sm">
          {gaps.data.slice(0, 8).map((g) => (
            <li
              key={g._id}
              className="flex items-center justify-between gap-3 px-4 py-2"
            >
              <Link
                to="/section/$slug"
                params={{ slug: g.slug }}
                className="font-medium hover:underline"
              >
                {g.name}
              </Link>
              <span className="meta text-xs tabular-nums">
                <span className="text-destructive">{g.actual}</span>
                <span className="text-muted-foreground"> / {g.floor}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ActivityPanel() {
  const feed = useQuery(convexQuery(api.activity.recent, { limit: 15 }))
  return (
    <section className="rounded-md border bg-card">
      <PanelHeader title="Activity" sub="last 7 days" />
      {feed.data === undefined ? (
        <p className="meta px-4 py-3 text-xs">Loading…</p>
      ) : feed.data.length === 0 ? (
        <p className="meta px-4 py-3 text-xs">No recent activity.</p>
      ) : (
        <ul className="max-h-[24rem] divide-y overflow-y-auto text-sm">
          {feed.data.map((entry, i) => {
            const dot =
              entry.status === "ok"
                ? "bg-emerald-500"
                : entry.status === "warn"
                  ? "bg-amber-500"
                  : entry.status === "error"
                    ? "bg-destructive"
                    : "bg-muted-foreground"
            const Inner = (
              <div className="flex items-start gap-2 px-4 py-2">
                <span
                  className={cn(
                    "mt-1.5 inline-block size-1.5 shrink-0 rounded-full",
                    dot,
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-xs leading-snug">
                    {entry.label}
                  </p>
                  <p className="meta mt-0.5 text-[0.65rem] tabular-nums">
                    {relativeTime(entry.ts)}
                  </p>
                </div>
              </div>
            )
            return (
              <li key={`${entry.ts}-${i}`} className="hover:bg-muted/30">
                {entry.href ? (
                  <a
                    href={entry.href}
                    target={
                      entry.href.startsWith("/") ? "_self" : "_blank"
                    }
                    rel={
                      entry.href.startsWith("/") ? undefined : "noreferrer"
                    }
                  >
                    {Inner}
                  </a>
                ) : (
                  Inner
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function DiscoveryPanel() {
  const suggestions = useQuery(
    convexQuery(api.discovery.listSuggestions, {}),
  )
  return (
    <section className="rounded-md border bg-card">
      <PanelHeader
        title="Discovered domains"
        sub="seen in event citations, not yet a source"
      />
      {suggestions.data === undefined ? (
        <p className="meta px-4 py-3 text-xs">Loading…</p>
      ) : suggestions.data.length === 0 ? (
        <p className="meta px-4 py-3 text-xs">
          No new domains in the last 14 days.
        </p>
      ) : (
        <ul className="divide-y text-sm">
          {suggestions.data.slice(0, 6).map((s) => (
            <li
              key={s._id}
              className="flex items-center justify-between gap-3 px-4 py-2"
            >
              <span className="truncate text-xs">
                <span className="font-medium">{s.domain}</span>
                <span className="meta ml-2">
                  {s.eventCount} event{s.eventCount === 1 ? "" : "s"}
                </span>
              </span>
              <Link
                to="/admin/sources"
                className="meta text-[0.65rem] hover:underline"
              >
                review →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function PanelHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="border-b px-4 py-2">
      <h3 className="font-sans text-sm font-semibold">{title}</h3>
      <p className="meta text-xs">{sub}</p>
    </div>
  )
}
