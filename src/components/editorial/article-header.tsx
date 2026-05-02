import { Link } from "@tanstack/react-router"

import { SectionBadge } from "./section-badge"
import { neighborhoodName } from "../../../convex/lib/neighborhoods"
import { formatLongDate } from "@/lib/dates"
import type { ArticleWithRelations } from "@/lib/article-types"
import { useTranslation } from "@/lib/i18n/context"
import { proxiedImageUrl } from "@/lib/image-proxy"
import { localizedArticle } from "@/lib/localized-article"

// Article hero header: kicker → display-xl headline → sans-regular dek
// → meta strip → contained 16:9 hero image. Centered on desktop because
// the
// page below splits 8/4 main+rail; centering the head keeps the gravity
// at the top of the page before the eye drops into the body column.
//
// The meta strip lives below the dek and bundles date · neighborhoods ·
// tags into one row of small pills so the reader sees all the article's
// taxonomy at a glance instead of a stack of separate UI affordances.
export function ArticleHeader({
  article: rawArticle,
}: {
  article: ArticleWithRelations
}) {
  const { lang } = useTranslation()
  const article = localizedArticle(rawArticle, lang)
  const neighborhoodNames = (article.neighborhoods ?? [])
    .map((slug) => neighborhoodName(slug))
    .filter((n): n is string => !!n)

  return (
    <header className="mx-auto max-w-3xl">
      <div className="flex flex-col gap-3 text-center">
        <div className="mx-auto">
          <SectionBadge section={article.section} size="md" />
        </div>
        <h1 className="display-xl mt-2">{article.title}</h1>
        <p className="font-sans mx-auto mt-2 max-w-2xl text-base font-normal text-muted-foreground">
          {article.dek}
        </p>
        {/* Meta strip — date + neighborhoods + tags as small pills, all on
            one line on desktop so the head stays compact. Wraps on mobile. */}
        <div className="mx-auto mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
          {article.publishedAt ? (
            <time className="meta">{formatLongDate(article.publishedAt)}</time>
          ) : null}
          {neighborhoodNames.length > 0 ? (
            <span aria-hidden className="meta">
              ·
            </span>
          ) : null}
          {neighborhoodNames.map((name) => (
            <span
              key={name}
              className="rounded-full border border-foreground/15 bg-card px-2.5 py-0.5 text-xs"
            >
              {name}
            </span>
          ))}
          {article.tags.length > 0 ? (
            <span aria-hidden className="meta">
              ·
            </span>
          ) : null}
          {article.tags.slice(0, 4).map((tag) => (
            <Link
              key={tag}
              to="/tag/$slug"
              params={{ slug: tag }}
              className="rounded-full border border-foreground/15 bg-card px-2.5 py-0.5 text-xs hover:bg-muted"
            >
              #{tag}
            </Link>
          ))}
        </div>
      </div>
      {article.heroImage ? (
        <figure className="mt-8">
          <img
            src={proxiedImageUrl(article.heroImage, { width: 1200 })}
            alt={article.heroCaption ?? ""}
            className="aspect-[16/9] w-full rounded-[4px] object-cover"
          />
          {article.heroCaption ? (
            <figcaption className="meta mt-2 text-sm">
              {article.heroCaption}
            </figcaption>
          ) : null}
        </figure>
      ) : null}
    </header>
  )
}
