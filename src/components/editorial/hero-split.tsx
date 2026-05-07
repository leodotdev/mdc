import { Link } from "@tanstack/react-router"

import { HeroCaption } from "./hero-caption"
import { StoryItem } from "./story-item"
import type { ArticleWithRelations } from "@/lib/article-types"
import { HeroImg } from "@/components/site/hero-img"
import { useOpenArticleDrawer } from "@/lib/use-open-article-drawer"

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
  lead: ArticleWithRelations
  subleads?: Array<ArticleWithRelations>
  showDek?: boolean
}) {
  const openInDrawer = useOpenArticleDrawer()
  const top = subleads[0]
  const bottom = subleads[1]
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-6 pb-8 md:grid-cols-12">
      {lead.heroImage ? (
        <Link
          to="/article/$slug"
          params={{ slug: lead.slug }}
          onClick={(e) => openInDrawer(lead.slug, e)}
          className="group/lead block self-start [contain:paint] md:col-span-7 md:col-start-6"
        >
          <HeroImg
            url={lead.heroImage}
            width={1200}
            priority
            className="aspect-[3/2] w-full object-cover transition-transform duration-200 ease-out group-hover/lead:scale-[1.015]"
          />
          {lead.heroCaption ? (
            <figcaption className="mt-2">
              <HeroCaption
                caption={lead.heroCaption}
                citations={lead.citations}
              />
            </figcaption>
          ) : null}
        </Link>
      ) : null}
      <div className="flex flex-col divide-y divide-foreground/15 md:col-span-5 md:col-start-1 md:row-start-1">
        <div className="pb-5">
          <StoryItem
            article={lead}
            layout="text-only"
            size="lead"
            showDek={showDek}
          />
        </div>
        {top ? (
          <div className="py-5">
            <StoryItem
              article={top}
              layout="text-only"
              size="compact"
            />
          </div>
        ) : null}
        {bottom ? (
          <div className="pt-5">
            <StoryItem
              article={bottom}
              layout="text-only"
              size="compact"
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
