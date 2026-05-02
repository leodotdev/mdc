import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import { useConvex } from "convex/react"
import {
  AlertTriangle,
  CalendarPlus,
  CheckCheck,
  Inbox,
  Loader2,
  Play,
  Plus,
  Rss,
  Search,
  Sparkles,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { api } from "../../../convex/_generated/api"
import { ImportanceGauge } from "@/components/editorial/importance-gauge"
import { TableLoadingRows } from "@/components/editorial/story-card-skeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { relativeTime } from "@/lib/dates"
import { proxiedImageUrl } from "@/lib/image-proxy"

export const Route = createFileRoute("/_admin/admin/")({
  component: DashboardPage,
})

// Editor's daily start screen. Surfaces what needs doing first (review
// queue, events to approve, failed runs, source feeds erroring), then
// lets the editor fan-out a "Run all" / "Enrich all" pass across every
// enabled desk without leaving the page. Recent activity + a peek at
// what's been published recently round it out.
function DashboardPage() {
  const queue = useQuery(convexQuery(api.articles.reviewQueue, {}))
  const events = useQuery(convexQuery(api.events.reviewQueue, {}))
  const sources = useQuery(convexQuery(api.sourcesData.list, {}))
  const agents = useQuery(convexQuery(api.agentsData.list, {}))
  const recentRuns = useQuery(convexQuery(api.agentRuns.recent, { limit: 8 }))
  const recentlyPublished = useQuery(
    convexQuery(api.articles.latest, { limit: 6 }),
  )

  // Failed runs in the last 24h — flagged in the anomalies card.
  const dayAgo = Date.now() - 24 * 3_600_000
  const failedRuns =
    recentRuns.data?.filter(
      (r) => r.status === "failed" && r.startedAt >= dayAgo,
    ) ?? []
  const erroringSources =
    sources.data?.filter(
      (s) => s.lastFetchStatus === "error" && s.enabled,
    ) ?? []

  type Stat = {
    label: string
    value: number | undefined
    to: "/admin/queue" | "/admin/events" | "/admin/sources" | "/admin/agents"
    icon: typeof Inbox
    tone?: "warning" | "default"
    sub?: string
  }
  const stats: Array<Stat> = [
    {
      label: "In review",
      value: queue.data?.length,
      to: "/admin/queue",
      icon: Inbox,
    },
    {
      label: "Events pending",
      value: events.data?.length,
      to: "/admin/events",
      icon: CalendarPlus,
    },
    {
      label: "Sources",
      value: sources.data?.length,
      sub:
        erroringSources.length > 0
          ? `${erroringSources.length} erroring`
          : undefined,
      to: "/admin/sources",
      icon: Rss,
      tone: erroringSources.length > 0 ? "warning" : "default",
    },
    {
      label: "Failed runs (24h)",
      value: failedRuns.length,
      to: "/admin/agents",
      icon: AlertTriangle,
      tone: failedRuns.length > 0 ? "warning" : "default",
    },
  ]

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-[-0.02em]">
            Editor's desk
          </h1>
          <p className="meta mt-1">
            Today's edition — what's queued, what's failing, what to ship.
          </p>
        </div>
        <BulkActionsBar agents={agents.data ?? []} />
      </header>

      {/* Stat row — one click each. */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Link
            key={s.label}
            to={s.to}
            className={`flex items-center justify-between rounded-md border bg-card p-5 transition-colors duration-150 hover:bg-muted ${s.tone === "warning" ? "border-destructive/40" : ""}`}
          >
            <div>
              <p className="meta text-xs uppercase tracking-wider">
                {s.label}
              </p>
              {s.value === undefined ? (
                <Skeleton className="mt-2 h-9 w-12" />
              ) : (
                <p
                  className={`font-heading mt-2 text-3xl font-semibold tabular-nums ${s.tone === "warning" && Number(s.value) > 0 ? "text-destructive" : ""}`}
                >
                  {s.value}
                </p>
              )}
              {s.sub ? (
                <p className="meta mt-1 text-xs text-destructive">{s.sub}</p>
              ) : null}
            </div>
            <s.icon className="text-muted-foreground" />
          </Link>
        ))}
      </div>

      {/* Needs attention — three columns of what to look at first. */}
      <section>
        <header className="rule-bottom mb-4 flex items-baseline justify-between pb-2">
          <h2 className="font-heading text-xl font-semibold">Needs attention</h2>
        </header>
        <div className="grid gap-6 lg:grid-cols-3">
          <AttentionCard
            title="Review queue"
            count={queue.data?.length ?? 0}
            href="/admin/queue"
            empty="Nothing waiting."
          >
            {(queue.data ?? []).slice(0, 4).map((a) => (
              <Link
                key={a._id}
                to="/admin/queue/$id"
                params={{ id: a._id as string }}
                className="group flex items-start gap-3 border-t py-2 first:border-t-0 hover:bg-muted/50"
              >
                <div className="mt-0.5 size-12 shrink-0 overflow-hidden rounded bg-muted">
                  {a.heroImage ? (
                    <img
                      src={proxiedImageUrl(a.heroImage, { width: 120 })}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-heading truncate text-sm font-semibold">
                    {a.title}
                  </p>
                  <p className="meta mt-0.5 text-xs">
                    {a.section?.name ?? "—"} · {relativeTime(a.createdAt)}
                  </p>
                </div>
              </Link>
            ))}
          </AttentionCard>

          <AttentionCard
            title="Events to approve"
            count={events.data?.length ?? 0}
            href="/admin/events"
            empty="No events waiting."
          >
            {(events.data ?? []).slice(0, 4).map((e) => (
              <Link
                key={e._id}
                to="/admin/events"
                className="block border-t py-2 first:border-t-0 hover:bg-muted/50"
              >
                <p className="font-heading truncate text-sm font-semibold">
                  {e.title}
                </p>
                <p className="meta mt-0.5 text-xs">
                  {new Date(e.startsAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    timeZone: "America/New_York",
                  })}
                  {e.locationName ? ` · ${e.locationName}` : ""}
                </p>
              </Link>
            ))}
          </AttentionCard>

          <AttentionCard
            title="Anomalies"
            count={failedRuns.length + erroringSources.length}
            href="/admin/agents"
            empty="All clear."
            tone={failedRuns.length + erroringSources.length > 0 ? "warning" : "default"}
          >
            {failedRuns.slice(0, 3).map((r) => (
              <div
                key={r._id}
                className="border-t py-2 first:border-t-0"
              >
                <p className="text-sm font-medium text-destructive">
                  {r.agent?.name ?? "?"} run failed
                </p>
                <p className="meta mt-0.5 truncate text-xs">
                  {r.errorMessage ?? "—"} · {relativeTime(r.startedAt)}
                </p>
              </div>
            ))}
            {erroringSources.slice(0, 3).map((s) => (
              <Link
                key={s._id}
                to="/admin/sources"
                className="block border-t py-2 first:border-t-0 hover:bg-muted/50"
              >
                <p className="text-sm font-medium text-destructive">
                  {s.name}
                </p>
                <p className="meta mt-0.5 truncate text-xs">
                  Source feed erroring
                </p>
              </Link>
            ))}
          </AttentionCard>
        </div>
      </section>

      {/* Activity ↔ Output. */}
      <section className="grid gap-10 lg:grid-cols-2">
        <div>
          <header className="rule-bottom mb-4 flex items-baseline justify-between pb-2">
            <h2 className="font-heading text-xl font-semibold">Recent runs</h2>
            <Link to="/admin/agents" className="meta hover:underline">
              All desks →
            </Link>
          </header>
          {recentRuns.data && recentRuns.data.length === 0 ? (
            <p className="meta">No runs yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Desk</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Drafts</TableHead>
                    <TableHead className="hidden md:table-cell">Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentRuns.data === undefined ? (
                    <TableLoadingRows rows={5} cols={5} />
                  ) : (
                    recentRuns.data.map((run) => (
                      <TableRow key={run._id}>
                        <TableCell>
                          {run.agent ? (
                            <Link
                              to="/admin/agents/$slug"
                              params={{ slug: run.agent.slug }}
                              className="font-medium hover:underline"
                            >
                              {run.agent.name}
                            </Link>
                          ) : (
                            <span className="meta">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <RunStatusBadge status={run.status} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {run.itemsConsidered}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {run.draftsCreated}
                        </TableCell>
                        <TableCell className="hidden md:table-cell meta text-xs tabular-nums">
                          {relativeTime(run.startedAt)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <div>
          <header className="rule-bottom mb-4 flex items-baseline justify-between pb-2">
            <h2 className="font-heading text-xl font-semibold">Just published</h2>
            <Link to="/admin/published" className="meta hover:underline">
              All published →
            </Link>
          </header>
          {recentlyPublished.data && recentlyPublished.data.length === 0 ? (
            <p className="meta">No published stories yet.</p>
          ) : (
            <ul className="divide-y rounded-md border bg-card">
              {(recentlyPublished.data ?? []).map((a) => (
                <li
                  key={a._id}
                  className="flex items-start gap-3 p-3 hover:bg-muted/40"
                >
                  <div className="size-12 shrink-0 overflow-hidden rounded bg-muted">
                    {a.heroImage ? (
                      <img
                        src={proxiedImageUrl(a.heroImage, { width: 120 })}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link
                      to="/admin/queue/$id"
                      params={{ id: a._id as string }}
                      className="font-heading line-clamp-2 text-sm font-semibold hover:underline"
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
                        {a.publishedAt
                          ? relativeTime(a.publishedAt)
                          : "—"}
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
          )}
        </div>
      </section>
    </div>
  )
}

function AttentionCard({
  title,
  count,
  href,
  empty,
  tone = "default",
  children,
}: {
  title: string
  count: number
  href: "/admin/queue" | "/admin/events" | "/admin/agents"
  empty: string
  tone?: "default" | "warning"
  children?: React.ReactNode
}) {
  const isEmpty = count === 0
  return (
    <div
      className={`flex flex-col rounded-md border bg-card ${tone === "warning" && !isEmpty ? "border-destructive/40" : ""}`}
    >
      <header className="flex items-baseline justify-between border-b px-4 py-3">
        <div className="flex items-baseline gap-2">
          <h3 className="font-heading text-sm font-semibold">{title}</h3>
          <span
            className={`font-mono text-xs tabular-nums ${tone === "warning" && !isEmpty ? "text-destructive" : "text-muted-foreground"}`}
          >
            {count}
          </span>
        </div>
        <Link to={href} className="meta uppercase tracking-wider hover:underline">
          Open →
        </Link>
      </header>
      <div className="flex-1 px-4 py-2">
        {isEmpty ? (
          <p className="meta flex items-center gap-2 py-4 text-sm">
            <CheckCheck className="size-4" />
            {empty}
          </p>
        ) : (
          children
        )}
      </div>
    </div>
  )
}

// "Run all" / "Enrich all" fans out to every enabled desk in parallel
// and summarizes results in a single toast. Disabled desks are skipped.
function BulkActionsBar({
  agents,
}: {
  agents: Array<{ _id: unknown; slug: string; name: string; enabled: boolean }>
}) {
  const convex = useConvex()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [running, setRunning] = useState(false)
  const [enriching, setEnriching] = useState(false)

  const enabled = agents.filter((a) => a.enabled)
  const [rerolling, setRerolling] = useState(false)
  const [translating, setTranslating] = useState(false)

  const refetch = () => {
    queryClient.invalidateQueries({
      queryKey: convexQuery(api.articles.reviewQueue, {}).queryKey,
    })
    queryClient.invalidateQueries({
      queryKey: convexQuery(api.events.reviewQueue, {}).queryKey,
    })
    queryClient.invalidateQueries({
      queryKey: convexQuery(api.agentRuns.recent, { limit: 8 }).queryKey,
    })
  }

  const runAll = useMutation({
    mutationFn: async () => {
      setRunning(true)
      try {
        return await Promise.all(
          enabled.map(async (a) => {
            try {
              const r = await convex.action(api.agents.runDesk, {
                agentSlug: a.slug,
              })
              return {
                slug: a.slug,
                ok: !r.error,
                drafts: r.draftsCreated,
                error: r.error,
              }
            } catch (e) {
              return {
                slug: a.slug,
                ok: false,
                drafts: 0,
                error: e instanceof Error ? e.message : String(e),
              }
            }
          }),
        )
      } finally {
        setRunning(false)
      }
    },
    onSuccess: (results) => {
      refetch()
      const drafts = results.reduce((n, r) => n + r.drafts, 0)
      const failures = results.filter((r) => !r.ok).length
      if (failures > 0) {
        toast.warning(
          `${results.length - failures}/${results.length} desks ran`,
          { description: `${drafts} drafts · ${failures} failed` },
        )
      } else {
        toast.success(`${results.length} desks ran`, {
          description: `${drafts} drafts created.`,
          action: {
            label: "View queue →",
            onClick: () => navigate({ to: "/admin/queue" }),
          },
        })
      }
    },
  })

  // "Re-roll voice" — drains the backlog of stories drafted under the
  // older, longer prompt. Each click processes up to 10 bloated stories;
  // the editor re-clicks until the count hits zero.
  const rerollVoice = useMutation({
    mutationFn: async () => {
      setRerolling(true)
      try {
        return await convex.action(api.agents.bulkRefreshVoice, {
          maxStories: 10,
        })
      } finally {
        setRerolling(false)
      }
    },
    onSuccess: (r) => {
      refetch()
      if (r.processed === 0) {
        toast.success("Voice is up to date", {
          description: "No bloated stories left.",
        })
        return
      }
      const parts: Array<string> = []
      parts.push(`${r.changed} rewritten`)
      if (r.skipped) parts.push(`${r.skipped} unchanged`)
      if (r.errors) parts.push(`${r.errors} errored`)
      toast.success(`Processed ${r.processed} stories`, {
        description:
          parts.join(" · ") +
          ". Click again to keep draining the backlog.",
      })
    },
  })

  // Translate backlog — runs the LLM Spanish translation pipeline on
  // up to 10 published stories whose ES copy is missing or stale (EN
  // sourceHash mismatch). Re-clickable to drain larger backlogs.
  const translateBacklog = useMutation({
    mutationFn: async () => {
      setTranslating(true)
      try {
        return await convex.action(api.articles.bulkTranslate, {
          maxArticles: 10,
        })
      } finally {
        setTranslating(false)
      }
    },
    onSuccess: (r) => {
      refetch()
      if (r.processed === 0) {
        toast.success("Translations are up to date", {
          description: "Every published story has a current ES translation.",
        })
        return
      }
      const parts: Array<string> = [`${r.translated} translated`]
      if (r.errors) parts.push(`${r.errors} errored`)
      toast.success(`Processed ${r.processed} stories`, {
        description:
          parts.join(" · ") +
          ". Click again to keep draining the backlog.",
      })
    },
  })

  const enrichAll = useMutation({
    mutationFn: async () => {
      setEnriching(true)
      try {
        return await Promise.all(
          enabled.map(async (a) => {
            try {
              const r = await convex.action(api.agents.enrichDesk, {
                agentSlug: a.slug,
              })
              return {
                slug: a.slug,
                ok: !r.error,
                articles: r.articlesEnriched,
                error: r.error,
              }
            } catch (e) {
              return {
                slug: a.slug,
                ok: false,
                articles: 0,
                error: e instanceof Error ? e.message : String(e),
              }
            }
          }),
        )
      } finally {
        setEnriching(false)
      }
    },
    onSuccess: (results) => {
      refetch()
      const total = results.reduce((n, r) => n + r.articles, 0)
      const failures = results.filter((r) => !r.ok).length
      if (failures > 0) {
        toast.warning(
          `${results.length - failures}/${results.length} desks enriched`,
          { description: `${total} articles · ${failures} failed` },
        )
      } else {
        toast.success(`${results.length} desks enriched`, {
          description: `${total} articles refreshed.`,
        })
      }
    },
  })

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="default"
        disabled={running || enabled.length === 0}
        onClick={() => runAll.mutate()}
      >
        {running ? <Loader2 className="animate-spin" /> : <Play />}
        Run all desks
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={enriching || enabled.length === 0}
        onClick={() => enrichAll.mutate()}
        title="Re-run every enabled desk over its queued + published stories — adds citations, links related, polishes copy."
      >
        {enriching ? <Loader2 className="animate-spin" /> : <Sparkles />}
        Enrich all
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={rerolling}
        onClick={() => rerollVoice.mutate()}
        title="Re-roll up to 10 bloated stories under the current voice rules. Targets stories with title > 60 chars, dek > 120 chars, or body > 80 words. Click repeatedly to drain the backlog."
      >
        {rerolling ? <Loader2 className="animate-spin" /> : <Sparkles />}
        Re-roll voice
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={translating}
        onClick={() => translateBacklog.mutate()}
        title="Generate or refresh Spanish translations for up to 10 stories. Targets articles with no ES translation or whose EN copy has changed since the last translate. Click repeatedly to drain the backlog."
      >
        {translating ? <Loader2 className="animate-spin" /> : <Sparkles />}
        Translate backlog
      </Button>
      <Link
        to="/admin/queue"
        className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
      >
        <Inbox className="size-4" />
        Queue
      </Link>
      <Link
        to="/admin/sources"
        className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
      >
        <Plus className="size-4" />
        Source
      </Link>
      <Link
        to="/search"
        className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
      >
        <Search className="size-4" />
        Site search
      </Link>
    </div>
  )
}

function RunStatusBadge({
  status,
}: {
  status: "running" | "succeeded" | "failed"
}) {
  if (status === "succeeded") {
    return <Badge className="text-[0.65rem]">succeeded</Badge>
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive" className="text-[0.65rem]">
        failed
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className="text-[0.65rem]">
      running
    </Badge>
  )
}
