import { Link } from "@tanstack/react-router"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useEffect, useRef } from "react"

import { Button } from "@/components/ui/button"
import { EVENT_KINDS } from "../../../convex/lib/eventKinds"
import {
  formatDayNumber,
  formatEventTime,
  formatWeekRange,
  formatWeekday,
} from "@/lib/event-helpers"
import type { EventWithSection } from "@/lib/event-helpers"
import { cn } from "@/lib/utils"

// Horizontal-scrolling week view. Each visible "page" is a single week
// column with 7 day rows stacked vertically. Snap-aligned so trackpad +
// touch swipes lock onto whole weeks. Sentinels at both ends call back
// to the parent to extend the loaded range — the parent owns the range
// state so the surrounding `useSuspenseQuery` (Convex) can refetch with
// the new bounds.
//
// Each event tile is colored by the section accent (cross-section
// categorization — a band-playing event under Music renders violet
// even when filed via the events-desk) with the kind kicker as a
// secondary line.

const KIND_BY_SLUG = new Map(EVENT_KINDS.map((k) => [k.slug, k]))

export function CalendarWeek({
  weekStarts,
  eventsByDay,
  onLoadEarlier,
  onLoadLater,
}: {
  /** Sorted list of week-start timestamps (UTC midnight Sunday). */
  weekStarts: Array<number>
  /** Pre-bucketed events keyed by YYYY-MM-DD (Miami day). */
  eventsByDay: Map<string, Array<EventWithSection>>
  onLoadEarlier: () => void
  onLoadLater: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const earlierRef = useRef<HTMLDivElement>(null)
  const laterRef = useRef<HTMLDivElement>(null)
  const todayWeekRef = useRef<HTMLDivElement>(null)
  const didInitialScroll = useRef(false)

  // Scroll today's week into view on first paint so the user lands on
  // "this week" rather than the leftmost (oldest) week.
  useEffect(() => {
    if (didInitialScroll.current) return
    if (todayWeekRef.current) {
      todayWeekRef.current.scrollIntoView({
        behavior: "auto",
        inline: "start",
        block: "nearest",
      })
      didInitialScroll.current = true
    }
  }, [weekStarts])

  // Sentinel observers — when the leftmost / rightmost edge slides into
  // view, ask the parent for more weeks.
  //
  // Deferred to two animation frames after mount so the auto-scroll
  // above has time to settle. Without this delay, the leftmost sentinel
  // can fire as in-view during the same frame the scroll executes,
  // triggering a load before today's week is even centered.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let observer: IntersectionObserver | null = null
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        observer = new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              if (!e.isIntersecting) continue
              if (e.target === earlierRef.current) onLoadEarlier()
              if (e.target === laterRef.current) onLoadLater()
            }
          },
          { root: el, rootMargin: "200px" },
        )
        if (earlierRef.current) observer.observe(earlierRef.current)
        if (laterRef.current) observer.observe(laterRef.current)
      })
      void raf2
    })
    return () => {
      cancelAnimationFrame(raf1)
      observer?.disconnect()
    }
  }, [onLoadEarlier, onLoadLater])

  const scrollByWeek = (direction: 1 | -1) => {
    const el = scrollRef.current
    if (!el) return
    const firstCol = el.querySelector<HTMLElement>("[data-week-col]")
    const colWidth = firstCol?.offsetWidth ?? el.clientWidth
    el.scrollBy({ left: direction * colWidth, behavior: "smooth" })
  }

  const todayWeekStart = (() => {
    const now = new Date()
    const utcSunday = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - now.getUTCDay(),
    )
    return utcSunday
  })()

  return (
    <div className="relative">
      {/* Side scroll affordances — visible on mouse-only desktops. */}
      <div className="absolute -top-12 right-0 z-10 flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Previous week"
          onClick={() => scrollByWeek(-1)}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Next week"
          onClick={() => scrollByWeek(1)}
        >
          <ChevronRight />
        </Button>
      </div>

      <div
        ref={scrollRef}
        className="relative -mx-4 flex snap-x snap-mandatory overflow-x-auto scroll-smooth pb-4 md:-mx-6"
        style={{ scrollbarGutter: "stable" }}
      >
        <div
          ref={earlierRef}
          aria-hidden
          className="meta flex w-12 shrink-0 items-center justify-center pl-4 text-xs md:pl-6"
        >
          ←
        </div>

        {weekStarts.map((weekStart) => {
          const isCurrent = weekStart === todayWeekStart
          return (
            <div
              key={weekStart}
              ref={isCurrent ? todayWeekRef : undefined}
              data-week-col
              className="flex w-[88vw] shrink-0 snap-start flex-col gap-2 px-4 first:pl-4 last:pr-4 sm:w-[420px] md:px-3 md:first:pl-6 md:last:pr-6"
            >
              <header
                className={cn(
                  "flex items-baseline justify-between border-b-[3px] pb-1",
                  isCurrent
                    ? "border-foreground"
                    : "border-foreground/20",
                )}
              >
                <h3 className="font-sans text-sm font-bold uppercase tracking-[0.18em]">
                  {formatWeekRange(weekStart)}
                </h3>
                {isCurrent ? (
                  <span className="kicker text-[0.65rem]">This week</span>
                ) : null}
              </header>
              <DayList
                weekStart={weekStart}
                eventsByDay={eventsByDay}
              />
            </div>
          )
        })}

        <div
          ref={laterRef}
          aria-hidden
          className="meta flex w-12 shrink-0 items-center justify-center pr-4 text-xs md:pr-6"
        >
          →
        </div>
      </div>
    </div>
  )
}

