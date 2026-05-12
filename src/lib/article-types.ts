import type { FunctionReturnType } from "convex/server"
import type { api } from "../../convex/_generated/api"

export type ArticleWithRelations = NonNullable<
  FunctionReturnType<typeof api.articles.getBySlug>
>

// Event-side parallel: same hydrated shape produced by api.events.getBySlug.
// The events-only pivot (Phase 2) feeds these into all the public-site
// templates that used to take an article.
export type EventWithRelations = NonNullable<
  FunctionReturnType<typeof api.events.getBySlug>
>

// Discriminated union — what every newspaper-style card on the public
// site can render. Detect kind at runtime via `"startsAt" in item`:
// only events have it.
export type StoryCardItem = ArticleWithRelations | EventWithRelations

export function isEventCard(
  item: StoryCardItem,
): item is EventWithRelations {
  return "startsAt" in item
}

export type Section = ArticleWithRelations["section"]
export type ArticleAuthor = ArticleWithRelations["authors"][number]
export type Citation = ArticleWithRelations["citations"][number]
