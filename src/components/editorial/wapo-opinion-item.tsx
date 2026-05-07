import { Link } from "@tanstack/react-router"

import type { ArticleWithRelations } from "@/lib/article-types"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useOpenArticleDrawer } from "@/lib/use-open-article-drawer"

// Compact opinion item. WaPo's right rail: a tight headline + author chip
// (small circular photo + name in tracked sans). No image on the article;
// the author photo carries the visual.
export function WapoOpinionItem({ article }: { article: ArticleWithRelations }) {
  const openInDrawer = useOpenArticleDrawer()
  const author = article.authors[0]
  const initials = author
    ? author.name
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "•"

  return (
    <article className="group/item flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <Link
          to="/article/$slug"
          params={{ slug: article.slug }}
          onClick={(e) => openInDrawer(article.slug, e)}
        >
          <h3 className="font-heading text-base font-semibold leading-snug tracking-[-0.01em] text-balance transition-colors group-hover/item:text-primary md:text-lg">
            {article.title}
          </h3>
        </Link>
        {author ? (
          <p className="meta mt-1.5 text-xs">
            {author.name}
          </p>
        ) : null}
      </div>
      {author ? (
        <Avatar size="sm" className="mt-0.5 shrink-0">
          {author.avatar ? (
            <AvatarImage src={author.avatar} alt={author.name} />
          ) : null}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
      ) : null}
    </article>
  )
}
