import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import { api } from "../../../convex/_generated/api"
import { SectionHeaderCell } from "@/components/editorial/section-header-cell"
import { Sparkline } from "@/components/admin/sparkline"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

// Right-rail carousel of local stats. One Convex query feeds all
// slides; auto-advance every 8 seconds, pause on hover/focus.
// Reduced-motion respect: paused at the first slide. Each slide cites
// its source at the bottom — internal data labelled as such, external
// data carries an outbound link.

const ADVANCE_MS = 8_000

type StatsData = NonNullable<
  ReturnType<typeof useStatsData>["data"]
>

function useStatsData() {
  return useQuery(convexQuery(api.widgets.localStats, {}))
}

type Slide = {
  key: string
  title: string
  subtitle: string
  render: (d: StatsData) => React.ReactNode
}

const SLIDES: Array<Slide> = [
  {
    key: "stories-14d",
    title: "Stories published",
    subtitle: "Last 14 days",
    render: (d) => <StoriesPerDayChart data={d} />,
  },
  {
    key: "top-sources",
    title: "Top sources",
    subtitle: "Most-cited this week",
    render: (d) => <HorizontalBars items={d.topSources} unit="cites" />,
  },
  {
    key: "section-mix",
    title: "Coverage mix",
    subtitle: "By section, this week",
    render: (d) => <HorizontalBars items={d.sectionMix} unit="stories" />,
  },
  {
    key: "events-month",
    title: "Events ahead",
    subtitle: "Next 30 days, by section",
    render: (d) => (
      <HorizontalBars items={d.upcomingEventsBySection} unit="events" />
    ),
  },
]

export function LocalStatsWidget() {
  const { data } = useStatsData()
  const [idx, setIdx] = useState(0)
  const [paused, setPaused] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Auto-advance — paused on hover and when the user prefers reduced
  // motion. Restarts cleanly when paused state flips.
  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    if (paused || reduced) return
    intervalRef.current = setInterval(() => {
      setIdx((i) => (i + 1) % SLIDES.length)
    }, ADVANCE_MS)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [paused])

  const slide = SLIDES[idx]

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
        subtitle={`${idx + 1} of ${SLIDES.length}`}
      />
      <div className="rounded-md border border-foreground/15 bg-card p-4">
        <div className="min-h-[180px]">
          <p className="font-sans text-sm font-semibold leading-tight">
            {slide.title}
          </p>
          <p className="meta mt-0.5 text-xs leading-snug">{slide.subtitle}</p>
          <div className="mt-4">
            {!data ? <SlideSkeleton /> : slide.render(data)}
          </div>
        </div>
        <p className="meta mt-4 text-[0.65rem]">
          Source: miami.community editorial data
        </p>
      </div>
      <PaginationDots
        count={SLIDES.length}
        active={idx}
        onPick={(i) => {
          setIdx(i)
          setPaused(true)
          // Resume auto-advance shortly after a manual pick — gives
          // the reader a moment with the chosen slide before the
          // carousel takes over again.
          window.setTimeout(() => setPaused(false), 12_000)
        }}
      />
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
          aria-label={`Show stat ${i + 1} of ${count}`}
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

function SlideSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  )
}

function StoriesPerDayChart({ data }: { data: StatsData }) {
  // 14 daily counts, with M/T/W/T/F/S/S labels under the last 7 days
  // — enough rhythm for the eye to track without crowding the axis.
  const labels = Array.from({ length: 14 }, (_, i) => {
    if (i < 7) return ""
    const date = new Date(Date.now() - (13 - i) * 24 * 60 * 60 * 1000)
    return date.toLocaleDateString("en-US", { weekday: "narrow" })
  })
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <p className="font-sans text-3xl font-semibold tabular-nums leading-none">
          {data.totalStories14d}
        </p>
        <p className="meta text-xs">events</p>
      </div>
      <Sparkline
        data={data.storiesPerDay}
        variant="bars"
        width={240}
        height={56}
        labels={labels}
        highlightLast
        className="mt-3 w-full text-foreground/70"
      />
    </div>
  )
}

// Horizontal-bar list — one row per item with `label` left, sized
// proportionally to the max value, count on the right.
function HorizontalBars({
  items,
  unit,
}: {
  items: ReadonlyArray<{ name: string; count: number; accent?: string }>
  unit: string
}) {
  if (items.length === 0) {
    return <p className="meta text-xs">No data yet for this window.</p>
  }
  const max = Math.max(1, ...items.map((i) => i.count))
  const total = items.reduce((acc, i) => acc + i.count, 0)
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <p className="font-sans text-3xl font-semibold tabular-nums leading-none">
          {total}
        </p>
        <p className="meta text-xs">{unit}</p>
      </div>
      <ul className="flex flex-col gap-1.5 mt-3">
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
    </div>
  )
}
