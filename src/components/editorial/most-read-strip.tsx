import { Link } from "@tanstack/react-router"

import { SectionHeaderCell } from "./section-header-cell"
import type { ArticleWithRelations } from "@/lib/article-types"
import { useTranslation } from "@/lib/i18n/context"
import { localizedArticle } from "@/lib/localized-article"

// Most Read strip — generalized from the homepage so section / tag /
// author pages can drop their own scoped "most read" block. Renders a
// label on its own row and 4 tiles below with serif numerals + sans
// headlines, separated by light vertical hairlines on desktop.
export function MostReadStrip({
  label = "Most Read",
  articles,
}: {
  label?: string
  articles: Array<ArticleWithRelations>
}) {
  const { lang } = useTranslation()
  if (articles.length === 0) return null
  const items = articles.slice(0, 4).map((a) => localizedArticle(a, lang))
  return (
    <section>
      <SectionHeaderCell title={label} className="mb-5" />
      <ol className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-4 md:divide-x md:divide-foreground/15">
        {items.map((a, i) => (
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
              to="/article/$slug"
              params={{ slug: a.slug }}
              className="font-sans text-sm leading-snug text-foreground transition-colors hover:text-primary md:text-base"
            >
              {a.title}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}
