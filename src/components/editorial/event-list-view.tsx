import { Link } from "@tanstack/react-router"

import type { EventWithRelations } from "@/lib/article-types"
import { SectionBadge } from "@/components/editorial/section-badge"
import { HeroImg } from "@/components/site/hero-img"
import { effectiveStartsAt } from "@/lib/event-helpers"
import { useTranslation } from "@/lib/i18n/context"
import { localizedEvent } from "@/lib/localized-event"
import { describeRRule } from "@/lib/rrule"
import { useOpenEventDrawer } from "@/lib/use-open-article-drawer"
import { cn } from "@/lib/utils"

// Chronological event list — the "List" view mode. Events sorted by
// startsAt (upcoming first); past events drop off above a 24h cutoff
// so the list reads as forward-looking. Day-group dividers ("Today",
// "Tomorrow", weekday + date) anchor the chronology.
//
// Same per-item click behavior as every other event card: opens the
// event drawer via the `?event=slug` search param.

type Props = {
  events: ReadonlyArray<EventWithRelations>
  /** Empty state copy when the list is empty after filtering. */
  emptyLabel?: string
}

export function EventListView({ events, emptyLabel }: Props) {
  // Recurring-event horizon: sort + group by the next *effective*
  // occurrence (next future instance for recurring events; the raw
  // startsAt for one-offs). Otherwise a weekly yoga series with an
  // old DTSTART would land in the past and disappear from the list.
  type Decorated = { event: EventWithRelations; ts: number }
  const past = Date.now() - 24 * 3_600_000
  const sorted: Array<Decorated> = events
    .map((e) => ({ event: e, ts: effectiveStartsAt(e) }))
    .filter((d) => d.ts >= past)
    .sort((a, b) => a.ts - b.ts)

  if (sorted.length === 0) {
    return (
      <div className="font-editorial mx-auto mt-12 max-w-2xl text-center text-base text-muted-foreground">
        {emptyLabel ??
          "No upcoming events match this filter. Try a different section or check back soon."}
      </div>
    )
  }

  // Group by day so the renderer can interleave dividers.
  const groups = new Map<string, Array<Decorated>>()
  for (const d of sorted) {
    const key = dayKey(d.ts)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(d)
  }

  return (
    <ol className="mx-auto flex max-w-3xl flex-col">
      {Array.from(groups.entries()).map(([key, dayEntries]) => (
        <li key={key} className="flex flex-col">
          <DayDivider key={`${key}-h`} ts={dayEntries[0].ts} />
          <ul className="flex flex-col divide-y divide-foreground/15">
            {dayEntries.map(({ event, ts }) => (
              <EventRow key={event._id} event={event} effectiveTs={ts} />
            ))}
          </ul>
        </li>
      ))}
    </ol>
  )
}

function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function DayDivider({ ts }: { ts: number }) {
  const label = humanDay(ts)
  return (
    <div className="sticky top-0 z-10 bg-background py-3">
      <h3 className="kicker text-foreground">{label}</h3>
    </div>
  )
}

function humanDay(ts: number): string {
  const now = new Date()
  const d = new Date(ts)
  const todayKey = dayKey(now.getTime())
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowKey = dayKey(tomorrow.getTime())
  const thisKey = dayKey(ts)
  if (thisKey === todayKey) return "Today"
  if (thisKey === tomorrowKey) return "Tomorrow"
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(d)
}

function EventRow({
  event: rawEvent,
  effectiveTs,
}: {
  event: EventWithRelations
  effectiveTs: number
}) {
  const { lang } = useTranslation()
  const event = localizedEvent(rawEvent, lang)
  const openInDrawer = useOpenEventDrawer()
  const slug = event.slug ?? ""
  const time = event.allDay
    ? "All day"
    : new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
      }).format(effectiveTs)
  const recurrence = event.recurrenceRule
    ? describeRRule(event.recurrenceRule)
    : null
  const hasImage = !!event.heroImage
  return (
    <li
      className={cn(
        "group/event grid grid-cols-[auto_1fr] items-start gap-4 py-4 md:grid-cols-[6rem_1fr_auto] md:gap-6",
      )}
    >
      {/* Time column — fixed-width on desktop so titles align. */}
      <div className="font-sans pt-0.5 text-sm tabular-nums text-muted-foreground md:text-base">
        {time}
      </div>
      {/* Title + meta column */}
      <div className="min-w-0 flex flex-col gap-1">
        <Link
          to="/event/$slug"
          params={{ slug }}
          onClick={(e) => openInDrawer(slug, e)}
          className="font-heading text-base leading-snug font-semibold text-foreground transition-colors hover:text-primary md:text-lg"
        >
          {event.title}
        </Link>
        <div className="font-sans flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-xs text-muted-foreground md:text-sm">
          <SectionBadge section={event.section} size="sm" />
          {event.locationName ? <span>· {event.locationName}</span> : null}
          {recurrence ? <span>· {recurrence}</span> : null}
        </div>
      </div>
      {/* Thumbnail column — desktop only, square, suppressed when no image. */}
      {hasImage ? (
        <Link
          to="/event/$slug"
          params={{ slug }}
          onClick={(e) => openInDrawer(slug, e)}
          className="hidden md:block self-start [contain:paint]"
        >
          <HeroImg
            url={event.heroImage!}
            width={200}
            className="aspect-square w-24 object-cover transition-transform duration-200 ease-out group-hover/event:scale-[1.02]"
          />
        </Link>
      ) : null}
    </li>
  )
}
