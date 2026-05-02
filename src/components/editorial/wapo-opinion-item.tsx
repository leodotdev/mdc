import { Link, useNavigate } from "@tanstack/react-router"

import type { ArticleWithRelations } from "@/lib/article-types"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

// Compact opinion item. WaPo's right rail: a tight headline + author chip
// (small circular photo + name in tracked sans). No image on the article;
// the author photo carries the visual.
export function WapoOpinionItem({ article }: { article: ArticleWithRelations }) {
  const navigate = useNavigate()
  const author = article.authors[0]
  const initials = author
    ? author.name
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "•"

  const onClick = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    void navigate({
      search: ((prev: Record<string, unknown>) => ({
        ...prev,
        article: article.slug,
      })) as never,
    })
  }

  return (
    <article className="group/item flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <Link
          to="/article/$slug"
          params={{ slug: article.slug }}
          onClick={onClick}
        >
          <h3 className="font-heading text-base font-semibold leading-snug tracking-[-0.01em] text-balance transition-colors group-hover/item:text-primary md:text-lg">
            {article.title}
          </h3>
        </Link>
        {author ? (
          <p className="meta mt-1.5 text-[0.7rem] uppercase tracking-[0.12em]">
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
