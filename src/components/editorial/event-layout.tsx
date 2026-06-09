import { Link } from "@tanstack/react-router"
import {
  Calendar,
  DollarSign,
  ExternalLink,
  MapPin,
  Repeat,
} from "lucide-react"
import { useEffect, useState } from "react"

import { api } from "../../../convex/_generated/api"
import { neighborhoodName } from "../../../convex/lib/neighborhoods"
import { HeroCaption } from "./hero-caption"
import { SectionBadge } from "./section-badge"
import { ShareWidget } from "./share-widget"
import type { FunctionReturnType } from "convex/server"
import { EventLocationMap } from "./event-location-map"
import { AddToCalendar } from "@/components/events/add-to-calendar"
import { HeroImg } from "@/components/site/hero-img"
import { Button } from "@/components/ui/button"
import { useTranslation } from "@/lib/i18n/context"
import {
  effectiveStartsAt,
  formatEventDate,
  formatEventTime,
} from "@/lib/event-helpers"
import { localizedEvent } from "@/lib/localized-event"
import { describeRRule } from "@/lib/rrule"

type EventDoc = NonNullable<FunctionReturnType<typeof api.events.getBySlug>>

// Single source of truth for how a published event renders. Used by
// both /event/$slug and the EventModal so they stay pixel-identical
// except for the surrounding chrome.
//
// Layout: one column, left-aligned, top → bottom. Section badge +
// title, dek, icon-led meta strip (date / location / price /
// recurrence), action row, optional contained hero, single "Filed
// under" pill row, deferred map disclosure, single-line source.
//
// The earlier 12-col @container/event grid was dropped — the modal is
// ~672 px wide so the rail almost never activated, and on the
// dedicated route the linear layout reads cleaner anyway.
export function EventLayout({ rawEvent }: { rawEvent: EventDoc }) {
  const { lang } = useTranslation()
  const event = localizedEvent(rawEvent, lang)
  const heroImage = event.heroImage
  const neighborhoodSlugs = event.neighborhoods ?? []
  const neighborhoodLabels = neighborhoodSlugs
    .map((n) => neighborhoodName(n) ?? n)
    .filter(Boolean)
  // Comma-joined `Venue, Neighborhood` so it reads as one address
  // line, not two parallel facts.
  const locationText = [event.locationName, neighborhoodLabels[0]]
    .filter(Boolean)
    .join(", ")
  // Maps query — prefer the explicit street address when we have one,
  // otherwise fall back to the venue name + neighborhood. Routed
  // through Google Maps' universal search URL so it opens the user's
  // default map app on mobile and Maps in the browser on desktop.
  const mapsQuery = [
    event.locationAddress,
    event.locationName,
    neighborhoodLabels[0],
    "Miami, FL",
  ]
    .filter(Boolean)
    .join(", ")
  const mapsHref = locationText
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`
    : null
  const tags = event.tags ?? []
  // Recurring-event horizon: when the canonical startsAt has already
  // passed but the next occurrence is in the future (populated by the
  // recurrence cron), show the upcoming instance everywhere on the
  // page instead of last week's date.
  const effectiveStart = effectiveStartsAt(event)
  const dateLabel = formatEventDate(effectiveStart)
  const timeLabel = formatEventTime({
    ...event,
    startsAt: effectiveStart,
  })
  const hasCoords =
    typeof event.lat === "number" && typeof event.lng === "number"
  const sourceUrl = event.url ?? event.citations?.[0]?.url
  const sourceHostname = sourceUrl
    ? (() => {
        try {
          return new URL(sourceUrl).hostname.replace(/^www\./, "")
        } catch {
          return sourceUrl
        }
      })()
    : null
  const recurrenceLabel = event.recurrenceRule
    ? describeRRule(event.recurrenceRule)
    : null
  const priceLabel =
    event.price && event.price.trim().length > 0 ? event.price.trim() : null

  const calendarPayload = {
    id: event._id,
    title: event.title,
    description: event.description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    allDay: event.allDay,
    locationName: event.locationName,
    locationAddress: event.locationAddress,
    url: event.url,
  }

  return (
    <article className="flex flex-col gap-5">
      {/* Header — section accent kicker + headline + dek. Left-aligned
          to match the rest of the editorial cards. */}
      <header className="flex flex-col gap-3">
        <SectionBadge section={event.section} size="sm" />
        <h1 className="font-heading text-balance text-3xl leading-[1.1] font-semibold tracking-tight md:text-4xl">
          {event.title}
        </h1>
        {(event.dek || event.description) ? (
          <p className="font-editorial text-base leading-snug text-muted-foreground">
            {event.dek || event.description}
          </p>
        ) : null}
      </header>

      {/* Meta strip — icon-led facts grid. Replaces the six separately
          -labeled rail sections. Each fact is suppressed individually
          when the field is missing. */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <MetaItem icon={Calendar}>
          <span className="text-foreground">{dateLabel}</span>
          {timeLabel ? (
            <span className="text-muted-foreground"> · {timeLabel}</span>
          ) : null}
        </MetaItem>
        {locationText ? (
          <MetaItem icon={MapPin}>
            <span className="text-foreground">{locationText}</span>
          </MetaItem>
        ) : null}
        {priceLabel ? (
          <MetaItem icon={DollarSign}>
            <span className="text-foreground">{priceLabel}</span>
          </MetaItem>
        ) : null}
        {recurrenceLabel ? (
          <MetaItem icon={Repeat}>
            <span className="text-foreground">{recurrenceLabel}</span>
          </MetaItem>
        ) : null}
      </div>

      {/* Action row — ghost-button trio so the chrome doesn't compete
          with the headline. "Get full details" is the primary intent
          (off-site link to the source); calendar + share sit next to
          it as peer affordances. */}
      <div className="flex flex-wrap items-center gap-1">
        {sourceUrl ? (
          <Button
            variant="ghost"
            size="sm"
            render={
              <a href={sourceUrl} target="_blank" rel="noreferrer" />
            }
          >
            <ExternalLink className="size-4" />
            Get full details
          </Button>
        ) : null}
        <AddToCalendar event={calendarPayload} />
        <ShareWidget title={event.title} />
      </div>

      {/* Hero (image or video). Contained at max-height so weak stock
          images don't dominate the modal; suppressed entirely when no
          hero is present. */}
      {event.videoEmbed ? (
        <figure>
          <div className="relative aspect-video w-full overflow-hidden rounded-md bg-black">
            <iframe
              src={
                event.videoEmbed.provider === "youtube"
                  ? `https://www.youtube.com/embed/${event.videoEmbed.id}?rel=0&modestbranding=1&playsinline=1`
                  : `https://player.vimeo.com/video/${event.videoEmbed.id}`
              }
              title={event.title}
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="absolute inset-0 h-full w-full"
            />
          </div>
          {event.heroCaption ? (
            <figcaption className="mt-2 text-xs">
              <HeroCaption
                caption={event.heroCaption}
                citations={event.citations}
              />
            </figcaption>
          ) : null}
        </figure>
      ) : heroImage ? (
        <figure>
          <HeroImg
            url={heroImage}
            width={1200}
            priority
            alt={event.heroCaption ?? ""}
            className="aspect-[3/2] max-h-80 w-full rounded-md object-cover"
          />
          {event.heroCaption ? (
            <figcaption className="mt-2 text-xs">
              <HeroCaption
                caption={event.heroCaption}
                citations={event.citations}
              />
            </figcaption>
          ) : null}
        </figure>
      ) : null}

      {/* "Filed under" — tags + neighborhoods merged into one inline
          pill row. Both route to listing pages; the visual distinction
          was scaffolding, not signal. */}
      {tags.length > 0 || neighborhoodSlugs.length > 0 ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 text-xs">
          <span className="kicker text-muted-foreground">Filed under</span>
          {tags.slice(0, 8).map((tag) => (
            <Link
              key={`tag-${tag}`}
              to="/tag/$slug"
              params={{ slug: tag }}
              className="rounded-full border border-foreground/15 bg-background px-2.5 py-0.5 hover:bg-muted/60"
            >
              #{tag}
            </Link>
          ))}
          {neighborhoodSlugs.map((slug) => {
            const name = neighborhoodName(slug) ?? slug
            return (
              <Link
                key={`hood-${slug}`}
                to="/neighborhood/$slug"
                params={{ slug }}
                className="rounded-full border border-foreground/15 bg-background px-2.5 py-0.5 hover:bg-muted/60"
              >
                {name}
              </Link>
            )
          })}
        </div>
      ) : null}

      {/* Map block — `MapToggle` defers the actual EventLocationMap /
          Google iframe mount until the reader clicks "Show map". The
          modal opens ~100x more often than the map gets opened, and
          MapLibre + tile requests are heavy; this saves the network
          cost on the common case. */}
      {locationText || event.locationAddress ? (
        <MapToggle
          address={event.locationAddress}
          mapsHref={mapsHref}
          mapsQuery={mapsQuery}
          hasCoords={hasCoords}
          lat={event.lat}
          lng={event.lng}
          accentColor={event.section?.accentColor ?? "var(--foreground)"}
          title={event.title}
          locationName={event.locationName}
        />
      ) : null}

      {/* Source — single-line attribution, demoted to the bottom of
          the layout. Hidden when no source URL is known. */}
      {sourceUrl ? (
        <p className="meta text-xs">
          Source ·{" "}
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:text-foreground hover:underline break-all"
          >
            {sourceHostname}
            <ExternalLink className="size-3" aria-hidden />
          </a>
        </p>
      ) : null}
    </article>
  )
}

