import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import type { FunctionReturnType } from "convex/server"
import { useConvex } from "convex/react"
import {
  AlertTriangle,
  CircleDollarSign,
  FileText,
  ImageOff,
  Loader2,
  Play,
  Rss,
  Sparkles,
  Wrench,
} from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "sonner"

import { api } from "../../../convex/_generated/api"
import { CardCell, DashboardCard } from "@/components/admin/dashboard-card"
import { HeartbeatStrip } from "@/components/admin/heartbeat-strip"
import { Sparkline } from "@/components/admin/sparkline"
import { Thumb } from "@/components/admin/thumb"
import { ImportanceGauge } from "@/components/editorial/importance-gauge"
import { Switch } from "@/components/ui/switch"
import { relativeTime } from "@/lib/dates"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_admin/admin/")({
  component: DashboardPage,
})

// Mission control. The dashboard is observation-only — every panel here
// surfaces something the system did or is about to do, never something
// the editor needs to act on. Manual triggers exist as cron-overrides,
// not work queues.
//
// Layout: a single flat auto-fit grid of cards. No section groupings,
// no carousels — every flagged item, recently-published article, and
// manual trigger is its own card on the same grid as the system-summary
// tiles. The grid uses `auto-fit` + `minmax(min(100%, 18rem), 1fr)` so
// it picks up however many columns the viewport allows.
function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-sans text-3xl font-semibold tracking-[-0.02em]">
            Mission control
          </h1>
          <p className="meta mt-1 max-w-prose">
            miami.community runs on autopilot. Every panel below shows what the
            system just did, what it's spending, and where it's about to break.
            Nothing here is a to-do.
          </p>
        </div>
        <div className="flex flex-wrap items-stretch gap-2">
          <DailyBudgetControl />
          <AdsToggle />
          <MapViewToggle />
        </div>
      </header>

      <DashboardGrid />
    </div>
  )
}

