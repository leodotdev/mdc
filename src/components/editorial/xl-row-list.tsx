import { Link } from "@tanstack/react-router"

import { HeroCaption } from "./hero-caption"
import { StoryItem } from "./story-item"
import type { ArticleWithRelations } from "@/lib/article-types"
import { HeroImg } from "@/components/site/hero-img"
import { useOpenArticleDrawer } from "@/lib/use-open-article-drawer"

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
  const openInDrawer = useOpenArticleDrawer()
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
                onClick={(e) => openInDrawer(a.slug, e)}
                className="group/xl block self-start [contain:paint] md:col-span-7 md:col-start-6"
              >
                <HeroImg
                  url={a.heroImage}
                  width={1000}
                  className="aspect-[3/2] w-full object-cover transition-transform duration-200 ease-out group-hover/xl:scale-[1.015]"
                />
                {a.heroCaption ? (
                  <figcaption className="mt-2">
                    <HeroCaption
                      caption={a.heroCaption}
                      citations={a.citations}
                    />
                  </figcaption>
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
