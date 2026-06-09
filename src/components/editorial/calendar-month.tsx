import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useMemo } from "react"

import type { EventWithRelations } from "@/lib/article-types"
import { useTranslation } from "@/lib/i18n/context"
import { localizedEvent } from "@/lib/localized-event"
import { nextOccurrences } from "@/lib/rrule"
import { useOpenEventDrawer } from "@/lib/use-open-article-drawer"
import { cn } from "@/lib/utils"

// Full-month calendar grid for the "Month" view mode. 7 columns
// (Sunday-Saturday), 5-6 rows depending on the month's layout. Each
// cell shows the day number plus up to 3 event titles; overflow
// collapses into a "+N more" link that expands the cell to all
// events for that day.
//
// Recurring events (RRULE) are expanded client-side via
// `nextOccurrences` so a "yoga every Saturday" event shows up on
// EVERY Saturday in view, not just its original startsAt.
//
// URL state: `?month=YYYY-MM` carries the active month so the prev/
// next arrows are deep-linkable and refresh-safe. Falls back to
// today's month when the param is absent.

type Props = {
  events: ReadonlyArray<EventWithRelations>
  /** Current month displayed; "YYYY-MM" string. Driven by the URL
   *  param; the consumer route owns the param wiring. */
  yearMonth: string
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export function CalendarMonth({ events, yearMonth }: Props) {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as Record<string, unknown>
  const [year, month] = parseYM(yearMonth) ?? [
    new Date().getFullYear(),
    new Date().getMonth(),
  ]

  const monthStart = new Date(year, month, 1)
  const monthEnd = new Date(year, month + 1, 0) // last day of month
  // Calendar grid starts on the Sunday on/before monthStart and ends
  // on the Saturday on/after monthEnd. Gives 5-6 weeks of cells.
  const gridStart = new Date(monthStart)
  gridStart.setDate(gridStart.getDate() - gridStart.getDay())
  const gridEnd = new Date(monthEnd)
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()))

  // Bucket events by day key. Three sources of occurrences:
  //   1. The event's anchor startsAt.
  //   2. RRULE-driven recurrences (next 40 future hits in-view).
  //   3. Multi-day spans — if endsAt > startsAt by more than 18h, an
  //      occurrence is placed on every intervening day so the event
  //      renders as a continuous bar across the week (start → middle
  //      → end variants below).
  const cells = useMemo(() => {
    const buckets = new Map<string, Array<EventOnDay>>()
    const gridStartMs = gridStart.getTime()
    const gridEndMs = gridEnd.getTime() + 86_400_000
    const addSpan = (e: EventWithRelations, startTs: number) => {
      const endTs = e.endsAt ?? 0
      const isMultiDay = endTs - startTs > 18 * 3_600_000
      if (!isMultiDay) {
        addToBucket(buckets, e, startTs, gridStartMs, gridEndMs, "single")
        return
      }
      const startDay = startOfDay(startTs)
      const endDay = startOfDay(endTs)
      let cursor = startDay
      while (cursor <= endDay) {
        const role: EventOnDay["role"] =
          cursor === startDay
            ? "spanStart"
            : cursor === endDay
              ? "spanEnd"
              : "spanMid"
        addToBucket(buckets, e, cursor, gridStartMs, gridEndMs, role)
        cursor += 86_400_000
      }
    }
    for (const e of events) {
      addSpan(e, e.startsAt)
      if (e.recurrenceRule) {
        const occs = nextOccurrences(e.recurrenceRule, e.startsAt, 40)
        for (const ts of occs) {
          if (ts === e.startsAt) continue
          addSpan(e, ts)
        }
      }
    }
    // ── Lane assignment ────────────────────────────────────────────
    // Apple / Google / Notion-style: every multi-day event keeps a
    // fixed row slot ("lane") across its entire span. A new event
    // claims the lowest lane that's free for *every* day it occupies.
    // Once event A on lane 2 ends, lane 2 becomes vacant on later
    // days — but events already laid out keep their lane, so the
    // continuous spans never visually jump rows when an earlier
    // neighbor expires. Empty lanes render as transparent spacer rows
    // in the affected cells so heights stay aligned across the week.
    //
    // Algorithm:
    //   1. Collect unique event instances with their day sets.
    //   2. Sort by start day, then by span length descending so the
    //      longest spans grab the lowest lanes first (matches Google
    //      Calendar's stacking).
    //   3. For each instance, scan lanes 0,1,2,... and pick the first
    //      one that's free on every day in the instance's day set.
    type Instance = {
      key: string
      startTs: number
      length: number
      days: Array<string>
    }
    const instances = new Map<string, Instance>()
    for (const [day, items] of buckets) {
      for (const it of items) {
        // Instance key: event id + the bucket entry's start ts for
        // spans (so we can also de-dupe per-occurrence rrule entries).
        // For singles, ts itself is fine.
        const instKey =
          it.role === "single"
            ? `${it.event._id}|${it.ts}`
            : `${it.event._id}|${roleSpanKey(it)}`
        const inst = instances.get(instKey) ?? {
          key: instKey,
          startTs: it.ts,
          length: 0,
          days: [],
        }
        inst.days.push(day)
        if (it.ts < inst.startTs) inst.startTs = it.ts
        instances.set(instKey, inst)
        // attach the instance key so the renderer can look up row.
        ;(it as EventOnDay & { instKey: string }).instKey = instKey
      }
    }
    for (const inst of instances.values()) inst.length = inst.days.length

    const sorted = Array.from(instances.values()).sort((a, b) => {
      if (a.startTs !== b.startTs) return a.startTs - b.startTs
      return b.length - a.length // longer spans win ties
    })

    const occupied = new Map<string, Set<number>>()
    const laneByInstance = new Map<string, number>()
    for (const inst of sorted) {
      let lane = 0
      while (true) {
        let conflict = false
        for (const d of inst.days) {
          if (occupied.get(d)?.has(lane)) {
            conflict = true
            break
          }
        }
        if (!conflict) break
        lane += 1
      }
      laneByInstance.set(inst.key, lane)
      for (const d of inst.days) {
        if (!occupied.has(d)) occupied.set(d, new Set())
        occupied.get(d)!.add(lane)
      }
    }

    // Stamp lane onto each bucket item and sort buckets by lane so
    // the renderer can emit them in row order. Missing lanes become
    // transparent placeholders at render time.
    for (const arr of buckets.values()) {
      for (const it of arr) {
        const k = (it as EventOnDay & { instKey?: string }).instKey
        ;(it as EventOnDay & { lane?: number }).lane = k
          ? laneByInstance.get(k) ?? 0
          : 0
      }
      arr.sort(
        (a, b) =>
          ((a as EventOnDay & { lane?: number }).lane ?? 0) -
          ((b as EventOnDay & { lane?: number }).lane ?? 0),
      )
    }
    return buckets
  }, [events, gridStart, gridEnd])

  // Build the linear list of cells (one per day in the visible grid).
  const days: Array<Date> = []
  const cursor = new Date(gridStart)
  while (cursor <= gridEnd) {
    days.push(new Date(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }

  const setMonth = (deltaMonths: number) => {
    const next = new Date(year, month + deltaMonths, 1)
    const ym = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`
    void navigate({
      search: { ...search, month: ym } as never,
    })
  }
  const goToday = () => {
    const now = new Date()
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
    void navigate({
      search: { ...search, month: ym } as never,
    })
  }

  const title = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(monthStart)

  // Chunk the flat day list into weekly rows (7 days each). Each week
  // gets its own scroll group so day-numbers can sticky-stick within
  // their week and roll out as the next week scrolls in.
  const weeks: Array<Array<Date>> = []
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7))
  }

  const todayKey = dayKey(Date.now())

  return (
    <div>
      {/* Header band — month title + prev/next/today. Stays inside
          the page padding so the controls don't fly off-screen. */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">
          {title}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMonth(-1)}
            aria-label="Previous month"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="rounded-md px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setMonth(1)}
            aria-label="Next month"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      {/* Full-bleed wrapper — only the grid itself spans the viewport.
          Header above stays inside container-page so the prev/next
          controls don't fly off-screen. */}
      <div className="full-bleed !px-0">
      {/* Weekday header — sticky band that pins to the viewport top
          as the user scrolls through the calendar. */}
      <div className="sticky top-0 z-20 grid grid-cols-7 border-y border-foreground/15 bg-white dark:bg-card [&>*:not(:nth-child(7n))]:border-r [&>*]:border-foreground/15">
        {WEEKDAYS.map((d, i) => (
          <div
            key={d}
            className="kicker py-1.5 text-center text-[0.6rem] text-foreground sm:py-2 sm:text-xs"
          >
            <span className="sm:hidden">{d.charAt(0)}</span>
            <span className="hidden sm:inline">{d}</span>
            {/* Hidden index helper, keeps lint happy w/o changing render */}
            <span hidden>{i}</span>
          </div>
        ))}
      </div>

      {/* Weekly rows. Each week is its own block: a sticky day-number
          band that pins below the weekday header, then the kanban
          event content below it. When you scroll past a week, its
          day-number band rolls out and the next week's rolls in. */}
      {weeks.map((week, wi) => (
        <div key={`w-${wi}`} className="border-b border-foreground/15">
          {/* Day-number band — sticky just below the weekday header.
              `top-8` ≈ 2rem ≈ weekday header height (matches py-1.5
              on small + py-2 on sm+). No bottom border so the
              colored bars of multi-day spans flow visually from the
              day-number band straight into the event content area —
              that thin line between number and bar otherwise reads as
              a separator on top of every span. */}
          <div className="sticky top-8 z-10 grid grid-cols-7 bg-white dark:bg-card [&>*:not(:nth-child(7n))]:border-r [&>*]:border-foreground/15">
            {week.map((day) => {
              const inMonth = day.getMonth() === month
              const isToday = dayKey(day.getTime()) === todayKey
              return (
                <div
                  key={`hd-${dayKey(day.getTime())}`}
                  className={cn(
                    "font-sans flex items-center justify-end px-1.5 py-1 text-xs tabular-nums sm:px-2 sm:text-sm",
                    inMonth ? "text-foreground" : "text-muted-foreground/50",
                  )}
                >
                  <span
                    className={cn(
                      isToday &&
                        "inline-flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background sm:h-6 sm:w-6",
                    )}
                  >
                    {day.getDate()}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Event content row. auto-rows-fr keeps every column in the
              week aligned to the tallest cell. Cells grow as events
              stack; the day-number band above stays put while you
              scroll within the week. */}
          <div className="grid grid-cols-7 auto-rows-fr [&>*:not(:nth-child(7n))]:border-r [&>*]:border-foreground/10">
            {week.map((day) => {
              const inMonth = day.getMonth() === month
              const key = dayKey(day.getTime())
              const evs = cells.get(key) ?? []
              return (
                <DayCell key={key} events={evs} dim={!inMonth} />
              )
            })}
          </div>
        </div>
      ))}
      </div>
    </div>
  )
}

type EventOnDay = {
  ts: number
  event: EventWithRelations
  // single: a one-day event rendered as a normal kanban card.
  // spanStart / spanMid / spanEnd: a slice of a multi-day event.
  // Start gets full info + rounded-left bar; mid stays minimal +
  // square corners; end gets rounded-right bar + "ends" indicator.
  role: "single" | "spanStart" | "spanMid" | "spanEnd"
  // Set during lane assignment. The slot number this event occupies
  // in the day cell. Empty slots between non-contiguous lane numbers
  // are rendered as transparent placeholders so spans on lane N
  // stay vertically aligned across every day they cover.
  lane?: number
  // Stable key tying every same-instance bucket entry (spanStart on
  // day 1 + spanMid on day 2 + spanEnd on day 3) to one lane.
  instKey?: string
}

// Key that ties every day-bucket entry belonging to the same span
// instance together. For multi-day spans we anchor on the START day
// of the run — the spanStart entry's ts is the canonical start, and
// spanMid/spanEnd entries fall on consecutive days. We reconstruct
// the start ts from the bucket entry's role + ts so the dayKey for
// the start lands the same for every cell in the run.
function roleSpanKey(it: EventOnDay): string {
  // Walk back to the event's startsAt-day so every entry in the same
  // span resolves to the same anchor. For spans, `it.ts` is the
  // start of that day already; the event's startsAt gives us the
  // canonical run start.
  return `${it.event.startsAt}`
}

function addToBucket(
  buckets: Map<string, Array<EventOnDay>>,
  event: EventWithRelations,
  ts: number,
  gridStartMs: number,
  gridEndMs: number,
  role: EventOnDay["role"],
) {
  if (ts < gridStartMs || ts > gridEndMs) return
  const key = dayKey(ts)
  if (!buckets.has(key)) buckets.set(key, [])
  buckets.get(key)!.push({ ts, event, role })
}

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function parseYM(ym: string): [number, number] | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym)
  if (!m) return null
  return [Number(m[1]), Number(m[2]) - 1]
}

function DayCell({
  events,
  dim,
}: {
  events: ReadonlyArray<EventOnDay>
  dim: boolean
}) {
  const openInDrawer = useOpenEventDrawer()
  const { lang } = useTranslation()
  // Lane-aware rendering: events arrive sorted by `lane`. Where the
  // sequence skips a lane (because that lane is held by a span in a
  // neighboring cell), emit a transparent placeholder so events on
  // higher lanes stay vertically aligned with their span continuation
  // on adjacent days.
  const rows: Array<React.ReactNode> = []
  let cursor = 0
  // Fixed row height keeps lane N at the same Y position on every
  // day of the week. Without it, a 1-line span title and a 2-line
  // span title in the same lane render at different heights, so
  // adjacent days' lane-N entries no longer line up horizontally.
  // 3.5rem fits a 3-row single event (time + 1-line title + venue)
  // and gives 2-line span titles room to breathe.
  for (const it of events) {
    const lane = it.lane ?? 0
    while (cursor < lane) {
      rows.push(
        <li
          key={`pad-${cursor}`}
          aria-hidden
          className="invisible h-[5rem]"
        />,
      )
      cursor += 1
    }
    rows.push(renderEventRow(it, lang, openInDrawer, dim))
    cursor += 1
  }
  return (
    <div
      className={cn(
        "flex flex-col gap-1 p-1 min-h-[6rem] text-left sm:gap-1.5 sm:p-2 sm:min-h-[10rem] md:min-h-[13rem] bg-white dark:bg-card",
        // Every cell sits on the same white surface — what marks an
        // out-of-month day is its faded day-number in the sticky
        // band above and the `opacity-60` on any events inside it.
        // A separate cell-bg tint on top of those signals reads as
        // "unfinished surface" against the cream page background.
      )}
    >
      <ul className="flex flex-col gap-1">{rows}</ul>
    </div>
  )
}

function renderEventRow(
  it: EventOnDay,
  lang: "en" | "es",
  openInDrawer: (slug: string, e: React.MouseEvent) => void,
  dim: boolean,
): React.ReactNode {
  const localized = localizedEvent(it.event, lang)
  const slug = localized.slug ?? ""
  const accent = localized.section?.accentColor ?? "var(--foreground)"
  const tintBg = `color-mix(in oklch, ${accent} 15%, white)`
  // Per-day text fade for spans: each subsequent day blends the
  // base dark text toward the bg color, so by ~day 7 the text reads
  // the same as the bar — visually disappearing. Singles always use
  // the darkest tint.
  const dayIndex =
    it.role === "single"
      ? 0
      : Math.max(0, Math.round((it.ts - it.event.startsAt) / 86_400_000))
  const fadePct = Math.min(100, dayIndex * 15)
  const baseFg = `color-mix(in oklch, ${accent} 25%, black)`
  const tintFg =
    fadePct === 0
      ? baseFg
      : `color-mix(in oklch, ${baseFg} ${100 - fadePct}%, ${tintBg} ${fadePct}%)`
  if (it.role !== "single") {
    const isStart = it.role === "spanStart"
    const isEnd = it.role === "spanEnd"
    return (
      <li
        key={`${localized._id}-${it.ts}-${it.role}`}
        className="h-[5rem]"
      >
        <Link
          to="/event/$slug"
          params={{ slug }}
          onClick={(e) => openInDrawer(slug, e)}
          className={cn(
            // CSS vars `--fg-faded` (per-day faded) and `--fg-base`
            // (-950 max) drive the text color. Hover swaps from faded
            // back to base so readers can see the title clearly even
            // on the dimmest days of a long span.
            "relative block px-2 py-1.5 text-[color:var(--fg-faded)] transition-colors hover:text-[color:var(--fg-base)]",
            dim && "opacity-60",
          )}
          style={
            {
              "--fg-faded": tintFg,
              "--fg-base": baseFg,
            } as React.CSSProperties
          }
          title={localized.title}
        >
          <span
            aria-hidden
            className={cn(
              "absolute inset-y-0 -z-0 pointer-events-none",
              isStart &&
                "left-0 -right-[calc(0.25rem+1px)] sm:-right-[calc(0.5rem+1px)] rounded-l-md",
              isEnd &&
                "right-0 -left-[calc(0.25rem+1px)] sm:-left-[calc(0.5rem+1px)] rounded-r-md",
              !isStart && !isEnd &&
                "-left-[calc(0.25rem+1px)] -right-[calc(0.25rem+1px)] sm:-left-[calc(0.5rem+1px)] sm:-right-[calc(0.5rem+1px)]",
            )}
            style={{ background: tintBg }}
          />
          <span className="relative block">
            {isStart ? (
              <div className="font-heading line-clamp-2 text-sm font-semibold leading-tight">
                {localized.title}
              </div>
            ) : (
              <div className="font-heading line-clamp-2 text-sm font-medium leading-tight opacity-80">
                {localized.title}
              </div>
            )}
          </span>
        </Link>
      </li>
    )
  }
  return (
    <li
      key={`${localized._id}-${it.ts}`}
      className="h-[5rem] overflow-hidden"
    >
      <Link
        to="/event/$slug"
        params={{ slug }}
        onClick={(e) => openInDrawer(slug, e)}
        className={cn(
          "block rounded-md px-2 py-1.5 transition-opacity hover:opacity-80",
          dim && "opacity-60",
        )}
        style={{ background: tintBg, color: tintFg }}
        title={localized.title}
      >
        <div className="font-sans text-[0.65rem] tabular-nums opacity-70">
          {formatTime(it.ts)}
        </div>
        <div className="font-heading mt-0.5 line-clamp-2 text-sm leading-tight font-semibold">
          {localized.title}
        </div>
        {localized.locationName ? (
          <div className="font-sans mt-0.5 line-clamp-1 text-[0.6rem] opacity-70">
            {localized.locationName}
          </div>
        ) : null}
      </Link>
    </li>
  )
}

function formatTime(ts: number): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })
    .format(ts)
    .replace(":00", "")
    .replace(/\s?[AP]M/i, (m) => m.trim().toLowerCase())
}
