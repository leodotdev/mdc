import { Link } from "@tanstack/react-router"
import { cva } from "class-variance-authority"

import { neighborhoodName } from "../../../convex/lib/neighborhoods"
import { AdminEventQuickDelete } from "./admin-event-quick-delete"
import { EventVideoThumb } from "./event-video-thumb"
import { SectionBadge } from "./section-badge"
import type { VariantProps } from "class-variance-authority"
import type { EventWithRelations } from "@/lib/article-types"
import { decideEventThumbnail } from "@/lib/event-thumbnail"
import {
  effectiveStartsAt,
  formatEventShortDate,
  formatEventTime,
} from "@/lib/event-helpers"
import { useTranslation } from "@/lib/i18n/context"
import { HeroImg } from "@/components/site/hero-img"
import { localizedCard } from "@/lib/localized-article"
import { useOpenEventDrawer } from "@/lib/use-open-article-drawer"
import { cn } from "@/lib/utils"

// Single event card used everywhere on the public site — homepage hero,
// section/neighborhood/tag pages, xl-row-list, hero-split. Behavior is
// driven by `layout` and `size`:
//
//   layout      — image placement / framing
//   size        — typographic scale of the headline + dek
//   showKicker  — section badge above the headline (default true)
//   showDek     — defaults true for hero/feature/lead, false otherwise
//   imageAspect — image-top + framed only; ignored otherwise
//   customKicker — overrides the section badge with a custom label/color
//
// Click behavior: every left-click opens the event drawer via the
// `?event=slug` search param. Middle / right click fall through to the
// browser's "open in new tab" — that new tab loads the dedicated
// `/event/$slug` route fresh, which is the only in-app way to reach
// the route besides the drawer's "Open as full page" footer link.

// Headline size scale used by every layout. Picks up the section accent
// on hover via `group-hover/item:text-primary`.
const titleVariants = cva(
  "font-heading font-semibold leading-[1.05] text-balance transition-colors group-hover/item:text-primary",
  {
    variants: {
      size: {
        hero: "text-4xl tracking-[-0.03em] md:text-6xl md:leading-[1]",
        feature: "text-3xl tracking-[-0.025em] md:text-[2.625rem] md:leading-[1]",
        lead: "text-2xl tracking-[-0.02em] md:text-3xl",
        default: "text-xl tracking-[-0.015em] md:text-2xl",
        compact: "text-base tracking-[-0.01em] md:text-lg",
        sm: "text-base tracking-[-0.01em]",
      },
    },
    defaultVariants: { size: "default" },
  },
)

// Deks are deliberately uniform across every layout — 16px / `text-base`.
// They're a supporting line under the headline, not a competing one,
// and a single size keeps the page rhythm clean regardless of which
// card variant is rendering.
const dekSizeFor: Record<NonNullable<EventCardSize>, string> = {
  hero: "text-base",
  feature: "text-base",
  lead: "text-base",
  default: "text-base",
  compact: "text-base",
  sm: "text-base",
}

type EventCardLayout =
  | "image-top"
  | "image-side"
  | "side-thumb"
  | "text-only"
  | "framed"
  | "hero"

type EventCardSize = VariantProps<typeof titleVariants>["size"]

type EventCardProps = {
  event: EventWithRelations
  layout?: EventCardLayout
  size?: EventCardSize
  showKicker?: boolean
  showDek?: boolean
  /** Force-hide the hero image even when the event has one. Defaults
   *  true when there's an image. Useful for framed-cell grids where some
   *  cells render text-only by design (e.g. long-tail rows). */
  showImage?: boolean
  imageAspect?: "16/10" | "16/9" | "4/3" | "1/1"
  /** Override the section kicker — e.g. an "EXCLUSIVE" or "BREAKING" label. */
  customKicker?: { text: string; color?: string }
  className?: string
}

const aspectClass = {
  "16/10": "aspect-[16/10]",
  "16/9": "aspect-[16/9]",
  "4/3": "aspect-[4/3]",
  "1/1": "aspect-square",
} as const

