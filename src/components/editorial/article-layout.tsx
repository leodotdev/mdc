import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"

import { api } from "../../../convex/_generated/api"
import { ArticleBody } from "./article-body"
import { ArticleHeader } from "./article-header"
import { MoreFromSection as MoreFromSectionRail } from "./more-from-section"
import { SidebarRail, SidebarRailSection } from "./sidebar-rail"
import { SourcesBlock } from "./sources-block"
import { StoryArcRail } from "./story-arc-rail"
import type { ArticleWithRelations } from "@/lib/article-types"
import { useTranslation } from "@/lib/i18n/context"
import { localizedArticle } from "@/lib/localized-article"
import { useOpenArticleDrawer } from "@/lib/use-open-article-drawer"

// Single source of truth for how a published article renders. Used by
// both the dedicated `/article/$slug` route and the homepage drawer
// overlay so they're pixel-identical except for the surrounding chrome.
//
// The component takes the raw (un-localized) article and applies the
// current language internally — callers don't have to.
export function ArticleLayout({
  rawArticle,
  midSlot,
}: {
  rawArticle: ArticleWithRelations
  /** Optional slot rendered between the body+rail block and the
   *  sources deck. The article route passes a `<BannerAd>` here; the
   *  drawer omits it (ads inside the drawer overlay would feel wrong). */
  midSlot?: React.ReactNode
}) {
  const { lang } = useTranslation()
  const article = localizedArticle(rawArticle, lang)

  return (
    <article className="py-2">
      <ArticleHeader article={rawArticle} />

      {/* Body + Rail. 9/3 split on lg. The rail sticks to the top of
          the viewport so readers always have somewhere to go mid-read.
          Below lg the rail collapses below the body with a top rule. */}
      <div className="mt-12 grid grid-cols-1 gap-x-10 lg:grid-cols-12">
        <div className="lg:col-span-9 lg:pr-2">
          <ArticleBody markdown={article.body} />
        </div>

        <SidebarRail className="lg:col-span-3">
          {article.storyArcId ? (
            <SidebarRailSection title="On this article">
              <StoryArcRail
                arcId={article.storyArcId}
                currentArticleId={article._id}
              />
            </SidebarRailSection>
          ) : null}
          {article.section ? (
            <RailMoreFromSection
              sectionSlug={article.section.slug}
              articleId={article._id}
              sectionName={article.section.name}
              accentColor={article.section.accentColor}
            />
          ) : null}
        </SidebarRail>
      </div>

      {midSlot ? <div className="mt-12">{midSlot}</div> : null}

      {/* Sources deck — full bleed below the body+rail split. */}
      <SourcesBlock citations={article.citations} />

      {/* "More from {section}" full-width grid below sources. The rail
          variant above shows just 3 inline; this is the full strip. */}
      {article.section ? (
        <MoreFromSectionFull
          sectionSlug={article.section.slug}
          articleId={article._id}
        />
      ) : null}
    </article>
  )
}

// "More from {section}" rendered inside the right rail — first 3 stories
// from the same section, compact text-only.
function RailMoreFromSection({
  sectionSlug,
  articleId,
  sectionName,
  accentColor,
}: {
  sectionSlug: string
  articleId: string
  sectionName: string
  accentColor: string
}) {
  const { data } = useQuery(
    convexQuery(api.articles.moreFromSection, {
      sectionSlug,
      excludeId: articleId as never,
      limit: 3,
    }),
  )
  const { lang } = useTranslation()
  const openInDrawer = useOpenArticleDrawer()
  if (!data || data.articles.length === 0) return null
  return (
    <SidebarRailSection
      title={`More from ${sectionName}`}
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
        {data.articles.map((a) => {
          const localized = localizedArticle(a, lang)
          return (
            <li key={a._id} className="py-3 first:pt-0 last:pb-0">
              <Link
                to="/article/$slug"
                params={{ slug: a.slug }}
                onClick={(e) => openInDrawer(a.slug, e)}
                className="font-heading text-base leading-snug font-semibold hover:text-primary"
              >
                {localized.title}
              </Link>
            </li>
          )
        })}
      </ul>
    </SidebarRailSection>
  )
}

function MoreFromSectionFull({
  sectionSlug,
  articleId,
}: {
  sectionSlug: string
  articleId: string
}) {
  const { data } = useQuery(
    convexQuery(api.articles.moreFromSection, {
      sectionSlug,
      excludeId: articleId as never,
      limit: 5,
    }),
  )
  if (!data || !data.section || data.articles.length === 0) return null
  return <MoreFromSectionRail section={data.section} articles={data.articles} />
}
