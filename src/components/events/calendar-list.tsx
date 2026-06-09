import { Link } from "@tanstack/react-router"
import { Loader2, MapPin } from "lucide-react"
import { useEffect, useRef } from "react"

import type { EventWithSection } from "@/lib/event-helpers"
import { formatEventTime, todayKey } from "@/lib/event-helpers"
import { useTranslation } from "@/lib/i18n/context"
import { localizedEvent } from "@/lib/localized-event"
import { HeroImg } from "@/components/site/hero-img"
import { cn } from "@/lib/utils"

// Vertical timeline view — events grouped by day, days only rendered
// when they have at least one event (skipping empty days keeps the
// reader scrolling through density rather than whitespace).
//
// Forward-only chronology from today. A sentinel at the bottom asks
// the parent for more days when it slides into view; the parent owns
// the range and refetches with a wider end bound.
export function CalendarList({
  daysWithEvents,
  focalDay,
  loading = false,
  onLoadMore,
}: {
  daysWithEvents: Array<{ dayKey: string; events: Array<EventWithSection> }>
  /** Day key (YYYY-MM-DD) the reader has focused via the minimap. The
   *  list itself does NOT scroll to this day — the page should stay
   *  put when the reader picks a date — but the focal day still gets a
   *  visual ring so they can find their pick by eye. */
  focalDay: string | undefined
  loading?: boolean
  onLoadMore: () => void
}) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const cooldownRef = useRef(false)

  useEffect(() => {
    const target = sentinelRef.current
    if (!target) return
    let observer: IntersectionObserver | null = null
    // Defer observer setup so the first paint settles before we start
    // watching for intersections — avoids firing onLoadMore at mount
    // when the sentinel renders inside the initial viewport.
    const raf = requestAnimationFrame(() => {
      observer = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue
            if (cooldownRef.current) continue
            cooldownRef.current = true
            onLoadMore()
            setTimeout(() => {
              cooldownRef.current = false
            }, 800)
          }
        },
        { rootMargin: "400px" },
      )
      observer.observe(target)
    })
    return () => {
      cancelAnimationFrame(raf)
      observer?.disconnect()
    }
  }, [onLoadMore])

  if (daysWithEvents.length === 0 && !loading) {
    return (
      <p className="font-editorial mt-12 max-w-2xl text-lg text-muted-foreground">
        No upcoming events. Try Week or Month view to browse the calendar
        directly.
      </p>
    )
  }

  const today = todayKey()

  return (
    <div className="flex flex-col gap-10">
      {daysWithEvents.map(({ dayKey, events }) => {
        const isToday = dayKey === today
        const isFocal = dayKey === focalDay
        return (
          <section
            key={dayKey}
            className={cn(
              "grid gap-4 md:grid-cols-[8rem_1fr]",
              isToday && "rounded-md bg-primary/5 p-3 ring-2 ring-primary/40",
              isFocal && !isToday && "rounded-md p-3 ring-2 ring-primary",
            )}
            aria-current={isToday ? "date" : undefined}
          >
            <header className="md:sticky md:top-24 md:self-start">
              <p
                className={cn(
                  "font-sans text-sm font-semibold",
                  isToday ? "text-primary" : "text-muted-foreground",
                )}
              >
                {isToday ? "Today" : formatDayHeader(dayKey).weekday}
              </p>
              <p
                className={cn(
                  "font-heading text-3xl leading-none font-semibold tabular-nums",
                  isToday ? "text-primary" : "text-foreground/80",
                )}
              >
                {formatDayHeader(dayKey).monthDay}
              </p>
              <p className="meta mt-1 text-xs">
                {events.length} {events.length === 1 ? "event" : "events"}
              </p>
            </header>
            <ul className="flex flex-col divide-y divide-foreground/10 border-t border-foreground/10 md:border-t-0">
              {events.map((e) => (
                <li key={e._id}>
                  <ListEventCard event={e} />
                </li>
              ))}
            </ul>
          </section>
        )
      })}

      <div
        ref={sentinelRef}
        aria-hidden
        className="flex items-center justify-center py-8"
      >
        {loading ? (
          <span className="meta inline-flex items-center gap-2 text-xs">
            <Loader2 className="size-4 animate-spin" />
            Loading more
          </span>
        ) : (
          <span className="meta text-xs">More events load as you scroll.</span>
        )}
      </div>
    </div>
  )
}

function formatDayHeader(dayKeyStr: string): {
  weekday: string
  monthDay: string
} {
  const [y, m, d] = dayKeyStr.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return {
    weekday: date.toLocaleDateString("en-US", {
      weekday: "long",
      timeZone: "UTC",
    }),
    monthDay: date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }),
  }
}

// One event row in the timeline — image (when present) + section accent
// kicker + title + dek + time/venue meta line. Click target follows the
// same precedence the rest of the events UI uses: external URL → linked
// article → static.
function ListEventCard({ event: rawEvent }: { event: EventWithSection }) {
  const { lang } = useTranslation()
  const event = localizedEvent(rawEvent, lang)
  const accent = event.section?.accentColor ?? "var(--foreground)"
  const label = event.section?.name ?? "Event"
  const time = formatEventTime(event)

  const Body = (
    <article className="group/event grid gap-4 py-4 transition-colors sm:grid-cols-[1fr_140px]">
      <div className="flex min-w-0 flex-col gap-2">
        <span className="kicker text-[0.65rem]" style={{ color: accent }}>
          {label}
        </span>
        <h3 className="font-heading text-lg leading-snug font-semibold transition-colors group-hover/event:text-primary">
          {event.title}
        </h3>
        {event.description ? (
          <p className="font-sans line-clamp-2 text-sm text-muted-foreground">
            {event.description}
          </p>
        ) : null}
        <div className="meta mt-auto flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
          <time dateTime={new Date(event.startsAt).toISOString()}>{time}</time>
          {event.locationName ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" aria-hidden />
              {event.locationName}
            </span>
          ) : null}
          {event.neighborhoods?.[0] ? (
            <span>· {event.neighborhoods[0]}</span>
          ) : null}
          {event.price ? <span>· {event.price}</span> : null}
        </div>
      </div>
      {event.heroImage ? (
        <HeroImg
          url={event.heroImage}
          width={320}
          className="aspect-[4/3] w-full rounded-md object-cover sm:h-full"
        />
      ) : null}
    </article>
  )

  // Prefer canonical event detail page for events with a slug; fall back
  // to external URL or related-article link for legacy rows.
  if (event.slug) {
    return (
      <Link
        to="."
        search={
          ((prev: Record<string, unknown>) => ({
            ...prev,
            event: event.slug,
          })) as never
        }
        className="block"
      >
        {Body}
      </Link>
    )
  }
  if (event.url) {
    return (
      <a href={event.url} target="_blank" rel="noreferrer" className="block">
        {Body}
      </a>
    )
  }
  // article fallback removed with the article-era purge.
  return Body
}

