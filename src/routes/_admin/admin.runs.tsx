import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"
import type { FunctionReturnType } from "convex/server"
import { CheckCircle2, CircleSlash, Loader2, XCircle } from "lucide-react"

import { api } from "../../../convex/_generated/api"
import { relativeTime } from "@/lib/dates"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_admin/admin/runs")({
  component: RunsPage,
})

// Mega-desk run history. One row per run, newest first. Each row
// shows when it started, how long it took, what it produced, and the
// last meaningful log line. Click to expand the full log inline.
//
// This page is the destination of the dashboard's "View runs" pill —
// not the desks list at /admin/agents (that one shows installed
// desks/agents, not run history).
function RunsPage() {
  const { data: runs } = useQuery(
    convexQuery(api.agentRuns.recent, { limit: 50 }),
  )
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-sans text-3xl font-semibold tracking-[-0.02em]">
          Mega-desk runs
        </h1>
        <p className="meta mt-1 max-w-prose">
          Cron tick history. Each row is one mega-desk pass — what it
          considered, what it drafted, and the last log line. Click to
          expand the full log.
        </p>
      </header>
      {runs === undefined ? (
        <p className="meta">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="meta">
          No runs yet. The cron fires every hour;{" "}
          <Link to="/admin" className="hover:underline">
            run one now
          </Link>{" "}
          from the dashboard.
        </p>
      ) : (
        <ul className="flex flex-col rounded-xl border border-foreground/10 bg-card divide-y divide-foreground/10">
          {runs.map((run) => (
            <RunRow key={run._id} run={run} />
          ))}
        </ul>
      )}
    </div>
  )
}

type Run = FunctionReturnType<typeof api.agentRuns.recent>[number]

function RunRow({ run }: { run: Run }) {
  const tail = run.log[run.log.length - 1] ?? ""
  const tookMs =
    run.finishedAt && run.startedAt
      ? run.finishedAt - run.startedAt
      : null
  const tookLabel = tookMs != null ? formatDuration(tookMs) : null
  const Icon =
    run.status === "running"
      ? Loader2
      : run.status === "failed"
        ? XCircle
        : run.status === "skipped"
          ? CircleSlash
          : CheckCircle2
  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-3 hover:bg-muted/40">
          <Icon
            className={cn(
              "size-4 shrink-0 mt-0.5",
              run.status === "running" ? "animate-spin text-muted-foreground" : "",
              run.status === "failed" ? "text-muted-foreground" : "",
              run.status === "succeeded" ? "text-muted-foreground" : "",
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="font-sans text-sm font-semibold">
                {relativeTime(run.startedAt)}
              </span>
              <span className="meta text-xs tabular-nums">
                {run.itemsConsidered}→{run.draftsCreated}
                <span className="ml-1 font-normal">
                  item{run.itemsConsidered === 1 ? "" : "s"} →{" "}
                  draft{run.draftsCreated === 1 ? "" : "s"}
                </span>
              </span>
              {tookLabel ? (
                <span className="meta text-xs tabular-nums">
                  · took {tookLabel}
                </span>
              ) : null}
              {run.agent?.name ? (
                <span className="meta text-xs">· {run.agent.name}</span>
              ) : null}
            </div>
            {run.errorMessage ? (
              <p className="meta mt-1 line-clamp-2 text-xs">
                {run.errorMessage}
              </p>
            ) : tail ? (
              <p className="meta mt-1 line-clamp-1 text-xs">{tail}</p>
            ) : null}
          </div>
        </summary>
        {run.log.length > 0 ? (
          <pre className="mx-5 mb-4 overflow-x-auto rounded-md bg-muted/40 px-3 py-2 font-mono text-[0.7rem] leading-relaxed">
            {run.log.join("\n")}
          </pre>
        ) : null}
      </details>
    </li>
  )
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r === 0 ? `${m}m` : `${m}m ${r}s`
}
