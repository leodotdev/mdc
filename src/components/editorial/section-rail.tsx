import { SectionHeaderCell } from "./section-header-cell"
import { StoryItem } from "./story-item"
import type { ArticleWithRelations, Section } from "@/lib/article-types"

// Two article cell sizes only — feature is LARGE (col-span-8 row-span-2),
// the rest are SMALL (col-span-4). Header is a full-width module cell.
//
// Layout (12-col):
//   row 1-2:  feature(LARGE)              + small + small
//   row 3:    small  + small  + small
//
// Renders fewer cells if `articles` is short — leaves cleanly to the next
// section header on the row below.
const LARGE = "md:col-span-8 md:row-span-2"
const SMALL = "md:col-span-4"

export function SectionRailCells({
  section,
  articles,
}: {
  section: Section
  articles: Array<ArticleWithRelations>
}) {
  if (!section || articles.length === 0) return null
  const [feature, ...rest] = articles

  return (
    <>
      <SectionHeaderCell
        title={section.name}
        accent={section.accentColor}
        moreHref="/section/$slug"
        moreParams={{ slug: section.slug }}
        className="md:col-span-12"
      />
      {feature ? (
        <StoryItem
          article={feature}
          layout="framed"
          size="default"
          showDek
          imageAspect="16/9"
          className={LARGE}
        />
      ) : null}
      {rest.slice(0, 5).map((a, i) => (
        <StoryItem
          key={a._id}
          article={a}
          layout="framed"
          size="sm"
          imageAspect="4/3"
          showImage={i < 2}
          showDek={false}
          className={SMALL}
        />
      ))}
    </>
  )
}