// Inline definition-list item — icon prefix + value, used in the meta
// strip. The icon column is fixed-width so values left-align across
// rows even when wraps occur.
function MetaItem({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  children: React.ReactNode
}) {
  return (
    <div className="flex items-baseline gap-2">
      <Icon
        className="relative top-[0.15em] size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <div className="min-w-0 leading-snug">{children}</div>
    </div>
  )
}

// Lazily mounts the map only when the user clicks "Show map".
// EventLocationMap initializes MapLibre + fires tile requests on
// mount; we avoid both until the reader actually opts in. `useEffect`
// resets the SSR fallback `closed` state on hydrate so the initial
// server render stays inert (no map markup), which keeps the page
// payload small.
function MapToggle({
  address,
  mapsHref,
  mapsQuery,
  hasCoords,
  lat,
  lng,
  accentColor,
  title,
  locationName,
}: {
  address: string | undefined
  mapsHref: string | null
  mapsQuery: string
  hasCoords: boolean
  lat: number | undefined
  lng: number | undefined
  accentColor: string
  title: string
  locationName: string | undefined
}) {
  const [open, setOpen] = useState(false)
  // Track hydration so the initial server render matches the client
  // render exactly (both show the toggle button, no map markup).
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])

  return (
    <div className="border-t border-foreground/10 pt-3">
      <div className="meta flex items-center gap-2 text-xs">
        <MapPin className="size-3.5" aria-hidden />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          disabled={!hydrated}
          className="font-medium hover:text-foreground disabled:opacity-50"
        >
          {open ? "Hide map ▾" : "Show map ▸"}
        </button>
        {mapsHref ? (
          <a
            href={mapsHref}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 hover:text-foreground hover:underline"
          >
            Open in Maps →
          </a>
        ) : null}
      </div>
      {open ? (
        <div className="mt-3 space-y-2">
          {address ? (
            <p className="text-xs text-muted-foreground">{address}</p>
          ) : null}
          {hasCoords ? (
            <EventLocationMap
              lat={lat as number}
              lng={lng as number}
              accentColor={accentColor}
              title={title}
            />
          ) : mapsHref ? (
            <div className="aspect-[4/3] w-full overflow-hidden rounded-md border border-foreground/10">
              <iframe
                title={`Map of ${locationName ?? title}`}
                src={`https://www.google.com/maps?q=${encodeURIComponent(mapsQuery)}&output=embed`}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="h-full w-full border-0"
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
