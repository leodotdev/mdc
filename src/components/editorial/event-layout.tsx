import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ExternalLink, MapPin } from "lucide-react"

import { api } from "../../../convex/_generated/api"
import { neighborhoodName } from "../../../convex/lib/neighborhoods"
import { HeroCaption } from "./hero-caption"
import { SectionBadge } from "./section-badge"
import { ShareWidget } from "./share-widget"
import { SidebarRail, SidebarRailSection } from "./sidebar-rail"
import { SourcesBlock } from "./sources-block"
import type { FunctionReturnType } from "convex/server"
import { AddToCalendar } from "@/components/events/add-to-calendar"
import { EventListItem } from "@/components/events/event-list-item"
import { HeroImg } from "@/components/site/hero-img"
import { Button } from "@/components/ui/button"
import { useTranslation } from "@/lib/i18n/context"
import {
  formatEventDate,
  formatEventTime,
} from "@/lib/event-helpers"
import { localizedEvent } from "@/lib/localized-event"
import { useOpenArticleDrawer } from "@/lib/use-open-article-drawer"

type EventDoc = NonNullable<FunctionReturnType<typeof api.events.getBySlug>>

// Single source of truth for how a published event renders. Used by
// both /event/$slug and the EventDrawer overlay so they stay
// pixel-identical except for the surrounding chrome.
export function EventLayout({ rawEvent }: { rawEvent: EventDoc }) {
  const { lang } = useTranslation()
  const event = localizedEvent(rawEvent, lang)
  const openInDrawer = useOpenArticleDrawer()
  const heroImage = event.heroImage
  const neighborhoodSlugs = event.neighborhoods ?? []
  const neighborhoodLabels = neighborhoodSlugs
    .map((n) => neighborhoodName(n) ?? n)
    .filter(Boolean)
  // Visible location text — `Venue, Neighborhood`. Comma instead of the
  // bullet separator we use elsewhere so it reads as a single address
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
  const time = formatEventTime(event)

  return (
    <article className="py-2">
      {/* Header: kicker → title → date/time/location dek → meta pills →
          contained 16:9 hero. Mirrors ArticleHeader proportions so
          stories and events read in the same family. */}
      <header className="mx-auto max-w-3xl">
        <div className="flex flex-col gap-3 text-center">
          <div className="mx-auto">
            <SectionBadge section={event.section} size="md" />
          </div>
          <h1 className="display-xl mt-2">{event.title}</h1>

          {/* Line 1 — date · time · location (· price). Date pulled to
              foreground weight so it leads visually; time / location /
              price stay muted as supporting context. Clickable location
              opens Maps. */}
          <div className="font-sans mx-auto mt-2 flex max-w-2xl flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-base font-normal text-muted-foreground">
            <time
              dateTime={new Date(event.startsAt).toISOString()}
              className="font-medium text-foreground"
            >
              {formatEventDate(event.startsAt)}
            </time>
            {time ? <span aria-hidden>·</span> : null}
            {time ? (
              <span className="font-medium text-foreground">{time}</span>
            ) : null}
            {locationText ? <span aria-hidden>·</span> : null}
            {locationText && mapsHref ? (
              <a
                href={mapsHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                title="Open in Maps"
              >
                <MapPin className="size-3.5" aria-hidden />
                {locationText}
              </a>
            ) : locationText ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden />
                {locationText}
              </span>
            ) : null}
            {event.price ? <span aria-hidden>·</span> : null}
            {event.price ? <span>{event.price}</span> : null}
          </div>

          {/* Line 2 — #tags · neighborhood pills. Same pill shape so they
              read as one taxonomy strip. */}
          {tags.length > 0 || neighborhoodLabels.length > 0 ? (
            <div className="mx-auto flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
              {tags.slice(0, 4).map((tag) => (
                <Link
                  key={`tag-${tag}`}
                  to="/tag/$slug"
                  params={{ slug: tag }}
                  className="rounded-full border border-foreground/15 bg-card px-2.5 py-0.5 text-xs hover:bg-muted"
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
                    className="rounded-full border border-foreground/15 bg-card px-2.5 py-0.5 text-xs hover:bg-muted"
                  >
                    {name}
                  </Link>
                )
              })}
            </div>
          ) : null}

          {/* Line 3 — Share · Add to calendar · View event page. The
              external "View event page" button sits last so reader actions
              flow left-to-right: share-it, save-it, leave-for-the-source.
              Hairline above lifts the action row off the meta strip. */}
          <div className="mx-auto mt-3 flex w-fit flex-wrap items-center justify-center gap-2 border-t border-foreground/10 pt-3">
            <ShareWidget title={event.title} />
            <AddToCalendar
              event={{
                id: event._id,
                title: event.title,
                description: event.description,
                startsAt: event.startsAt,
                endsAt: event.endsAt,
                allDay: event.allDay,
                locationName: event.locationName,
                locationAddress: event.locationAddress,
                url: event.url,
              }}
            />
            {event.url ? (
              <Button
                size="sm"
                render={
                  <a href={event.url} target="_blank" rel="noreferrer" />
                }
              >
                <ExternalLink className="size-4" />
                View event page
              </Button>
            ) : null}
          </div>

        </div>

        {heroImage ? (
          <figure className="mt-8">
            <HeroImg
              url={heroImage}
              width={1200}
              priority
              alt={event.heroCaption ?? ""}
              className="aspect-[16/9] w-full object-cover"
            />
            {event.heroCaption ? (
              <figcaption className="mt-2 text-sm">
                <HeroCaption
                  caption={event.heroCaption}
                  citations={event.citations}
                />
              </figcaption>
            ) : null}
          </figure>
        ) : null}
      </header>

      {/* Body + rail. Same 9/3 split as article pages. */}
      <div className="mt-12 grid grid-cols-1 gap-x-10 lg:grid-cols-12">
        <div className="lg:col-span-9 lg:pr-2">
          {event.description ? (
            <div className="prose-editorial">
              <p>{event.description}</p>
            </div>
          ) : null}

          {event.article ? (
            <div className="mt-8 rounded-md border border-foreground/15 bg-card p-4">
              <p className="kicker mb-2 text-xs">Related story</p>
              <Link
                to="/article/$slug"
                params={{ slug: event.article.slug }}
                onClick={(e) => openInDrawer(event.article!.slug, e)}
                className="font-sans text-lg font-semibold leading-snug hover:text-primary"
              >
                {event.article.title}
              </Link>
            </div>
          ) : null}
        </div>

        <SidebarRail className="lg:col-span-3">
          {event.section ? (
            <RailMoreInSection
              sectionSlug={event.section.slug}
              sectionName={event.section.name}
              accentColor={event.section.accentColor}
              eventId={event._id}
            />
          ) : null}
        </SidebarRail>
      </div>

      {event.citations && event.citations.length > 0 ? (
        <SourcesBlock citations={event.citations} />
      ) : null}

      {event.section ? (
        <FullMoreInSection
          sectionSlug={event.section.slug}
          sectionName={event.section.name}
          accentColor={event.section.accentColor}
          eventId={event._id}
        />
      ) : null}
    </article>
  )
}

