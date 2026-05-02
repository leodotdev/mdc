import { convexQuery } from "@convex-dev/react-query"
import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { Link, createFileRoute, notFound } from "@tanstack/react-router"
import { useEffect } from "react"

import { api } from "../../../convex/_generated/api"
import { ArticleBody } from "@/components/editorial/article-body"
import { ArticleHeader } from "@/components/editorial/article-header"
import { MoreFromSection as MoreFromSectionRail } from "@/components/editorial/more-from-section"
import { ShareWidget } from "@/components/editorial/share-widget"
import {
  SidebarRail,
  SidebarRailSection,
} from "@/components/editorial/sidebar-rail"
import { SourcesBlock } from "@/components/editorial/sources-block"
import { StoryArcRail } from "@/components/editorial/story-arc-rail"
import { convexSuspenseQuery } from "@/lib/convex-suspense"
import { useTranslation } from "@/lib/i18n/context"
import { localizedArticle } from "@/lib/localized-article"

export const Route = createFileRoute("/_site/article/$slug")({
  loader: async ({ context, params }) => {
    const article = await context.queryClient.ensureQueryData(
      convexQuery(api.articles.getBySlug, { slug: params.slug }),
    )
    if (!article || article.status !== "published") throw notFound()
    if (article.section) {
      void context.queryClient.ensureQueryData(
        convexQuery(api.articles.moreFromSection, {
          sectionSlug: article.section.slug,
          excludeId: article._id,
          limit: 5,
        }),
      )
    }
    return { article }
  },
  head: ({ loaderData }) => {
    const a = loaderData?.article
    if (!a) return {}
    return {
      meta: [
        { title: `${a.title} · miami.community` },
        { name: "description", content: a.dek },
        { property: "og:title", content: a.title },
        { property: "og:description", content: a.dek },
        ...(a.heroImage
          ? [{ property: "og:image", content: a.heroImage }]
          : []),
        { property: "og:type", content: "article" },
      ],
    }
  },
  component: ArticlePage,
})

function ArticlePage() {
  const { slug } = Route.useParams()
  const { data: rawArticle } = useSuspenseQuery(
    convexSuspenseQuery(api.articles.getBySlug, { slug }),
  )
  const { lang } = useTranslation()
  if (!rawArticle) return null
  // Localized view of the article — title, dek, body, heroCaption all
  // swap to ES when lang === "es" and a translation is stored. Falls
  // back to EN when ES isn't ready yet (e.g. just-published stories).
  const article = localizedArticle(rawArticle, lang)

  // Keep the browser tab title in sync with the active language. The
  // route's head() runs SSR-only with the canonical EN title; this
  // hook patches the DOM after the lang switch flips ES.
  useEffect(() => {
    if (typeof document === "undefined") return
    document.title = `${article.title} · miami.community`
  }, [article.title])

  return (
    <article className="py-2">
      <ArticleHeader article={rawArticle} />

      {/* Body + Rail. 8/4 split on lg. The rail sticks to the top of
          the viewport so readers always have somewhere to go mid-read.
          Below lg the rail collapses below the body with a top rule. */}
      <div className="mt-12 grid grid-cols-1 gap-x-10 lg:grid-cols-12">
        <div className="lg:col-span-9 lg:pr-2">
          <ShareWidget title={article.title} />
          <ArticleBody markdown={article.body} />
          <ShareWidget title={article.title} />
        </div>

        <SidebarRail className="lg:col-span-3">
          {article.storyArcId ? (
            <SidebarRailSection title="On this story">
              <InlineStoryArc
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

      {/* Sources deck — full bleed below the body+rail split. */}
      <SourcesBlock citations={article.citations} />

      {/* "More from {section}" full-width grid below sources. The rail
          variant above shows just 3 inline; this is the full strip. */}
      {article.section ? (
        <MoreFromSection
          sectionSlug={article.section.slug}
          articleId={article._id}
        />
      ) : null}
    </article>
  )
}

// Compact story-arc rail rendered inside the right rail. Reuses the
// existing StoryArcRail component but the parent layout is narrower so
// links wrap accordingly.
function InlineStoryArc({
  arcId,
  currentArticleId,
}: {
  arcId: string
  currentArticleId: string
}) {
  return (
    <StoryArcRail
      arcId={arcId as never}
      currentArticleId={currentArticleId as never}
    />
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
  if (!data || data.articles.length === 0) return null
  return (
    <SidebarRailSection
      title={`More from ${sectionName}`}
      more={
        <Link
          to="/section/$slug"
          params={{ slug: sectionSlug }}
          className="meta tracking-wider uppercase hover:underline"
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

function MoreFromSection({
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
