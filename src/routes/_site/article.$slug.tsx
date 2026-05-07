import { convexQuery } from "@convex-dev/react-query"
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, notFound } from "@tanstack/react-router"
import { useEffect } from "react"

import { api } from "../../../convex/_generated/api"
import { ArticleLayout } from "@/components/editorial/article-layout"
import { BannerAd } from "@/components/site/banner-ad"
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

  // Keep the browser tab title in sync with the active language. The
  // route's head() runs SSR-only with the canonical EN title; this
  // hook patches the DOM after the lang switch flips ES.
  const localized = localizedArticle(rawArticle, lang)
  useEffect(() => {
    if (typeof document === "undefined") return
    document.title = `${localized.title} · miami.community`
  }, [localized.title])

  return (
    <div className="flex flex-col gap-10">
      <ArticleLayout
        rawArticle={rawArticle}
        midSlot={<BannerAd slot="article-mid" />}
      />
      <BannerAd slot="article-bottom" className="pt-6" />
    </div>
  )
}
