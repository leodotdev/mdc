// Localized-card helpers. Post-article-purge there's only one shape
// (event), so localizedCard is just a re-export of localizedEvent.
// File kept under its old name so the dozens of consumers don't have
// to all rename their imports in the same commit.

import type { EventWithRelations } from "@/lib/article-types"
import type { Lang } from "@/lib/i18n/strings"

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

// Card alias — every card on the public site is an event now, so
// localizedCard just forwards to localizedEvent.
export function localizedCard<T extends EventWithRelations>(
  item: T,
  lang: Lang,
): T {
  return localizedEvent(item, lang) as T
}
