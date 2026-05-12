import { Link } from "@tanstack/react-router"

import { SectionHeaderCell } from "./section-header-cell"
import type { StoryCardItem } from "@/lib/article-types"
import { isEventCard } from "@/lib/article-types"
import { useTranslation } from "@/lib/i18n/context"
import { localizedCard } from "@/lib/localized-article"
import {
  useOpenArticleDrawer,
  useOpenEventDrawer,
} from "@/lib/use-open-article-drawer"

// Trending strip — generalized from the homepage so section / tag /
// author pages can drop their own scoped block. Renders a label on its
// own row and 4 tiles below with serif numerals + sans headlines,
// separated by light vertical hairlines on desktop. Ranking is based on
// our internal importance score, not view counts (we don't track those).
export function TrendingStrip({
  label = "Trending",
  articles,
}: {
  label?: string
  articles: Array<StoryCardItem>
}) {
  const { lang } = useTranslation()
  const openArticleInDrawer = useOpenArticleDrawer()
  const openEventInDrawer = useOpenEventDrawer()
  if (articles.length === 0) return null
  const items = articles.slice(0, 4).map((a) => localizedCard(a, lang))
  return (
    <section>
      <SectionHeaderCell title={label} className="mb-5" />
      <ol className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-4 md:divide-x md:divide-foreground/15">
        {items.map((a, i) => {
          const isEvent = isEventCard(a)
          const slug = a.slug ?? ""
          const linkProps = isEvent
            ? ({
                to: "/event/$slug" as const,
                params: { slug },
                onClick: (e: React.MouseEvent) =>
                  openEventInDrawer(slug, e),
              } as const)
            : ({
                to: "/article/$slug" as const,
                params: { slug },
                onClick: (e: React.MouseEvent) =>
                  openArticleInDrawer(slug, e),
              } as const)
          return (
            <li
              key={a._id}
              className="flex items-start gap-3 md:px-4 md:first:pl-0 md:last:pr-0"
            >
              <span
                aria-hidden
                className="font-heading text-3xl leading-[0.9] font-semibold tabular-nums text-foreground md:text-4xl"
              >
                {i + 1}
              </span>
              <Link
                {...linkProps}
                className="font-sans text-sm leading-snug text-foreground transition-colors hover:text-primary md:text-base"
              >
                {a.title}
              </Link>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
