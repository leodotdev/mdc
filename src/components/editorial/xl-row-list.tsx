import { Link } from "@tanstack/react-router"

import { StoryItem } from "./story-item"
import type { ArticleWithRelations } from "@/lib/article-types"
import { proxiedImageUrl } from "@/lib/image-proxy"

// Stacked "table" rows from the homepage's main column extracted as a
// reusable block. Each row is text 5 cols (left) + image 7 cols (right);
// rows are separated by a heavy `border-t border-foreground` rule that
// gives the page its newspaper grid cadence.
//
// Used by section / tag / author pages below the hero. Articles without
// images render text-only across all 12 cols of their row.
export function XlRowList({
  articles,
  showDek = true,
}: {
  articles: Array<ArticleWithRelations>
  showDek?: boolean
}) {
  return (
    <div className="flex flex-col">
      {articles.map((a, i) => (
        <div
          key={a._id}
          className={
            "grid grid-cols-1 gap-x-6 gap-y-4 pt-8 pb-8 md:grid-cols-12 " +
            (i > 0 ? "border-t border-foreground" : "")
          }
        >
          {a.heroImage ? (
            <>
              <Link
                to="/article/$slug"
                params={{ slug: a.slug }}
                className="group/xl block self-start overflow-hidden rounded-[4px] md:col-span-7 md:col-start-6"
              >
                <img
                  src={proxiedImageUrl(a.heroImage, { width: 1000 })}
                  alt=""
                  loading="lazy"
                  className="aspect-[3/2] w-full object-cover transition-transform duration-200 ease-out group-hover/xl:scale-[1.01]"
                />
                {a.heroCaption ? (
                  <figcaption className="meta mt-2">{a.heroCaption}</figcaption>
                ) : null}
              </Link>
              <div className="flex flex-col md:col-span-5 md:col-start-1 md:row-start-1">
                <StoryItem
                  article={a}
                  layout="text-only"
                  size="lead"
                  showDek={showDek}
                />
              </div>
            </>
          ) : (
            <div className="md:col-span-12">
              <StoryItem
                article={a}
                layout="text-only"
                size="lead"
                showDek={showDek}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
