// Single source of truth for event kinds. Add a new kind here, and it flows
// to: the schema validator (events.kind), the admin form, the public filter
// pills, the LLM extraction tool, and insert-time validation.
//
// `slug` lives in the DB; `label` is the display string. Keep slugs short
// and snake-case-free since they appear in URLs.

export const EVENT_KINDS = [
  {
    slug: "general",
    label: "Things to Do",
    description:
      "Concerts, openings, festivals, exhibits — the broad bucket for fun things to do.",
    accent: "oklch(0.588 0.158 241.966)", // sky-600
  },
  {
    slug: "meeting",
    label: "Community Meetings",
    description:
      "Town halls, county-commission meetings, school-board sessions, neighborhood-association meetings.",
    accent: "oklch(0.511 0.262 276.966)", // indigo-600
  },
  {
    slug: "notice",
    label: "Public Notices",
    description:
      "Zoning notices, comment periods, public-record disclosures, environmental-review milestones.",
    accent: "oklch(0.666 0.179 58.318)", // amber-600
  },
  {
    slug: "holiday",
    label: "Holidays",
    description:
      "Civic, cultural, and religious holidays — Calle Ocho, Carnaval, Three Kings Day, etc.",
    accent: "oklch(0.591 0.293 322.896)", // fuchsia-600
  },
  {
    slug: "deal",
    label: "Offers & Deals",
    description:
      "Discounts, happy hours, free-admission days, opening specials.",
    accent: "oklch(0.596 0.145 163.225)", // emerald-600
  },
] as const

export type EventKindSlug = (typeof EVENT_KINDS)[number]["slug"]

const SLUG_SET = new Set(EVENT_KINDS.map((k) => k.slug)) as Set<string>

export function isEventKind(slug: string): slug is EventKindSlug {
  return SLUG_SET.has(slug)
}

export function eventKindLabel(slug: string | undefined): string {
  if (!slug) return "Things to Do"
  return EVENT_KINDS.find((k) => k.slug === slug)?.label ?? "Things to Do"
}

export function eventKindAccent(slug: string | undefined): string {
  if (!slug) return EVENT_KINDS[0].accent
  return (
    EVENT_KINDS.find((k) => k.slug === slug)?.accent ?? EVENT_KINDS[0].accent
  )
}