function DayList({
  weekStart,
  eventsByDay,
}: {
  weekStart: number
  eventsByDay: Map<string, Array<EventWithSection>>
}) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const dayMs = weekStart + i * 24 * 3_600_000
    const d = new Date(dayMs)
    const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
    return { dayMs, dayKey: k }
  })
  const todayDayKey = (() => {
    const n = new Date()
    return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, "0")}-${String(n.getUTCDate()).padStart(2, "0")}`
  })()

  return (
    <ol className="flex flex-col divide-y divide-foreground/10">
      {days.map(({ dayMs, dayKey }) => {
        const events = eventsByDay.get(dayKey) ?? []
        const isToday = dayKey === todayDayKey
        return (
          <li key={dayKey} className="flex gap-4 py-3">
            <div className="flex w-12 shrink-0 flex-col items-end pt-0.5">
              <span
                className={cn(
                  "font-sans text-[0.65rem] font-bold uppercase tracking-[0.12em]",
                  isToday
                    ? "text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {formatWeekday(dayMs)}
              </span>
              <span
                className={cn(
                  "font-heading text-2xl font-semibold leading-none tabular-nums",
                  isToday
                    ? "text-foreground"
                    : events.length === 0
                      ? "text-muted-foreground/60"
                      : "text-foreground",
                )}
              >
                {formatDayNumber(dayMs)}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              {events.length === 0 ? (
                <p className="meta text-xs">—</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {events.map((e) => (
                    <li key={e._id}>
                      <EventTile event={e} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function EventTile({ event }: { event: EventWithSection }) {
  const accent = event.section?.accentColor ?? "var(--foreground)"
  const kind = event.kind ? KIND_BY_SLUG.get(event.kind) : undefined
  const time = formatEventTime(event)
  const Anchor = event.url
    ? (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
        <a {...props} href={event.url} target="_blank" rel="noreferrer" />
      )
    : event.article
      ? (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
          <Link
            to="/article/$slug"
            params={{ slug: event.article!.slug }}
            className={props.className}
          >
            {props.children}
          </Link>
        )
      : (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />
  return (
    <Anchor
      className="group/event flex flex-col gap-0.5 border-l-2 pl-2 transition-colors hover:bg-muted/40"
      style={{ borderLeftColor: accent }}
    >
      <span
        className="kicker text-[0.6rem]"
        style={{ color: accent }}
      >
        {event.section?.name ?? kind?.label ?? "Event"}
      </span>
      <span className="font-heading text-sm font-semibold leading-snug">
        {event.title}
      </span>
      <span className="meta text-[0.7rem]">
        <span>{time}</span>
        {event.locationName ? <span> · {event.locationName}</span> : null}
        {event.neighborhood ? <span> · {event.neighborhood}</span> : null}
      </span>
    </Anchor>
  )
}
