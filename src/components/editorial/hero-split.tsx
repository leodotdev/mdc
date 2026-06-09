import { Link } from "@tanstack/react-router"

import { EventVideoThumb } from "./event-video-thumb"
import { HeroCaption } from "./hero-caption"
import { EventCard } from "./event-card"
import type { EventWithRelations } from "@/lib/article-types"
import { decideEventThumbnail } from "@/lib/event-thumbnail"
import { HeroImg } from "@/components/site/hero-img"
import { useOpenEventDrawer } from "@/lib/use-open-article-drawer"

// The split lead from the homepage extracted into a reusable block —
// image right (cols 6-12) + text col left (cols 1-5) on desktop, image
// stacks first on mobile. Up to two `subleads` stack underneath the
// lead's text column, sharing dividers.
//
// Used by section / tag / author pages above the xl-row list. Pass
// `showDek` to control whether the lead's dek shows (defaults to true).
export function HeroSplit({
  lead,
  subleads = [],
  showDek = true,
}: {
  lead: EventWithRelations
  subleads?: Array<EventWithRelations>
  showDek?: boolean
}) {
  const openEventInDrawer = useOpenEventDrawer()
  const top = subleads[0]
  const bottom = subleads[1]
  // Thumbnail priority: video → image → nothing. Every lead is an
  // event now (article-era removed).
  const thumb = decideEventThumbnail({
    videoEmbed: (lead as {
      videoEmbed?: { provider?: string; id?: string } | null
    }).videoEmbed,
    heroImage: lead.heroImage,
  })
  const showImage = thumb.kind !== "none"
  const slug = lead.slug ?? ""
  const linkProps = {
    to: "/event/$slug" as const,
    params: { slug },
    onClick: (e: React.MouseEvent) => openEventInDrawer(slug, e),
  } as const
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-6 pb-8 md:grid-cols-12">
      {showImage ? (
        <Link
          {...linkProps}
          className="group/lead block self-start [contain:paint] md:col-span-7 md:col-start-6"
        >
          {thumb.kind === "video" ? (
            <EventVideoThumb
              src={thumb.src}
              alt={lead.title}
              className="aspect-[3/2] w-full object-cover transition-transform duration-200 ease-out group-hover/lead:scale-[1.015]"
            />
          ) : thumb.kind === "image" ? (
            <HeroImg
              url={thumb.src}
              width={1200}
              priority
              className="aspect-[3/2] w-full object-cover transition-transform duration-200 ease-out group-hover/lead:scale-[1.015]"
            />
          ) : null}
          {lead.heroCaption && thumb.kind === "image" ? (
            <figcaption className="mt-2">
              <HeroCaption
                caption={lead.heroCaption}
                citations={lead.citations ?? []}
              />
            </figcaption>
          ) : null}
        </Link>
      ) : null}
      <div className="flex flex-col divide-y divide-foreground/15 md:col-span-5 md:col-start-1 md:row-start-1">
        <div className="pb-5">
          <EventCard
            event={lead}
            layout="text-only"
            size="lead"
            showDek={showDek}
          />
        </div>
        {top ? (
          <div className="py-5">
            <EventCard
              event={top}
              layout="text-only"
              size="compact"
            />
          </div>
        ) : null}
        {bottom ? (
          <div className="pt-5">
            <EventCard
              event={bottom}
              layout="text-only"
              size="compact"
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
