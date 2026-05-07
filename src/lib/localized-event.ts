import type { EventWithSection } from "@/lib/event-helpers"
import type { Lang } from "@/lib/i18n/strings"

// Swap an event's user-facing copy (title / description / heroCaption)
// to the requested language's stored translation when available. Falls
// back to the EN original whenever the ES variant is missing — so a
// just-approved event whose ES translation hasn't run yet still renders
// instead of disappearing on the lang switch.
//
// Usage:
//   const { lang } = useTranslation()
//   const e = localizedEvent(event, lang)
//   <h2>{e.title}</h2>
export function localizedEvent<T extends EventWithSection>(
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
    heroCaption: tr.heroCaption ?? event.heroCaption,
  }
}
