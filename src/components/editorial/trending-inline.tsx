import { Link } from "@tanstack/react-router"

import type { StoryCardItem } from "@/lib/article-types"
import { isEventCard } from "@/lib/article-types"
import { useTranslation } from "@/lib/i18n/context"
import { localizedCard } from "@/lib/localized-article"
import {
  useOpenArticleDrawer,
  useOpenEventDrawer,
} from "@/lib/use-open-article-drawer"
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
  articles: Array<StoryCardItem>
  limit?: number
  className?: string
}) {
  const { lang } = useTranslation()
  const openArticleInDrawer = useOpenArticleDrawer()
  const openEventInDrawer = useOpenEventDrawer()
  if (articles.length === 0) return null
  const items = articles.slice(0, limit).map((a) => localizedCard(a, lang))
  return (
    <nav
      aria-label={label}
      className={cn(
        "flex flex-wrap items-baseline gap-x-6 gap-y-2 border-b border-foreground/10 pb-4 text-sm",
        className,
      )}
    >
      <span className="font-sans font-semibold text-foreground">{label}</span>
      {items.map((a) => {
        const isEvent = isEventCard(a)
        const slug = a.slug ?? ""
        const linkProps = isEvent
          ? ({
              to: "/event/$slug" as const,
              params: { slug },
              onClick: (e: React.MouseEvent) => openEventInDrawer(slug, e),
            } as const)
          : ({
              to: "/article/$slug" as const,
              params: { slug },
              onClick: (e: React.MouseEvent) => openArticleInDrawer(slug, e),
            } as const)
        return (
          <Link
            key={a._id}
            {...linkProps}
            className="font-sans text-foreground/80 transition-colors hover:text-primary"
          >
            {a.title}
          </Link>
        )
      })}
    </nav>
  )
}
