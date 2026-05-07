import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import { api } from "../../../convex/_generated/api"
import { SectionHeaderCell } from "@/components/editorial/section-header-cell"
import { MetricCard } from "@/components/widgets/metric-card"
import { cn } from "@/lib/utils"

// Right-rail "Miami in numbers" carousel — rotates through metrics
// the mega-desk has extracted from cited reporting. Auto-advance
// every 10s, paused on hover/focus, respects prefers-reduced-motion.
//
// The whole widget is hidden until the catalog has crossed
// `MIN_VISIBLE` entries — a public-facing surface with one stat or
// an empty state reads as broken to readers, not in-progress. Admin
// can monitor the catalog on /admin/metrics regardless of count.

const ADVANCE_MS = 10_000
const MIN_VISIBLE = 3

export function MetricsCarousel() {
  const { data } = useQuery(
    convexQuery(api.metrics.list, { limit: 10 }),
  )
  const [idx, setIdx] = useState(0)
  const [paused, setPaused] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const metrics = data ?? []
  const count = metrics.length

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (paused || reduced || count <= 1) return
    intervalRef.current = setInterval(() => {
      setIdx((i) => (i + 1) % count)
    }, ADVANCE_MS)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [paused, count])

  // Reset index if the catalog shrinks (rare, but defensive).
  useEffect(() => {
    if (idx >= count && count > 0) setIdx(0)
  }, [idx, count])

  // Loading: render nothing rather than a flashy skeleton. With the
  // visibility threshold below, most readers won't see this widget
  // until the catalog is populated anyway.
  if (!data) return null
  // Below the visibility threshold, hide the widget entirely. The
  // catalog crosses MIN_VISIBLE within a few mega-desk runs.
  if (count < MIN_VISIBLE) return null

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="flex flex-col gap-3"
    >
      <SectionHeaderCell
        title="Miami in numbers"
        subtitle={`${idx + 1} of ${count}`}
      />
      <MetricCard metric={metrics[idx]} />
      {count > 1 ? (
        <PaginationDots
          count={count}
          active={idx}
          onPick={(i) => {
            setIdx(i)
            setPaused(true)
            // Resume after a moment so the reader has time with the
            // chosen card before the carousel takes over again.
            window.setTimeout(() => setPaused(false), 14_000)
          }}
        />
      ) : null}
    </div>
  )
}

function PaginationDots({
  count,
  active,
  onPick,
}: {
  count: number
  active: number
  onPick: (i: number) => void
}) {
  return (
    <div className="flex items-center justify-center gap-1.5">
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onPick(i)}
          aria-label={`Show metric ${i + 1} of ${count}`}
          aria-current={i === active ? "true" : undefined}
          className={cn(
            "size-1.5 rounded-full transition-all",
            i === active
              ? "w-4 bg-foreground"
              : "bg-foreground/25 hover:bg-foreground/50",
          )}
        />
      ))}
    </div>
  )
}
