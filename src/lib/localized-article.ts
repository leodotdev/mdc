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

// Event version — `dek` is now the only translated body field.
// `description` is still on the translation shape for legacy rows
// (it'll be removed in a future narrow); when present, it acts as a
// fallback for events whose dek hasn't been backfilled yet.
export function localizedEvent<T extends EventWithRelations>(
  event: T,
  lang: Lang,
): T {
  if (lang === "en") return event
  const tr = event.translations?.es
  if (!tr) return event
  const trDek = tr.dek ?? tr.description ?? event.dek
  return {
    ...event,
    title: tr.title,
    dek: trDek,
    description: trDek ?? event.description,
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
