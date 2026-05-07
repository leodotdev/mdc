import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, CheckCircle2, Loader2, Zap } from "lucide-react"
import { useEffect, useState } from "react"

import { api } from "../../../convex/_generated/api"
import { cn } from "@/lib/utils"
import { formatNextRun, relativeTime } from "@/lib/dates"

// Live heartbeat — the dashboard's "is the system alive right now"
// strip. Convex pushes updates via subscription on `agentRuns.megaSummary`
// + `sourcesData.list`, so the strip flips between OK / DEGRADED /
// FAILING in real time as runs finish and sources error.
//
// Re-ticks once a minute so the relative-time labels ("17m ago",
// "in 3h 43m") stay current. No polling — Convex subscriptions handle
// data; this hook only rerenders the displayed text.

type Mood = "ok" | "degraded" | "failing"

const RUNNING_WINDOW_MS = 10 * 60 * 1000

export function HeartbeatStrip() {
  const { data: summary } = useQuery(
    convexQuery(api.agentRuns.megaSummary, {}),
  )
  const { data: sources } = useQuery(convexQuery(api.sourcesData.list, {}))

  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const erroring = (sources ?? []).filter(
    (s) => s.lastFetchStatus === "error" && s.enabled,
  ).length
  const lastFailed = summary?.status === "failed"
  const running =
    summary?.status === "running" &&
    summary.startedAt > Date.now() - RUNNING_WINDOW_MS

  const mood: Mood =
    lastFailed && erroring > 0
      ? "failing"
      : lastFailed || erroring > 0
        ? "degraded"
        : "ok"

  const moodIcon =
    mood === "failing" ? (
      <AlertTriangle className="size-4 text-destructive" />
    ) : mood === "degraded" ? (
      <AlertTriangle className="size-4 text-amber-500" />
    ) : (
      <CheckCircle2 className="size-4 text-primary" />
    )
  const moodLabel =
    mood === "failing" ? "Failing" : mood === "degraded" ? "Degraded" : "Healthy"

  return (
    <div className="rounded-xl border border-foreground/10 bg-card p-5">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex size-9 items-center justify-center rounded-full",
              running ? "bg-primary/15" : "bg-muted",
            )}
          >
            {running ? (
              <Loader2 className="size-4 animate-spin text-primary" />
            ) : (
              <Zap className="size-4 text-foreground/70" />
            )}
          </div>
          <div>
            <p className="meta text-[0.65rem] uppercase tracking-wider">
              Pipeline
            </p>
            <p className="font-sans text-base font-semibold leading-tight">
              {running
                ? "Running now"
                : summary
                  ? `Last run ${relativeTime(summary.startedAt)}`
                  : "No runs yet"}
            </p>
          </div>
        </div>

        {summary && !running ? (
          <div>
            <p className="meta text-[0.65rem] uppercase tracking-wider">
              Next run
            </p>
            <p className="font-sans text-base font-semibold tabular-nums leading-tight">
              {formatNextRun(summary.nextRunAt)}
            </p>
          </div>
        ) : null}

        {summary ? (
          <div>
            <p className="meta text-[0.65rem] uppercase tracking-wider">
              Last batch
            </p>
            <p className="font-sans text-base font-semibold tabular-nums leading-tight">
              {summary.itemsConsidered}→{summary.draftsCreated}
              <span className="meta ml-1 text-sm font-normal">stories</span>
            </p>
          </div>
        ) : null}

        <div className="ml-auto flex items-center gap-2 rounded-full border border-foreground/10 bg-muted/30 px-3 py-1.5">
          {moodIcon}
          <span
            className={cn(
              "font-sans text-sm font-semibold",
              mood === "failing"
                ? "text-destructive"
                : mood === "degraded"
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-foreground",
            )}
          >
            {moodLabel}
          </span>
        </div>
      </div>
    </div>
  )
}
