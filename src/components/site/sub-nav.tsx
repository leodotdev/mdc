import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { Link, useLocation } from "@tanstack/react-router"

import { api } from "../../../convex/_generated/api"
import { useTranslation } from "@/lib/i18n/context"
import { localizeSectionName } from "@/lib/i18n/sections"

// Renders directly under the main nav (and its divider) when the reader
// is on a /section/$slug page whose section has children — mirrors the
// main nav's layout, sizing and spacing so the two strips read as a
// single navigation column. Regular weight (not bold) and no all-caps,
// keeping it visually subordinate to the main nav above it.
export function SubNav() {
  const { lang } = useTranslation()
  const location = useLocation()
  const { data: sections } = useQuery(convexQuery(api.sections.list, {}))

  const match = location.pathname.match(/^\/section\/([^/]+)\/?$/)
  if (!match || !sections) return null
  const current = sections.find((s) => s.slug === match[1])
  if (!current) return null

  const parent = current.parentId
    ? sections.find((s) => s._id === current.parentId) ?? current
    : current
  // Children include sections whose primary parent is `parent` AND
  // any section cross-listed under `parent` (museums cross-lists into
  // arts even though its primary parent is science). Dedupe by _id so
  // a section never renders twice in one nav row.
  const seen = new Set<string>()
  const children = sections
    .filter((s) => {
      const isChild = s.parentId === parent._id
      const isCrossListed =
        s.crossListedIn?.includes(parent._id) ?? false
      if (!isChild && !isCrossListed) return false
      if (seen.has(s._id as string)) return false
      seen.add(s._id as string)
      return true
    })
    .sort((a, b) => a.order - b.order)
  if (children.length === 0) return null

  const accent = parent.accentColor

  return (
    <nav aria-label={`${parent.name} sub-sections`} className="py-2">
      <ul className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1">
        {children.map((s) => {
          const active = s._id === current._id
          return (
            <li key={s._id}>
              <Link
                to="/section/$slug"
                params={{ slug: s.slug }}
                // Idle text inherits `text-foreground` — the masthead's
                // `themed-chrome` repoints that token to the section's
                // -950 (light) / -200 (dark) palette step, so the strip
                // reads correctly in both modes. Hover/active pair
                // *inverts* between themes (pale-bg + deep-fg in light,
                // deep-bg + pale-fg in dark) so the pill stays "stamped"
                // against either chrome — same `light-dark()` swap the
                // main nav uses.
                className={
                  active
                    ? "block rounded-md bg-[var(--hover-bg)] px-2.5 py-1.5 font-sans text-base font-normal text-[var(--hover-fg)] transition"
                    : "block rounded-md px-2.5 py-1.5 font-sans text-base font-normal text-foreground transition hover:bg-[var(--hover-bg)] hover:text-[var(--hover-fg)]"
                }
                data-nav-state={active ? "active" : "inactive"}
                style={{
                  ["--hover-bg" as string]: `light-dark(oklch(from ${accent} 0.92 calc(c * 0.35) h), oklch(from ${accent} 0.27 calc(c * 0.5) h))`,
                  ["--hover-fg" as string]: `light-dark(oklch(from ${accent} 0.27 calc(c * 0.5) h), oklch(from ${accent} 0.92 calc(c * 0.35) h))`,
                }}
              >
                {localizeSectionName(s, lang)}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
