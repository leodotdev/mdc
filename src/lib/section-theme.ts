import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { useLocation } from "@tanstack/react-router"
import { api } from "../../convex/_generated/api"
import type * as React from "react"


// Returns the active section's accent color (the parent's color when on a
// sub-section page) for use as the masthead + footer background tint.
//
// `null` when:
//   - not on a /section/$slug route
//   - sections data hasn't loaded
//   - the slug doesn't match any section
//
// Used by Masthead + Footer to apply a "mini-theme" — the entire site
// chrome takes on the section's color so readers feel like they entered
// a sub-paper. Body content stays neutral.
export function useSectionAccent(): string | null {
  const location = useLocation()
  const { data: sections } = useQuery(convexQuery(api.sections.list, {}))

  // Match `/section/{slug}` (and only that — not nested paths).
  const match = location.pathname.match(/^\/section\/([^/]+)\/?$/)
  if (!match || !sections) return null
  const current = sections.find((s) => s.slug === match[1])
  if (!current) return null
  // On a sub-section page, theme by the parent's color so all sub-section
  // pages of Sports look like one Sports paper, not 8 different colors.
  if (current.parentId) {
    const parent = sections.find((s) => s._id === current.parentId)
    if (parent) return parent.accentColor
  }
  return current.accentColor
}

// Inline style emitting the six per-section CSS vars (bg + fg + muted +
// faint × light + dark) used by `.themed-chrome` to repaint masthead /
// footer foregrounds. `oklch(from)` pins each step to a fixed target
// lightness so high-lightness hues like yellow still land at the right
// perceived darkness for -950, etc.
export function sectionThemeStyle(
  accent: string,
): React.CSSProperties {
  return {
    ["--section-bg-light" as string]: `oklch(from ${accent} 0.97 calc(c * 0.18) h)`,
    ["--section-bg-dark" as string]: `oklch(from ${accent} 0.20 calc(c * 0.4) h)`,
    ["--section-fg-light" as string]: `oklch(from ${accent} 0.27 calc(c * 0.5) h)`,
    ["--section-fg-dark" as string]: `oklch(from ${accent} 0.92 calc(c * 0.35) h)`,
    ["--section-fg-muted-light" as string]: `oklch(from ${accent} 0.45 calc(c * 0.7) h)`,
    ["--section-fg-muted-dark" as string]: `oklch(from ${accent} 0.7 calc(c * 0.6) h)`,
    ["--section-fg-faint-light" as string]: `oklch(from ${accent} 0.92 calc(c * 0.35) h)`,
    ["--section-fg-faint-dark" as string]: `oklch(from ${accent} 0.36 calc(c * 0.55) h)`,
  }
}