export function EventCard({
  event: rawEvent,
  layout = "image-top",
  size = "default",
  showKicker = true,
  showDek,
  showImage = true,
  imageAspect = "16/10",
  customKicker,
  className,
}: EventCardProps) {
  const { lang } = useTranslation()
  const event = localizedCard(rawEvent, lang)
  const sizeKey = (size ?? "default") as NonNullable<EventCardSize>
  // Dek defaults: shown for the larger sizes, hidden for the small ones.
  // Callers can force either way with `showDek`.
  const dekVisible =
    showDek ?? (sizeKey === "hero" || sizeKey === "feature" || sizeKey === "lead")
  // Thumbnail priority for event cards:
  //   1. videoEmbed   → YouTube poster + play overlay
  //   2. heroImage    → editorial photo
  //   3. nothing      → no thumbnail
  const eventThumb = decideEventThumbnail({
    videoEmbed: (event as {
      videoEmbed?: { provider?: string; id?: string } | null
    }).videoEmbed,
    heroImage: event.heroImage,
  })
  const hasImage =
    showImage && eventThumb.kind !== "none" && layout !== "text-only"
  const openEventInDrawer = useOpenEventDrawer()
  const displayDek = event.dek ?? event.description ?? ""
  const slug = event.slug ?? ""
  // Admin hover-delete affordance — null for non-editors via the
  // component itself, so safe to mount unconditionally.
  const AdminDelete = (
    <AdminEventQuickDelete eventId={event._id} title={event.title} />
  )
  const linkProps = {
    to: "/event/$slug" as const,
    params: { slug },
    onClick: (e: React.MouseEvent) => openEventInDrawer(slug, e),
  } as const

  // Section kicker policy: prefer the sub-section name (Heat, Politics,
  // Marlins) when the event is filed under one — those carry more
  // signal than the parent. When there's no sub-section, fall back to
  // the top-level name (Food, Sports) so every event still has a
  // label above the headline. Custom kickers (BREAKING / EXCLUSIVE)
  // override either path. The badge itself reads `event.section`,
  // which is already the leaf row from `hydrate()` — fall-back happens
  // implicitly because top-level sections ARE the leaf when no
  // sub-section was picked.
  const KickerNode = customKicker ? (
    <span
      className="kicker inline-flex items-center gap-1.5 text-[0.7rem]"
      style={{ color: customKicker.color ?? "var(--destructive)" }}
    >
      <span
        aria-hidden
        className="size-1 rounded-full"
        style={{ background: customKicker.color ?? "var(--destructive)" }}
      />
      {customKicker.text}
    </span>
  ) : showKicker ? (
    <SectionBadge
      section={event.section}
      size={
        sizeKey === "hero" || sizeKey === "feature" ? "md" : "sm"
      }
    />
  ) : null

  const KickerLine = KickerNode ? (
    <div className="flex flex-wrap items-baseline gap-x-2">{KickerNode}</div>
  ) : null

  const Headline = (
    <Link {...linkProps}>
      <h3 className={titleVariants({ size })}>{event.title}</h3>
    </Link>
  )

  const Dek =
    dekVisible && displayDek ? (
      <p
        className={cn(
          "font-sans font-normal text-muted-foreground",
          dekSizeFor[sizeKey],
        )}
      >
        {displayDek}
      </p>
    ) : null

  // Event metadata strip — every card surface renders the same band so
  // listings stay visually consistent and readers always see when /
  // where / how much. Order matches the editorial canonical (date →
  // time → venue → price). Each fact is skipped individually if
  // missing; the strip itself is suppressed only when nothing remains.
  // Recurring events shift to the next upcoming instance via
  // effectiveStartsAt so a weekly trivia night doesn't show last
  // Tuesday's date.
  const effectiveStart = effectiveStartsAt(event)
  const dateLabel = formatEventShortDate(effectiveStart)
  const timeLabel = event.allDay
    ? null
    : formatEventTime({
        startsAt: effectiveStart,
        endsAt: event.endsAt ?? undefined,
        allDay: event.allDay,
      })
  // Venue text: prefer the venue name (most readable on a card), fall
  // through to the address line. Strip inline HTML from CMS-mangled
  // location strings (Localist + Weebly both ship <p>/<span> wrappers
  // in their location field).
  const venueRaw =
    event.locationName || event.locationAddress || ""
  const venue = venueRaw
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  const neighborhoodSlug = event.neighborhoods?.[0]
  const neighborhood = neighborhoodSlug
    ? (neighborhoodName(neighborhoodSlug) ?? neighborhoodSlug)
    : null
  const venueLabel = [venue, neighborhood].filter(Boolean).join(", ")
  const priceLabel =
    event.price && event.price.trim().length > 0
      ? event.price.trim()
      : null
  const metaParts = [
    dateLabel,
    timeLabel,
    venueLabel || null,
    priceLabel,
  ].filter((p): p is string => Boolean(p))
  const EventMetaLine =
    metaParts.length > 0 ? (
      <p className="meta flex flex-wrap items-baseline gap-x-1.5 text-xs">
        {metaParts.map((part, i) => (
          <span key={`meta-${i}`} className="inline-flex items-baseline">
            {i > 0 ? (
              <span aria-hidden className="mr-1.5 text-muted-foreground">
                ·
              </span>
            ) : null}
            <span
              className={cn(
                // First two parts (date, time) carry foreground weight
                // so the "when" reads first; venue + price stay muted.
                i < 2 ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {part}
            </span>
          </span>
        ))}
      </p>
    ) : null

  const Body = (
    <div className="flex flex-col gap-1.5">
      {KickerLine}
      {Headline}
      {EventMetaLine}
      {Dek}
    </div>
  )

  // Image elements vary slightly by layout (aspect, hover scale anchor).
  // Renders whichever shape the thumbnail decision picked: video →
  // poster + play overlay, image → HeroImg, map → static Mapbox img.
  const renderHeroOrMap = (
    width: number,
    className: string,
  ): React.ReactElement | null => {
    if (eventThumb.kind === "video") {
      return (
        <EventVideoThumb
          src={eventThumb.src}
          alt={event.title}
          className={className}
        />
      )
    }
    if (eventThumb.kind === "image") {
      return (
        <HeroImg url={eventThumb.src} width={width} className={className} />
      )
    }
    return null
  }

  const ImageTop = hasImage ? (
    <Link
      {...linkProps}
      className="block [contain:paint]"
      tabIndex={-1}
    >
      {renderHeroOrMap(
        800,
        cn(aspectClass[imageAspect], "w-full object-cover"),
      )}
    </Link>
  ) : null

  const ImageSide = hasImage ? (
    <Link
      {...linkProps}
      className="block self-start [contain:paint]"
      tabIndex={-1}
    >
      {renderHeroOrMap(800, "aspect-[3/2] w-full object-cover")}
    </Link>
  ) : null

  const ImageThumb = hasImage ? (
    <Link
      {...linkProps}
      className="block aspect-square h-20 w-28 shrink-0 [contain:paint]"
      tabIndex={-1}
    >
      {renderHeroOrMap(240, "h-full w-full object-cover")}
    </Link>
  ) : null

  // -------- layout switch --------
  if (layout === "framed") {
    // Bordered cell — designed to live inside a grid that's also bordered
    // so adjacent cells' edges touch and form a newspaper grid.
    return (
      <article
        className={cn(
          "group/item relative flex h-full flex-col border-r border-b border-foreground bg-card transition-colors duration-150 hover:bg-muted/40",
          className,
        )}
      >
        {AdminDelete}
        {hasImage ? (
          <Link
            {...linkProps}
            className="block [contain:paint]"
            aria-hidden="true"
            tabIndex={-1}
          >
            {renderHeroOrMap(
              800,
              cn(aspectClass[imageAspect], "w-full object-cover"),
            )}
          </Link>
        ) : null}
        <div className="flex flex-1 flex-col gap-2 p-5">
          {KickerLine}
          {Headline}
          {EventMetaLine}
          {Dek}
        </div>
      </article>
    )
  }

  if (layout === "hero") {
    // Banner-scale event. When there's no image we fall back to a
    // newspaper-style left rule so the title still has weight on the page.
    return (
      <article className={cn("group/item relative", className)}>
        {AdminDelete}
        {hasImage ? (
          <Link
            {...linkProps}
            className="block [contain:paint]"
            tabIndex={-1}
          >
            {renderHeroOrMap(
              1200,
              "aspect-[16/9] w-full object-cover transition-transform duration-200 ease-out group-hover/item:scale-[1.015]",
            )}
          </Link>
        ) : null}
        <div
          className={cn(
            "flex flex-col gap-3",
            hasImage
              ? "mt-5"
              : "border-l-4 border-foreground pl-5 md:pl-6",
          )}
        >
          {KickerLine}
          {Headline}
          {EventMetaLine}
          {displayDek ? (
            <p className="font-sans text-base font-normal text-muted-foreground">
              {displayDek}
            </p>
          ) : null}
        </div>
      </article>
    )
  }

  if (layout === "image-top") {
    return (
      <article className={cn("group/item relative flex flex-col gap-3", className)}>
        {AdminDelete}
        {ImageTop}
        {Body}
      </article>
    )
  }

  if (layout === "image-side") {
    return (
      <article
        className={cn(
          "group/item relative grid gap-x-6 gap-y-3 md:grid-cols-2",
          className,
        )}
      >
        {AdminDelete}
        {ImageSide}
        <div className="flex flex-col justify-center">{Body}</div>
      </article>
    )
  }

  if (layout === "side-thumb") {
    return (
      <article className={cn("group/item relative flex gap-4", className)}>
        {AdminDelete}
        <div className="min-w-0 flex-1">{Body}</div>
        {ImageThumb}
      </article>
    )
  }

  // text-only
  return (
    <article className={cn("group/item relative flex flex-col", className)}>
      {AdminDelete}
      {Body}
    </article>
  )
}
