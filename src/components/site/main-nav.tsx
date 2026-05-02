import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"

import { api } from "../../../convex/_generated/api"
import { useTranslation } from "@/lib/i18n/context"
import { localizeSectionName } from "@/lib/i18n/sections"

// Section ordering: sections with order >= SPECIALTY_THRESHOLD render
// after the news-y / lifestyle ones in the same flat row (the explicit
// vertical hairline that used to sit before them was dropped — Events
// and Opinion now flow together with the rest of the nav). The
// threshold still matters for ordering, just not the divider.
const SPECIALTY_THRESHOLD = 90

export function MainNav() {
  const { lang, t } = useTranslation()
  const { data: sections } = useQuery(convexQuery(api.sections.list, {}))

  if (!sections || sections.length === 0) return <div className="h-11" />

  // Show top-level sections only — sub-sections are reachable through their
  // parent. things-to-do is surfaced as the top-level Events nav item.
  //
  // The hardcoded SUBSECTIONS set covers known sub-section slugs even before
  // a re-seed has set their `parentId` on the docs (so the nav looks right
  // immediately after a code update, not just after `seed:run`).
  const SUBSECTIONS = new Set(["music", "politics"])
  const visible = sections.filter(
    (s) =>
      !s.parentId &&
      !SUBSECTIONS.has(s.slug) &&
      s.slug !== "things-to-do",
  )
  const regular = visible.filter((s) => s.order < SPECIALTY_THRESHOLD)
  const specialty = visible.filter((s) => s.order >= SPECIALTY_THRESHOLD)

  return (
    <nav aria-label={t("drawer.sections")} className="py-2.5">
      <ul className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1">
        {regular.map((s) => (
          <li key={s._id}>
            <SectionLink slug={s.slug} name={localizeSectionName(s, lang)} />
          </li>
        ))}
        <li>
          <EventsLink label={t("nav.events")} />
        </li>
        {specialty.map((s) => (
          <li key={s._id}>
            <SectionLink slug={s.slug} name={localizeSectionName(s, lang)} />
          </li>
        ))}
      </ul>
    </nav>
  )
}

// Compact-density button-style link, matching WaPo's nav: small horizontal
// padding, rounded, subtle hover background, bold sans label.
const linkClass =
  "block rounded-md px-2.5 py-1.5 font-sans text-base font-bold text-foreground transition-colors hover:bg-muted hover:text-foreground"
const activeLinkClass =
  "block rounded-md bg-muted px-2.5 py-1.5 font-sans text-base font-bold text-primary"

function SectionLink({ slug, name }: { slug: string; name: string }) {
  return (
    <Link
      to="/section/$slug"
      params={{ slug }}
      className={linkClass}
      activeProps={{ className: activeLinkClass }}
    >
      {name}
    </Link>
  )
}

function EventsLink({ label }: { label: string }) {
  return (
    <Link
      to="/events"
      className={linkClass}
      activeProps={{ className: activeLinkClass }}
    >
      {label}
    </Link>
  )
}
