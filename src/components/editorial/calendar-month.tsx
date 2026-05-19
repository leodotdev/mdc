import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useMemo } from "react"

import type { EventWithRelations } from "@/lib/article-types"
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

  // Bucket events by day key. Expand recurring events forward across
  // the visible grid so each occurrence lands on its own day cell.
  const cells = useMemo(() => {
    const buckets = new Map<string, Array<EventOnDay>>()
    const gridStartMs = gridStart.getTime()
    const gridEndMs = gridEnd.getTime() + 86_400_000
    for (const e of events) {
      // Anchor occurrence — the event's actual startsAt.
      addToBucket(buckets, e, e.startsAt, gridStartMs, gridEndMs)
      // RRULE expansion — pull up to 40 future occurrences and place
      // every one that lands in the visible grid.
      if (e.recurrenceRule) {
        const occs = nextOccurrences(e.recurrenceRule, e.startsAt, 40)
        for (const ts of occs) {
          if (ts === e.startsAt) continue // already added above
          addToBucket(buckets, e, ts, gridStartMs, gridEndMs)
        }
      }
    }
    // Sort each bucket by time of day.
    for (const arr of buckets.values()) {
      arr.sort((a, b) => a.ts - b.ts)
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
    // Full-bleed wrapper: break out of the route's container-page
    // padding so the grid spans edge-to-edge. The negative margins
    // match the container's responsive paddings.
    <div className="-mx-4 sm:-mx-6 lg:-mx-8 xl:-mx-12">
      {/* Header band — month title + prev/next/today. Stays inside
          the page padding so the controls don't fly off-screen. */}
      <div className="mx-4 sm:mx-6 lg:mx-8 xl:mx-12 mb-3 flex items-center justify-between">
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

      {/* Weekday header — sticky band that pins to the viewport top
          as the user scrolls through the calendar. */}
      <div className="sticky top-0 z-20 grid grid-cols-7 border-y border-foreground/15 bg-background [&>*:not(:nth-child(7n))]:border-r [&>*]:border-foreground/15">
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
              on small + py-2 on sm+). */}
          <div className="sticky top-8 z-10 grid grid-cols-7 border-b border-foreground/10 bg-background [&>*:not(:nth-child(7n))]:border-r [&>*]:border-foreground/15">
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
  )
}

type EventOnDay = {
  ts: number
  event: EventWithRelations
}

function addToBucket(
  buckets: Map<string, Array<EventOnDay>>,
  event: EventWithRelations,
  ts: number,
  gridStartMs: number,
  gridEndMs: number,
) {
  if (ts < gridStartMs || ts > gridEndMs) return
  const key = dayKey(ts)
  if (!buckets.has(key)) buckets.set(key, [])
  buckets.get(key)!.push({ ts, event })
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
  // Kanban-style: every event in the day shows, vertically stacked.
  // Each card is its own bordered block with the section accent as a
  // left stripe. The day number / today badge live in the sticky
  // header band above, so this cell is just events + padding.
  return (
    <div
      className={cn(
        "flex flex-col gap-1 bg-background p-1 min-h-[6rem] text-left sm:gap-1.5 sm:p-2 sm:min-h-[10rem] md:min-h-[13rem]",
        dim && "bg-muted/30",
      )}
    >
      <ul className="flex flex-col gap-1">
        {events.map((it) => {
          const slug = it.event.slug ?? ""
          const accent = it.event.section?.accentColor ?? "var(--foreground)"
          return (
            <li key={`${it.event._id}-${it.ts}`}>
              <Link
                to="/event/$slug"
                params={{ slug }}
                onClick={(e) => openInDrawer(slug, e)}
                className={cn(
                  "block rounded-sm border border-foreground/10 bg-foreground/[0.02] px-1.5 py-1 transition-colors hover:bg-foreground/10",
                  "border-l-[3px]",
                  dim && "opacity-60",
                )}
                style={{ borderLeftColor: accent }}
                title={it.event.title}
              >
                <div className="font-sans text-[0.65rem] tabular-nums text-muted-foreground">
                  {formatTime(it.ts)}
                </div>
                <div className="font-heading mt-0.5 text-[0.78rem] leading-tight font-semibold text-foreground">
                  {it.event.title}
                </div>
                {it.event.locationName ? (
                  <div className="font-sans mt-0.5 line-clamp-1 text-[0.6rem] text-muted-foreground">
                    {it.event.locationName}
                  </div>
                ) : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
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
