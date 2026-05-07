import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"

import { api } from "../../../convex/_generated/api"
import { StoryItem } from "./story-item"
import type { Id } from "../../../convex/_generated/dataModel"

// Renders the "Story arc" treatment when an article belongs to a cluster of
// related stories. Shows the arc's other members in chronological order so
// the reader can follow the thread forward and back. Hidden if there's
// nothing else in the arc yet.
export function StoryArcRail({
  arcId,
  currentArticleId,
}: {
  arcId: Id<"storyArcs">
  currentArticleId: Id<"articles">
}) {
  const { data } = useQuery({
    ...convexQuery(api.articles.storyArcMembers, { arcId }),
    enabled: !!arcId,
  })
  if (!data || !data.arc) return null
  const others = data.articles.filter((a) => a._id !== currentArticleId)
  if (others.length === 0) return null

  return (
    <section className="mt-12 border-t pt-8">
      <header className="rule-bottom mb-6 flex items-baseline justify-between pb-2">
        <div>
          <p className="kicker text-muted-foreground">Story arc</p>
          <h2 className="font-heading mt-1 text-xl font-semibold leading-tight">
            {data.arc.title}
          </h2>
        </div>
        <span className="meta text-xs">
          {others.length + 1}{" "}
          {others.length + 1 === 1 ? "story" : "stories"} · in order
        </span>
      </header>
      <ol className="grid gap-6 md:grid-cols-3">
        {others.slice(0, 6).map((article, i) => (
          <li key={article._id} className="relative">
            <span className="kicker text-muted-foreground absolute -top-3 left-0">
              #{i + 1}
            </span>
            <StoryItem
              article={article}
              layout="image-top"
              size="default"
              showDek={false}
            />
          </li>
        ))}
      </ol>
    </section>
  )
}