function RailMoreInSection({
  sectionSlug,
  sectionName,
  accentColor,
  eventId,
}: {
  sectionSlug: string
  sectionName: string
  accentColor: string
  eventId: string
}) {
  const { data } = useQuery(
    convexQuery(api.events.moreInSection, {
      sectionSlug,
      excludeId: eventId as never,
      limit: 4,
    }),
  )
  if (!data || data.events.length === 0) return null
  return (
    <SidebarRailSection
      title={`More ${sectionName} events`}
      more={
        <Link
          to="/section/$slug"
          params={{ slug: sectionSlug }}
          className="meta hover:underline"
          style={{ color: accentColor }}
        >
          All →
        </Link>
      }
    >
      <ul className="flex flex-col divide-y divide-foreground/10">
        {data.events.map((e) => (
          <li key={e._id} className="py-3 first:pt-0 last:pb-0">
            <EventListItem event={e} />
          </li>
        ))}
      </ul>
    </SidebarRailSection>
  )
}

function FullMoreInSection({
  sectionSlug,
  sectionName,
  accentColor,
  eventId,
}: {
  sectionSlug: string
  sectionName: string
  accentColor: string
  eventId: string
}) {
  const { data } = useQuery(
    convexQuery(api.events.moreInSection, {
      sectionSlug,
      excludeId: eventId as never,
      limit: 5,
    }),
  )
  if (!data || data.events.length === 0) return null
  return (
    <section className="mt-12 border-t border-foreground/15 pt-8">
      <header className="mb-5 flex items-baseline justify-between gap-3">
        <h2 className="kicker" style={{ color: accentColor }}>
          More from {sectionName}
        </h2>
        <Link
          to="/section/$slug"
          params={{ slug: sectionSlug }}
          className="meta hover:underline"
          style={{ color: accentColor }}
        >
          All →
        </Link>
      </header>
      <ul className="grid grid-cols-1 gap-y-6 md:grid-cols-2 md:gap-x-8 lg:grid-cols-3">
        {data.events.map((e) => (
          <li key={e._id}>
            <EventListItem event={e} />
          </li>
        ))}
      </ul>
    </section>
  )
}
