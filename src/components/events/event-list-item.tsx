import { Link } from "@tanstack/react-router"
import { ExternalLink, MapPin } from "lucide-react"

import type { EventWithSection } from "@/lib/event-helpers"
import { useTranslation } from "@/lib/i18n/context"
import { formatEventTime } from "@/lib/event-helpers"
import { localizedEvent } from "@/lib/localized-event"
import { HeroImg } from "@/components/site/hero-img"
import { useOpenArticleDrawer } from "@/lib/use-open-article-drawer"

// Compact event row used in list views (homepage right column, /events list,
// neighborhood + section page rails). Section-tinted kicker, time + location meta line,
// optional external link if the event has a canonical URL.
export function EventListItem({ event: rawEvent }: { event: EventWithSection }) {
  const { lang } = useTranslation()
  const event = localizedEvent(rawEvent, lang)
  const openInDrawer = useOpenArticleDrawer()
  const heroImage = event.heroImage
  const neighborhoodLabel = event.neighborhoods?.[0]
  const location = [event.locationName, neighborhoodLabel]
    .filter(Boolean)
    .join(", ")
  const Body = (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      {event.section ? (
        <span
          className="kicker text-[0.7rem]"
          style={{ color: event.section.accentColor }}
        >
          {event.section.name}
        </span>
      ) : null}
      <h3 className="font-heading text-base font-semibold leading-snug tracking-[-0.01em] text-balance md:text-lg">
        {event.slug ? (
          <Link
            to="."
            search={
              ((prev: Record<string, unknown>) => ({
                ...prev,
                event: event.slug,
              })) as never
            }
            className="hover:text-primary"
          >
            {event.title}
          </Link>
        ) : event.url ? (
          <a
            href={event.url}
            target="_blank"
            rel="noreferrer"
            className="hover:text-primary"
          >
            {event.title}
            <ExternalLink className="ml-1 inline size-3 align-middle text-muted-foreground" />
          </a>
        ) : (
          event.title
        )}
      </h3>
      <div className="meta flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
        <time dateTime={new Date(event.startsAt).toISOString()}>
          {formatEventTime(event)}
        </time>
        {location ? (
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3" aria-hidden />
            {location}
          </span>
        ) : null}
        {event.price ? <span>· {event.price}</span> : null}
      </div>
      {/* 1-sentence dek. Legacy events without a dek fall back to
          description; clamp to a single line on cards. */}
      {(event.dek || event.description) ? (
        <p className="font-sans text-sm leading-snug text-muted-foreground line-clamp-2">
          {event.dek || event.description}
        </p>
      ) : null}
      {(() => {
        // Primary CTA on the card: link straight to the source / venue
        // page. Falls through to the first citation URL when the event
        // itself has no `url` so most rows still get a way out.
        const sourceUrl = event.url ?? event.citations?.[0]?.url
        return sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="meta inline-flex items-center gap-1 text-xs font-medium text-foreground transition-colors hover:text-primary hover:underline"
          >
            Get full details
            <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : null
      })()}
      {event.article ? (
        <Link
          to="/article/$slug"
          params={{ slug: event.article.slug }}
          onClick={(e) => openInDrawer(event.article!.slug, e)}
          className="meta inline-flex items-center gap-1 text-xs text-foreground transition-colors hover:text-primary hover:underline"
        >
          Related article →
        </Link>
      ) : null}
    </div>
  )
  return (
    <article id={`event-${event._id}`} className="group/event flex gap-3">
      {Body}
      {heroImage ? (
        <div className="w-14 shrink-0 [contain:paint] md:w-16">
          {event.slug ? (
            <Link
              to="."
              search={
                ((prev: Record<string, unknown>) => ({
                  ...prev,
                  event: event.slug,
                })) as never
              }
              tabIndex={-1}
            >
              <HeroImg
                url={heroImage}
                width={240}
                className="aspect-[9/16] w-full object-cover transition-transform duration-200 ease-out group-hover/event:scale-[1.015]"
              />
            </Link>
          ) : event.url ? (
            <a href={event.url} target="_blank" rel="noreferrer" tabIndex={-1}>
              <HeroImg
                url={heroImage}
                width={240}
                className="aspect-[9/16] w-full object-cover"
              />
            </a>
          ) : (
            <HeroImg
              url={heroImage}
              width={240}
              className="aspect-[9/16] w-full object-cover"
            />
          )}
        </div>
      ) : null}
    </article>
  )
}
