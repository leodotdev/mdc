import { Link } from "@tanstack/react-router"
import { MapPin } from "lucide-react"

import type { EventWithSection } from "@/lib/event-helpers"
import { formatEventTime } from "@/lib/event-helpers"
import { useTranslation } from "@/lib/i18n/context"
import { localizedEvent } from "@/lib/localized-event"
import { HeroImg } from "@/components/site/hero-img"

const ONE_DAY_MS = 24 * 3_600_000

// "Happening soon" — events starting between now and the next 24 hours,
// rendered as a horizontal strip. Hidden when the next 24h has nothing
// scheduled (most overnight hours, e.g.).
//
// Each tile is section-accented (`border-l-2` + kicker color), shows
// time + location, and is the click target — opens the event URL when
// present, the linked article when not, falls back to a static tile.
export function HappeningNowStrip({
  events,
}: {
  events: Array<EventWithSection>
}) {
  const now = Date.now()
  const cutoff = now + ONE_DAY_MS
  const happening = events
    .filter((e) => e.startsAt >= now && e.startsAt < cutoff)
    .sort((a, b) => a.startsAt - b.startsAt)
    .slice(0, 8)

  if (happening.length === 0) return null

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <h2 className="font-sans text-base font-semibold">
          <span className="relative inline-flex items-center gap-2">
            <span
              aria-hidden
              className="size-2 rounded-full bg-destructive shadow-[0_0_0_3px_color-mix(in_oklch,var(--destructive)_30%,transparent)]"
            />
            Happening soon
          </span>
        </h2>
        <span className="meta text-xs tabular-nums">
          {happening.length} {happening.length === 1 ? "event" : "events"}{" "}
          in the next 24 hours
        </span>
      </header>

      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6">
        {happening.map((e) => (
          <HappeningCard key={e._id} event={e} />
        ))}
      </div>
    </section>
  )
}

function HappeningCard({ event: rawEvent }: { event: EventWithSection }) {
  const { lang } = useTranslation()
  const event = localizedEvent(rawEvent, lang)
  const accent = event.section?.accentColor ?? "var(--foreground)"
  const label = event.section?.name ?? "Event"
  const time = formatEventTime(event)
  const heroImage = event.heroImage
  const inner = (
    <article
      className="flex h-full w-[280px] shrink-0 snap-start flex-col gap-2 rounded-md border bg-card p-4 transition-colors hover:bg-muted/50"
      style={{ borderLeftWidth: "3px", borderLeftColor: accent }}
    >
      {heroImage ? (
        <HeroImg
          url={heroImage}
          width={480}
          className="aspect-[16/10] w-full rounded-[3px] object-cover"
        />
      ) : null}
      <span
        className="kicker text-[0.6rem]"
        style={{ color: accent }}
      >
        {label}
      </span>
      <h3 className="font-heading text-base leading-tight font-semibold line-clamp-3">
        {event.title}
      </h3>
      <div className="meta mt-auto flex flex-wrap items-center gap-x-2 text-xs">
        <time dateTime={new Date(event.startsAt).toISOString()}>{time}</time>
        {event.locationName ? (
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3" aria-hidden />
            {event.locationName}
          </span>
        ) : null}
      </div>
    </article>
  )
  // Always prefer the drawer when a slug is available — the drawer
  // surfaces the external URL / linked article as CTAs inside its body
  // (see EventLayout). External-only and article-only fallbacks remain
  // for legacy rows that haven't been re-saved through the new write
  // path that stamps a slug.
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
        className="snap-start"
      >
        {inner}
      </Link>
    )
  }
  if (event.url) {
    return (
      <a
        href={event.url}
        target="_blank"
        rel="noreferrer"
        className="snap-start"
      >
        {inner}
      </a>
    )
  }
  // article fallback removed with the article-era purge.
  return <div className="snap-start">{inner}</div>
}
