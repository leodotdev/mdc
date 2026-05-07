import { Link } from "@tanstack/react-router"

import type { ArticleWithRelations } from "@/lib/article-types"
import { useTranslation } from "@/lib/i18n/context"
import { localizedArticle } from "@/lib/localized-article"
import { useOpenArticleDrawer } from "@/lib/use-open-article-drawer"
import { cn } from "@/lib/utils"

// Inline trending strip — single horizontal row, bold "Trending" label
// followed by a handful of headlines as plain links. Mirrors the NYT
// section-page treatment: thin, fast to scan, gets out of the way.
//
// Sibling to <TrendingStrip>, which is the richer numbered-tiles
// variant. Use this one when the section page wants a one-line nudge
// at the top instead of a full block.
export function TrendingInline({
  label = "Trending",
  articles,
  limit = 3,
  className,
}: {
  label?: string
  articles: Array<ArticleWithRelations>
  limit?: number
  className?: string
}) {
  const { lang } = useTranslation()
  const openInDrawer = useOpenArticleDrawer()
  if (articles.length === 0) return null
  const items = articles.slice(0, limit).map((a) => localizedArticle(a, lang))
  return (
    <nav
      aria-label={label}
      className={cn(
        "flex flex-wrap items-baseline gap-x-6 gap-y-2 border-b border-foreground/10 pb-4 text-sm",
        className,
      )}
    >
      <span className="font-sans font-semibold text-foreground">{label}</span>
      {items.map((a) => (
        <Link
          key={a._id}
          to="/article/$slug"
          params={{ slug: a.slug }}
          onClick={(e) => openInDrawer(a.slug, e)}
          className="font-sans text-foreground/80 transition-colors hover:text-primary"
        >
          {a.title}
        </Link>
      ))}
    </nav>
  )
}
