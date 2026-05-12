import type {
  ArticleWithRelations,
  EventWithRelations,
} from "@/lib/article-types"
import { isEventCard } from "@/lib/article-types"
import type { Lang } from "@/lib/i18n/strings"

// Swap an article's user-facing copy (title / dek / body / heroCaption)
// to the requested language's stored translation when available. Falls
// back to the EN original whenever the ES variant is missing — so a
// just-published story whose ES translation hasn't run yet still
// renders, instead of disappearing on the lang switch.
//
// Usage:
//   const { t } = useTranslation()
//   const a = localizedArticle(article, lang)
//   <h2>{a.title}</h2>
export function localizedArticle<T extends ArticleWithRelations>(
  article: T,
  lang: Lang,
): T {
  if (lang === "en") return article
  const tr = article.translations?.es
  if (!tr) return article
  return {
    ...article,
    title: tr.title,
    dek: tr.dek,
    body: tr.body,
    heroCaption: tr.heroCaption ?? article.heroCaption,
  }
}

// Event version — same idea, with event-side translation field names
// (description instead of dek, optional dek/body for kind=reported).
export function localizedEvent<T extends EventWithRelations>(
  event: T,
  lang: Lang,
): T {
  if (lang === "en") return event
  const tr = event.translations?.es
  if (!tr) return event
  return {
    ...event,
    title: tr.title,
    description: tr.description,
    dek: tr.dek ?? event.dek,
    body: tr.body ?? event.body,
    heroCaption: tr.heroCaption ?? event.heroCaption,
  }
}

// Polymorphic helper for newspaper-style cards that may render either
// an article OR an event. Detects kind via `isEventCard` and routes
// to the right localizer.
import type { StoryCardItem } from "@/lib/article-types"
export function localizedCard<T extends StoryCardItem>(item: T, lang: Lang): T {
  if (isEventCard(item)) {
    return localizedEvent(item, lang) as T
  }
  return localizedArticle(item, lang) as T
}