function DashboardGrid() {
  const summary = useQuery(convexQuery(api.agentRuns.megaSummary, {}))
  const budget = useQuery(convexQuery(api.budget.today, {}))
  const budgetTrend = useQuery(convexQuery(api.budget.recent, {}))
  const articleSparkline = useQuery(
    convexQuery(api.articles.publishedSparkline24h, {}),
  )
  const eventSparkline = useQuery(
    convexQuery(api.events.createdSparkline24h, {}),
  )
  const sectionMix = useQuery(
    convexQuery(api.articles.publishedLast24hBySection, {}),
  )
  const sources = useQuery(convexQuery(api.sourcesData.list, {}))
  const brokenImages = useQuery(convexQuery(api.imageWatchdog.brokenCount, {}))
  const cleanupPending = useQuery(convexQuery(api.cleanup.pendingCleanup, {}))
  const recentDups = useQuery(convexQuery(api.dedup.recentDupActivity, {}))
  const mergesCount = useQuery(convexQuery(api.articles.mergedCount, {}))
  const recentMerges = useQuery(
    convexQuery(api.articles.recentMerges, { limit: 4 }),
  )
  const translationBacklog = useQuery(
    convexQuery(api.articles.needingTranslation, { limit: 20 }),
  )
  const recentRuns = useQuery(convexQuery(api.agentRuns.recent, { limit: 8 }))
  const articleAnomalies = useQuery(
    convexQuery(api.articles.recentAnomalies, { limit: 8 }),
  )
  const eventAnomalies = useQuery(
    convexQuery(api.events.recentAnomalies, { limit: 8 }),
  )
  const recentlyPublished = useQuery(
    convexQuery(api.articles.latest, { limit: 6 }),
  )
  const localStats = useQuery(convexQuery(api.widgets.localStats, {}))
  const systemAlerts = useQuery(convexQuery(api.systemAlerts.list, { limit: 5 }))

  const dayAgo = Date.now() - 24 * 3_600_000
  const failedRuns =
    recentRuns.data?.filter(
      (r) => r.status === "failed" && r.startedAt >= dayAgo,
    ) ?? []
  const erroringSources =
    sources.data?.filter(
      (s) => s.lastFetchStatus === "error" && s.enabled,
    ) ?? []
  const flaggedArticles = articleAnomalies.data ?? []
  const flaggedEvents = eventAnomalies.data ?? []
  const issueCount =
    failedRuns.length +
    erroringSources.length +
    flaggedArticles.length +
    flaggedEvents.length
  const enabledSources =
    sources.data?.filter((s) => s.enabled).length ?? 0
  const sectionsCovered = sectionMix.data?.length ?? 0

  const budgetPct = budget.data
    ? Math.min(100, (budget.data.centsSpent / budget.data.capCents) * 100)
    : 0

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-4">
      <HeartbeatStrip />

      {/* Pipeline */}
      <DashboardCard
        title="Pipeline"
        subtitle="Mega-desk run history"
        primary={
          summary.data
            ? `${summary.data.itemsConsidered}→${summary.data.draftsCreated}`
            : "—"
        }
        primarySub="items → drafts"
        subtext={
          summary.data
            ? summary.data.status === "running"
              ? "Run in progress…"
              : summary.data.status === "failed"
                ? `Failed · ${summary.data.errorMessage ?? "unknown"}`
                : summary.data.status === "skipped"
                  ? `Skipped · ${summary.data.skippedReason ?? "no work"}`
                  : `Last ran ${relativeTime(summary.data.startedAt)}`
            : "No runs yet"
        }
        to="/admin/runs"
        actionLabel="View runs"

      >
        {summary.data?.summary ? (
          <p className="meta line-clamp-2 rounded-md bg-muted/30 px-3 py-2 text-xs leading-snug">
            {summary.data.summary}
          </p>
        ) : null}
      </DashboardCard>

      {/* Today's spend */}
      <DashboardCard
        title="Today's spend"
        subtitle={
          budget.data
            ? `Daily cap $${(budget.data.capCents / 100).toFixed(2)}`
            : "Daily LLM budget"
        }
        primary={
          budget.data
            ? `$${(budget.data.centsSpent / 100).toFixed(2)}`
            : "—"
        }
        primarySub={
          budget.data
            ? `· ${budget.data.callsToday} call${budget.data.callsToday === 1 ? "" : "s"}`
            : ""
        }
        rightAccessory={<CircleDollarSign className="size-4" />}

      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full",
                  budget.data?.overBudget
                    ? "bg-destructive"
                    : "bg-foreground/70",
                )}
                style={{ width: `${budgetPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="meta text-[0.65rem] uppercase tracking-wider">
                {Math.round(budgetPct)}% used
              </span>
              <span className="meta text-[0.65rem]">
                {budget.data
                  ? `$${((budget.data.capCents - budget.data.centsSpent) / 100).toFixed(2)} left`
                  : ""}
              </span>
            </div>
          </div>
          {budgetTrend.data && budgetTrend.data.length > 1 ? (
            <div>
              <p className="meta text-[0.65rem] uppercase tracking-wider mb-1">
                Last 14 days
              </p>
              <Sparkline
                data={[...budgetTrend.data]
                  .reverse()
                  .map((r) => r.centsSpent)}
                variant="bars"
                width={240}
                height={36}
                highlightLast
                className="w-full text-foreground/70"
              />
            </div>
          ) : null}
        </div>
      </DashboardCard>

      {/* Output 24h */}
      <DashboardCard
        title="Output"
        subtitle="Last 24 hours of system throughput"
        primary={articleSparkline.data?.total ?? "—"}
        primarySub="stories"
        subtext={
          eventSparkline.data
            ? `${eventSparkline.data.total} events · ${sectionsCovered} sections`
            : undefined
        }
        rightAccessory={<FileText className="size-4" />}
        to="/admin/published"
        actionLabel="View all published"
      >
        <div className="flex flex-col gap-3">
          {articleSparkline.data ? (
            <Sparkline
              data={articleSparkline.data.buckets}
              variant="bars"
              width={240}
              height={48}
              highlightLast
              className="w-full text-foreground/70"
            />
          ) : null}
          {sectionMix.data && sectionMix.data.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {sectionMix.data.slice(0, 6).map((s) => (
                <span
                  key={s.slug}
                  className="rounded-full border border-foreground/10 bg-muted/30 px-2 py-0.5 text-[0.65rem] tabular-nums"
                  style={{ color: s.accent }}
                >
                  {s.name} · {s.count}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </DashboardCard>

      {/* Sources */}
      <DashboardCard
        title="Sources"
        subtitle="Feeds the mega-desk reads each run"
        primary={enabledSources}
        primarySub="enabled"
        subtext={
          erroringSources.length > 0
            ? `${erroringSources.length} erroring · investigate below`
            : "All healthy"
        }
        rightAccessory={<Rss className="size-4" />}
        to="/admin/sources"
        actionLabel="Manage sources"

      >
        {erroringSources.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {erroringSources.slice(0, 3).map((s) => (
              <li
                key={s._id}
                className="flex items-center justify-between gap-2 rounded-md border border-foreground/10 bg-muted/30 px-2.5 py-1.5"
              >
                <span
                  className="line-clamp-1 text-xs font-medium"
                  title={s.lastFetchError ?? undefined}
                >
                  {s.name}
                </span>
                <span className="meta shrink-0 text-[0.6rem]">
                  {s.lastFetchedAt ? relativeTime(s.lastFetchedAt) : "—"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="meta rounded-md bg-muted/30 px-3 py-2 text-xs">
            Every enabled source returned data on its last fetch.
          </p>
        )}
      </DashboardCard>

      {/* Self-healing */}
      <DashboardCard
        title="Self-healing"
        subtitle="Background tasks that fix the system"
        rightAccessory={<Wrench className="size-4" />}
      >
        <div className="grid grid-cols-2 gap-2">
          <CardCell
            label="Images"
            primary={brokenImages.data?.total ?? 0}
            meta="broken"
          />
          <CardCell
            label="Cleanup"
            primary={
              cleanupPending.data
                ? cleanupPending.data.eventsToArchive +
                  cleanupPending.data.staleDrafts
                : 0
            }
            meta="pending"
          />
          <CardCell
            label="Translate"
            primary={translationBacklog.data?.length ?? 0}
            meta="stale"
          />
          <CardCell
            label="Merges"
            primary={mergesCount.data?.last7d ?? 0}
            meta="last 7d"
          />
        </div>
        {recentMerges.data && recentMerges.data.length > 0 ? (
          <ul className="flex flex-col gap-0.5 meta mt-3 text-[0.65rem]">
            {recentMerges.data.slice(0, 3).map((m) => (
              <li key={m._id} className="line-clamp-1">
                <span className="text-muted-foreground">
                  &ldquo;{m.loserTitle}&rdquo;
                </span>
                <span aria-hidden> → </span>
                <span className="text-foreground">
                  {m.winnerTitle ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="meta mt-3 text-[0.65rem]">
          {recentDups.data?.recentDups ?? 0} dedup'd in the last 7 days. All
          tasks self-run on cron — no editor input required.
        </p>
      </DashboardCard>

      {/* Anomalies */}
      <DashboardCard
        title="Anomalies"
        subtitle={
          issueCount === 0
            ? "Nothing flagged in the last 24h"
            : "Issues to investigate"
        }
        primary={issueCount}
        primarySub={issueCount === 1 ? "issue" : "issues"}
        rightAccessory={<AlertTriangle className="size-4" />}

      >
        {issueCount === 0 ? (
          <p className="meta rounded-md bg-muted/30 px-3 py-2 text-xs">
            All green. Failed runs and flagged-after-publish copy will surface
            here when they happen.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-xs">
            {failedRuns.length > 0 ? (
              <li className="flex items-center justify-between rounded-md border border-foreground/10 bg-muted/30 px-3 py-1.5">
                <span>Failed runs</span>
                <span className="tabular-nums font-medium">
                  {failedRuns.length}
                </span>
              </li>
            ) : null}
            {flaggedArticles.length + flaggedEvents.length > 0 ? (
              <li className="flex items-center justify-between rounded-md border border-foreground/10 bg-muted/30 px-3 py-1.5">
                <span>Flagged after publish</span>
                <span className="tabular-nums font-medium">
                  {flaggedArticles.length + flaggedEvents.length}
                </span>
              </li>
            ) : null}
            {erroringSources.length > 0 ? (
              <li className="flex items-center justify-between rounded-md border border-foreground/10 bg-muted/30 px-3 py-1.5">
                <span>Erroring sources</span>
                <span className="tabular-nums font-medium">
                  {erroringSources.length}
                </span>
              </li>
            ) : null}
          </ul>
        )}
      </DashboardCard>

      {/* Open system alerts — written by the run-watchdog cron when
          the mega-desk hasn't fired in 90 min. Shown as a wide card so
          the editor sees stalled-deploy state at a glance. */}
      <SystemAlertsCard alerts={systemAlerts.data ?? []} />

      {/* Editorial stats — four small cards with the same data the
          old "Miami in numbers" carousel rotated through. One card
          each: stories-per-day sparkline, top sources, coverage mix
          by section, upcoming events by section. Hidden until the
          query resolves. */}
      <EditorialStatsCards data={localStats.data} />

      {/* Flagged after publish — single card with a divided list of
          flagged articles + events. Hidden when nothing's flagged. */}
      <FlaggedCard articles={flaggedArticles} events={flaggedEvents} />

      {/* Just-published — single card with a divided list of recent
          articles. Hidden until the first publish. */}
      <JustPublishedCard articles={recentlyPublished.data ?? []} />

      {/* Manual triggers — each as its own card. All three also run on
          cron; the buttons just drain the queue early when needed. */}
      <ManualTriggerCards />
    </div>
  )
}

// ───────────────────────── system alerts card ────────────────────────
// One card on the grid that lists open alerts (most-recent first).
// Hidden when nothing's open. Spans 2 columns to match the other
// list-shaped cards.

type SystemAlert = FunctionReturnType<typeof api.systemAlerts.list>[number]

function SystemAlertsCard({
  alerts,
}: {
  alerts: ReadonlyArray<SystemAlert>
}) {
  const open = alerts.filter((a) => !a.resolvedAt)
  if (open.length === 0) return null
  return (
    <article className="col-span-2 flex flex-col rounded-xl border border-foreground/10 bg-card">
      <header className="flex items-start justify-between gap-3 border-b border-foreground/10 p-5">
        <div className="min-w-0 flex-1">
          <h3 className="font-sans text-[0.95rem] font-semibold leading-tight">
            Open alerts
          </h3>
          <p className="meta mt-0.5 text-xs leading-snug">
            Watchdog flagged · resolves automatically when the
            condition clears
          </p>
        </div>
        <AlertTriangle className="size-4 text-muted-foreground" />
      </header>
      <ul className="flex flex-col divide-y divide-foreground/10">
        {open.map((a) => (
          <li key={a._id} className="flex flex-col gap-1 px-5 py-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="kicker text-[0.65rem] uppercase tracking-wider">
                {a.kind}
              </span>
              <span className="meta text-xs">
                {relativeTime(a.createdAt)}
              </span>
            </div>
            <p className="font-sans text-sm">{a.message}</p>
          </li>
        ))}
      </ul>
    </article>
  )
}

// ───────────────────────── editorial-stats cards ─────────────────────
// Four small cards on the grid, same data the homepage carousel used
// to rotate through. Each is a DashboardCard with a primary number +
// supporting visual (sparkline or horizontal bars). Returns nothing
// until the query resolves so empty cards never flash.

type LocalStats = FunctionReturnType<typeof api.widgets.localStats>

function EditorialStatsCards({ data }: { data: LocalStats | undefined }) {
  if (!data) return null
  return (
    <>
      <DashboardCard
        title="Stories"
        subtitle="Published per day, last 14 days"
        primary={data.totalStories14d}
        primarySub="stories"
      >
        <Sparkline
          data={data.storiesPerDay}
          variant="bars"
          width={240}
          height={48}
          highlightLast
          className="w-full text-foreground/70"
        />
      </DashboardCard>

      <DashboardCard
        title="Top sources"
        subtitle="Most-cited this week"
        primary={data.topSources.reduce((a, s) => a + s.count, 0)}
        primarySub="cites"
      >
        <StatBars
          items={data.topSources.map((s) => ({ name: s.name, count: s.count }))}
        />
      </DashboardCard>

      <DashboardCard
        title="Coverage mix"
        subtitle="By section, this week"
        primary={data.sectionMix.reduce((a, s) => a + s.count, 0)}
        primarySub="stories"
      >
        <StatBars items={data.sectionMix} />
      </DashboardCard>

      <DashboardCard
        title="Events ahead"
        subtitle="Next 30 days, by section"
        primary={data.upcomingEventsCount}
        primarySub="events"
      >
        <StatBars items={data.upcomingEventsBySection} />
      </DashboardCard>
    </>
  )
}

function StatBars({
  items,
}: {
  items: ReadonlyArray<{ name: string; count: number; accent?: string }>
}) {
  if (items.length === 0) {
    return <p className="meta text-xs">No data yet for this window.</p>
  }
  const max = Math.max(1, ...items.map((i) => i.count))
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item) => {
        const pct = (item.count / max) * 100
        return (
          <li key={item.name} className="flex flex-col gap-0.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-sans truncate text-xs">{item.name}</span>
              <span className="meta shrink-0 text-xs tabular-nums">
                {item.count}
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-foreground/10">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${pct}%`,
                  background: item.accent ?? "var(--foreground)",
                  opacity: item.accent ? 0.9 : 0.7,
                }}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// ───────────────────────── flagged-after-publish card ────────────────
