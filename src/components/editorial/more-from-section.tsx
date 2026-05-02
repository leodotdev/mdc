import { Link } from "@tanstack/react-router"

import type { ArticleWithRelations, Section } from "@/lib/article-types"
import { StoryItem } from "./story-item"

// Tighter than `SectionRail` — for the in-article footer. No bold rule,
// no per-section accent header, no "More →" affordance: this rail lives
// inside an article and shouldn't compete with the article hierarchy.
export function MoreFromSection({
  section,
  articles,
}: {
  section: Section
  articles: Array<ArticleWithRelations>
}) {
  if (!section || articles.length === 0) return null
  return (
    <aside className="mx-auto mt-16 max-w-5xl border-t pt-6">
      <div className="mb-5 flex items-baseline justify-between">
        <h2 className="font-heading text-base font-semibold tracking-tight">
          More from{" "}
          <Link
            to="/section/$slug"
            params={{ slug: section.slug }}
            className="hover:underline"
          >
            {section.name}
          </Link>
        </h2>
      </div>
      <div className="grid gap-x-8 gap-y-6 md:grid-cols-3">
        {articles.slice(0, 3).map((a) => (
          <StoryItem
            key={a._id}
            article={a}
            layout={a.heroImage ? "image-top" : "text-only"}
            size="compact"
            showDek={false}
          />
        ))}
      </div>
    </aside>
  )
}
