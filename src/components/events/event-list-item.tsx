import { Link } from "@tanstack/react-router"
import { ExternalLink, MapPin } from "lucide-react"

import type { EventWithSection } from "@/lib/event-helpers"
import { formatEventTime } from "@/lib/event-helpers"
import { proxiedImageUrl } from "@/lib/image-proxy"

// Compact event row used in list views (homepage right column, /events list,
// admin queue rendering). Section-tinted kicker, time + location meta line,
// optional external link if the event has a canonical URL.
export function EventListItem({ event }: { event: EventWithSection }) {
  const location = [event.locationName, event.neighborhood]
    .filter(Boolean)
    .join(" · ")
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
        {event.url ? (
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
      {event.description ? (
        <p className="font-sans text-sm leading-snug text-muted-foreground line-clamp-2">
          {event.description}
        </p>
      ) : null}
      {event.article ? (
        <Link
          to="/article/$slug"
          params={{ slug: event.article.slug }}
          className="meta inline-flex items-center gap-1 text-xs uppercase tracking-wider text-foreground transition-colors hover:text-primary hover:underline"
        >
          Read the story →
        </Link>
      ) : null}
    </div>
  )
  return (
    <article id={`event-${event._id}`} className="group/event flex gap-3">
      {Body}
      {event.imageUrl ? (
        <div className="w-20 shrink-0 overflow-hidden rounded-[4px] md:w-24">
          {event.url ? (
            <a href={event.url} target="_blank" rel="noreferrer" tabIndex={-1}>
              <img
                src={event.imageUrl}
                alt=""
                loading="lazy"
                className="aspect-square w-full object-cover transition-transform duration-200 ease-out group-hover/event:scale-[1.01]"
              />
            </a>
          ) : (
            <img
              src={proxiedImageUrl(event.imageUrl, { width: 240 })}
              alt=""
              loading="lazy"
              className="aspect-square w-full object-cover"
            />
          )}
        </div>
      ) : null}
    </article>
  )
}