// Single card with a thumbnail-led, divider-separated list — same
// shape as the previous "Flagged after publish" table. Sits on the
// dashboard grid as one cell. Hidden entirely when nothing's flagged.

type FlaggedArticle = FunctionReturnType<
  typeof api.articles.recentAnomalies
>[number]
type FlaggedEvent = FunctionReturnType<
  typeof api.events.recentAnomalies
>[number]

function FlaggedCard({
  articles,
  events,
}: {
  articles: ReadonlyArray<FlaggedArticle>
  events: ReadonlyArray<FlaggedEvent>
}) {
  const total = articles.length + events.length
  if (total === 0) return null
  return (
    <article className="col-span-2 flex flex-col rounded-xl border border-foreground/10 bg-card">
      <header className="flex items-start justify-between gap-3 border-b border-foreground/10 p-5">
        <div className="min-w-0 flex-1">
          <h3 className="font-sans text-[0.95rem] font-semibold leading-tight">
            Flagged after publish
          </h3>
          <p className="meta mt-0.5 text-xs leading-snug">
            Already live · click to re-roll
          </p>
        </div>
        <AlertTriangle className="size-4 text-muted-foreground" />
      </header>
      <ul className="flex flex-col divide-y divide-foreground/10">
        {articles.map((a) => (
          <li
            key={a._id}
            className="flex items-start gap-3 px-5 py-3 hover:bg-muted/40"
          >
            <Thumb url={a.heroImage} className="h-10 w-14 shrink-0" />
            <div className="min-w-0 flex-1">
              <Link
                to="/admin/article/$id"
                params={{ id: a._id }}
                className="font-sans line-clamp-1 text-sm font-semibold hover:underline"
              >
                {a.title}
              </Link>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                {a.sectionName ? (
                  <span
                    className="kicker text-[0.6rem]"
                    style={{ color: a.sectionAccent }}
                  >
                    {a.sectionName}
                  </span>
                ) : null}
                {a.reasons.map((r) => (
                  <span
                    key={r}
                    className="rounded-full border border-foreground/15 px-2 py-0.5 text-[0.65rem] text-muted-foreground"
                  >
                    {r}
                  </span>
                ))}
              </div>
            </div>
          </li>
        ))}
        {events.map((e) => (
          <li
            key={e._id}
            className="flex items-start gap-3 px-5 py-3 hover:bg-muted/40"
          >
            <Thumb url={e.heroImage} className="h-10 w-14 shrink-0" />
            <div className="min-w-0 flex-1">
              {e.slug ? (
                <Link
                  to="/admin/events/$id"
                  params={{ id: e._id }}
                  className="font-sans line-clamp-1 text-sm font-semibold hover:underline"
                >
                  {e.title}
                </Link>
              ) : (
                <p className="font-sans line-clamp-1 text-sm font-semibold">
                  {e.title}
                </p>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                {e.sectionName ? (
                  <span
                    className="kicker text-[0.6rem]"
                    style={{ color: e.sectionAccent }}
                  >
                    {e.sectionName} event
                  </span>
                ) : (
                  <span className="kicker text-[0.6rem] text-muted-foreground">
                    event
                  </span>
                )}
                {e.reasons.map((r) => (
                  <span
                    key={r}
                    className="rounded-full border border-foreground/15 px-2 py-0.5 text-[0.65rem] text-muted-foreground"
                  >
                    {r}
                  </span>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </article>
  )
}

// ───────────────────────── just-published card ────────────────────────
// Single card with a divider-separated list of recent articles —
// same shape as the previous "Just published" table that lived
// below the dashboard grid.

type PublishedArticle = FunctionReturnType<typeof api.articles.latest>[number]

function JustPublishedCard({
  articles,
}: {
  articles: ReadonlyArray<PublishedArticle>
}) {
  if (articles.length === 0) return null
  return (
    <article className="col-span-2 flex flex-col rounded-xl border border-foreground/10 bg-card">
      <header className="flex items-start justify-between gap-3 border-b border-foreground/10 p-5">
        <div className="min-w-0 flex-1">
          <h3 className="font-sans text-[0.95rem] font-semibold leading-tight">
            Just published
          </h3>
          <p className="meta mt-0.5 text-xs leading-snug">
            Most-recent articles · click to open in admin
          </p>
        </div>
        <Link
          to="/admin/published"
          className="meta shrink-0 text-xs hover:underline"
        >
          All →
        </Link>
      </header>
      <ul className="flex flex-col divide-y divide-foreground/10">
        {articles.map((a) => (
          <li
            key={a._id}
            className="flex items-start gap-3 px-5 py-3 hover:bg-muted/40"
          >
            <Thumb url={a.heroImage} className="h-10 w-14 shrink-0" />
            <div className="min-w-0 flex-1">
              <Link
                to="/admin/article/$id"
                params={{ id: a._id }}
                className="font-sans line-clamp-2 text-sm font-semibold hover:underline"
              >
                {a.title}
              </Link>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <span
                  className="kicker text-[0.6rem]"
                  style={{ color: a.section?.accentColor }}
                >
                  {a.section?.name ?? "—"}
                </span>
                <span className="meta text-xs">
                  {a.publishedAt ? relativeTime(a.publishedAt) : "—"}
                </span>
                <ImportanceGauge
                  article={a}
                  accent={a.section?.accentColor}
                />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </article>
  )
}

// ──────────────────────── manual trigger cards ───────────────────────
// Each trigger is its own grid card — same shape as the rest. Three
// triggers, three cards, no shared header.

function ManualTriggerCards() {
  const convex = useConvex()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [running, setRunning] = useState(false)
  const [fixingImages, setFixingImages] = useState(false)
  const [backfilling, setBackfilling] = useState(false)

  const refetch = () => {
    queryClient.invalidateQueries({
      queryKey: convexQuery(api.agentRuns.megaSummary, {}).queryKey,
    })
    queryClient.invalidateQueries({
      queryKey: convexQuery(api.articles.latest, { limit: 6 }).queryKey,
    })
  }

  const runAll = useMutation({
    mutationFn: async () => {
      setRunning(true)
      try {
        return await convex.action(api.agents.runMegaDesk, {})
      } finally {
        setRunning(false)
      }
    },
    onSuccess: (r) => {
      refetch()
      if (r.error) {
        toast.warning("Mega desk run hit an error", { description: r.error })
        return
      }
      toast.success(`Mega desk ran`, {
        description: `${r.draftsCreated} drafts · ${r.eventsCreated} events from ${r.itemsConsidered} items.`,
        action: {
          label: "View queue →",
          onClick: () => navigate({ to: "/admin/published" }),
        },
      })
    },
    onError: (e) => {
      // Surface the failure instead of swallowing it. Common reasons:
      //   - Unauthenticated (Convex client lost its session token)
      //   - Action threw because the mega-desk seed isn't installed
      //   - Network error mid-action
      toast.error("Mega desk run failed", {
        description: e instanceof Error ? e.message : String(e),
      })
    },
  })

  const fixImages = useMutation({
    mutationFn: async () => {
      setFixingImages(true)
      try {
        return await convex.action(api.imageWatchdog.runNow, {})
      } finally {
        setFixingImages(false)
      }
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({
        queryKey: convexQuery(api.imageWatchdog.brokenCount, {}).queryKey,
      })
      const fixed = r.articlesFixed + r.eventsFixed
      const checked = r.articlesChecked + r.eventsChecked
      if (fixed === 0 && checked === 0) {
        toast.success("Images all clean", {
          description: "Nothing was due for a check.",
        })
        return
      }
      toast.success(`Probed ${checked} images`, {
        description:
          fixed > 0
            ? `${fixed} broken — re-resolved with a fresh candidate.`
            : "All resolved cleanly.",
      })
    },
    onError: (e) => {
      toast.error("Image sweep failed", {
        description: e instanceof Error ? e.message : String(e),
      })
    },
  })

  const backfill = useMutation({
    mutationFn: async () => {
      setBackfilling(true)
      try {
        return await convex.action(api.agents.megaBackfill, { days: 30 })
      } finally {
        setBackfilling(false)
      }
    },
    onSuccess: (r) => {
      refetch()
      if (r.error) {
        toast.error("Backfill failed", { description: r.error })
        return
      }
      if (r.draftsCreated === 0) {
        toast(`Backfill complete — nothing new`, {
          description: `${r.itemsConsidered} items scanned over ${r.days}d, none yielded a story.`,
        })
        return
      }
      toast.success(
        `Backfill drafted ${r.draftsCreated} ${r.draftsCreated === 1 ? "story" : "stories"}`,
        {
          description: `${r.itemsConsidered} items over ${r.days}d · re-run tomorrow if the budget capped.`,
        },
      )
    },
    onError: (e) => {
      toast.error("Backfill failed", {
        description: e instanceof Error ? e.message : String(e),
      })
    },
  })

  return (
    <>
      <TriggerCard
        label="Run mega desk"
        cadence="Auto every 4h"
        cost="~$0.10–0.15"
        desc="One Opus call across every enabled source. The desk decides which items become stories, which become events, and which section each lands in."
        icon={Play}
        loading={running}
        onClick={() => runAll.mutate()}
      />
      <TriggerCard
        label="Fix broken images"
        cadence="Auto every 6h"
        cost="Free (no LLM)"
        desc="Probes recent hero images, marks broken ones, and re-resolves them via the source / Unsplash / Wikimedia / YouTube fallback chain."
        icon={ImageOff}
        loading={fixingImages}
        onClick={() => fixImages.mutate()}
      />
      <TriggerCard
        label="Backfill last 30 days"
        cadence="Manual"
        cost="Up to daily $20 cap"
        desc="One-shot pass that widens the lookback to 30 days so older unconsumed items get drafted. Respects the daily LLM budget — re-run tomorrow if it caps mid-pass."
        icon={Sparkles}
        loading={backfilling}
        onClick={() => backfill.mutate()}
      />
    </>
  )
}

function TriggerCard({
  label,
  cadence,
  cost,
  desc,
  icon: Icon,
  loading,
  disabled,
  onClick,
}: {
  label: string
  cadence: string
  cost: string
  desc: string
  icon: typeof Play
  loading: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-foreground/10 bg-card p-5">
      <header className="flex items-start gap-3">
        <Icon className="size-5 text-muted-foreground" />
      </header>
      <div className="flex flex-col gap-1">
        <p className="font-sans text-[0.95rem] font-semibold leading-tight">
          {label}
        </p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="meta text-[0.65rem] uppercase tracking-wider">
            {cadence}
          </span>
          <span aria-hidden className="meta text-[0.65rem]">
            ·
          </span>
          <span className="meta font-mono text-[0.65rem] tabular-nums">
            {cost}
          </span>
        </div>
      </div>
      <p className="meta text-xs leading-relaxed">{desc}</p>
      <button
        type="button"
        onClick={onClick}
        disabled={loading || disabled}
        className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-2.5 text-center font-sans text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {loading ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Running…
          </>
        ) : (
          <>
            <Play className="size-4" /> Run now
          </>
        )}
      </button>
    </article>
  )
}

// Daily LLM budget control — editor sets the dollar/day cap. Stored
// in `siteSettings.dailyBudgetCents`; `budget.reserve` reads it on
// every gate so changes take effect on the next mega-desk tick.
function DailyBudgetControl() {
  const convex = useConvex()
  const queryClient = useQueryClient()
  const { data: settings, isLoading } = useQuery(
    convexQuery(api.siteSettings.get, {}),
  )
  const { data: today } = useQuery(convexQuery(api.budget.today, {}))
  const capCents = settings?.dailyBudgetCents ?? 500
  const [draft, setDraft] = useState<string>(String(capCents / 100))
  // Keep input in sync with server when it changes externally (or
  // when the data lands for the first time).
  const lastSettled = useRef(capCents)
  if (lastSettled.current !== capCents) {
    lastSettled.current = capCents
    setDraft(String(capCents / 100))
  }

  const save = useMutation({
    mutationFn: async (cents: number) => {
      return await convex.mutation(api.siteSettings.setDailyBudgetCents, {
        cents,
      })
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({
        queryKey: convexQuery(api.siteSettings.get, {}).queryKey,
      })
      toast.success(`Daily cap set to $${(r.dailyBudgetCents / 100).toFixed(2)}`)
    },
    onError: (e) => {
      toast.error("Couldn't update budget", {
        description: e instanceof Error ? e.message : String(e),
      })
    },
  })

  const submit = () => {
    const dollars = Number(draft)
    if (!Number.isFinite(dollars) || dollars <= 0) {
      toast.error("Enter a positive dollar amount")
      return
    }
    save.mutate(Math.round(dollars * 100))
  }

  const spentDollars = ((today?.centsSpent ?? 0) / 100).toFixed(2)
  const capDollars = (capCents / 100).toFixed(2)

  return (
    <form
      className="flex items-center gap-2 rounded-md border bg-card px-3 py-2"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      title="LLM spend cap per day. Hard cap — once spent, downstream calls bail until UTC midnight."
    >
      <div className="flex flex-col items-start">
        <span className="font-sans text-sm font-medium leading-none">
          Daily cap
        </span>
        <span className="meta text-[0.65rem]">
          ${spentDollars} / ${capDollars} today
        </span>
      </div>
      <div className="flex items-center">
        <span className="meta text-sm pr-1">$</span>
        <input
          type="number"
          step="0.50"
          min="0.50"
          max="50"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={submit}
          disabled={isLoading || save.isPending}
          className="w-16 rounded border border-foreground/15 bg-background px-2 py-1 text-right font-mono text-sm tabular-nums focus:border-foreground/40 focus:outline-none"
          aria-label="Daily LLM budget cap in dollars"
        />
      </div>
    </form>
  )
}

// Site-wide ad kill switch — toggles `siteSettings.adsEnabled` which
// every `<BannerAd>` reads via Convex's reactive subscription.
function AdsToggle() {
  const convex = useConvex()
  const queryClient = useQueryClient()
  const { data: settings, isLoading } = useQuery(
    convexQuery(api.siteSettings.get, {}),
  )
  const enabled = settings?.adsEnabled ?? true

  const toggle = useMutation({
    mutationFn: async (next: boolean) => {
      await convex.mutation(api.siteSettings.setAdsEnabled, {
        enabled: next,
      })
    },
    onSuccess: (_, next) => {
      queryClient.invalidateQueries({
        queryKey: convexQuery(api.siteSettings.get, {}).queryKey,
      })
      toast.success(next ? "Ads enabled" : "Ads hidden site-wide")
    },
  })

  return (
    <label
      className="flex items-center gap-3 rounded-md border bg-card px-3 py-2"
      title="Toggle every ad placeholder + AdSense block on the public site."
    >
      <div className="flex flex-col items-start">
        <span className="font-sans text-sm font-medium leading-none">
          {enabled ? "Ads on" : "Ads off"}
        </span>
        <span className="meta text-[0.65rem]">Site-wide kill switch</span>
      </div>
      <Switch
        checked={enabled}
        disabled={isLoading || toggle.isPending}
        onCheckedChange={(next) => toggle.mutate(next)}
        aria-label="Toggle advertising site-wide"
      />
    </label>
  )
}

// Map-view toggle — shows/hides the "Map" pill on the public /events
// subnav. Default off; flip on once the editor's confident the map
// view reads well with current event volume + neighborhood coverage.
function MapViewToggle() {
  const convex = useConvex()
  const queryClient = useQueryClient()
  const { data: settings, isLoading } = useQuery(
    convexQuery(api.siteSettings.get, {}),
  )
  const enabled = settings?.mapViewEnabled ?? false

  const toggle = useMutation({
    mutationFn: async (next: boolean) => {
      await convex.mutation(api.siteSettings.setMapViewEnabled, {
        enabled: next,
      })
    },
    onSuccess: (_, next) => {
      queryClient.invalidateQueries({
        queryKey: convexQuery(api.siteSettings.get, {}).queryKey,
      })
      toast.success(
        next ? "Map view shown on /events" : "Map view hidden on /events",
      )
    },
  })

  return (
    <label
      className="flex items-center gap-3 rounded-md border bg-card px-3 py-2"
      title="Toggle the Map pill on the public events subnav."
    >
      <div className="flex flex-col items-start">
        <span className="font-sans text-sm font-medium leading-none">
          {enabled ? "Map on" : "Map off"}
        </span>
        <span className="meta text-[0.65rem]">/events map toggle</span>
      </div>
      <Switch
        checked={enabled}
        disabled={isLoading || toggle.isPending}
        onCheckedChange={(next) => toggle.mutate(next)}
        aria-label="Toggle map view on the public events page"
      />
    </label>
  )
}
