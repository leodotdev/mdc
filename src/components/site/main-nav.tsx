import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { Link, useLocation } from "@tanstack/react-router"
import { Check, ChevronDown } from "lucide-react"

import { api } from "../../../convex/_generated/api"
import { NEIGHBORHOODS } from "../../../convex/lib/neighborhoods"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTranslation } from "@/lib/i18n/context"
import { localizeSectionName } from "@/lib/i18n/sections"
import { useNeighborhoodFilter } from "@/lib/neighborhood-filter"

// Section ordering: sections with order >= SPECIALTY_THRESHOLD render
// after the news-y / lifestyle ones in the same flat row (the explicit
// vertical hairline that used to sit before them was dropped — Events
// and Opinion now flow together with the rest of the nav). The
// threshold still matters for ordering, just not the divider.
const SPECIALTY_THRESHOLD = 90

export function MainNav() {
  const { lang, t } = useTranslation()
  const location = useLocation()
  const { data: sections } = useQuery(convexQuery(api.sections.list, {}))

  if (!sections || sections.length === 0) return <div className="h-11" />

  // Show top-level sections only. Sub-sections (parentId set) are
  // reachable through the SubNav strip that renders below the main nav
  // when the editor opens a parent section. Events is its own nav
  // anchor (its own route), not a section.
  const visible = sections.filter((s) => !s.parentId)
  const regular = visible.filter((s) => s.order < SPECIALTY_THRESHOLD)
  const specialty = visible.filter((s) => s.order >= SPECIALTY_THRESHOLD)

  // Resolve the active "trunk" slug — the top-level section that owns
  // the current page. On a sub-section page (e.g. /section/business),
  // returns the parent slug ("news") so the trunk lights up alongside
  // the sub-section row. Empty when not on a section page.
  const sectionMatch = location.pathname.match(/^\/section\/([^/]+)\/?$/)
  let trunkSlug: string | null = null
  if (sectionMatch) {
    const current = sections.find((s) => s.slug === sectionMatch[1])
    if (current) {
      const parent = current.parentId
        ? sections.find((s) => s._id === current.parentId)
        : null
      trunkSlug = parent ? parent.slug : current.slug
    }
  }

  // When the reader is on a section page, the entire nav row reads in
  // that section's voice — every item's idle / hover / active text is
  // tinted to the active section's -950, so News-active makes the row
  // blue-toned, Sports-active makes it red-toned, etc. Hover *bg* still
  // previews the hovered section's own color, so you can preview where a
  // click would take you without losing the tone of the room.
  const activeSection = trunkSlug
    ? sections.find((s) => s.slug === trunkSlug)
    : null
  const activeAccent = activeSection?.accentColor ?? null

  return (
    <nav aria-label={t("drawer.sections")} className="py-2.5">
      {/* Hovering an inactive item dims its inactive siblings to 70%
          opacity (active items never dim, hovered item stays solid).
          Using `:has()` on the row avoids React mouse handlers — pure
          CSS, in sync with the browser's hover state. */}
      <ul className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1 [&:has([data-nav-state=inactive]:hover)_[data-nav-state=inactive]:not(:hover)]:opacity-70">
        {/* Site-wide neighborhood filter — lives BEFORE the section
            beats so it reads as the room-selector for the whole page,
            not a peer of the topical beats. Default "All Neighborhoods" =
            no filter active. */}
        <li>
          <NeighborhoodFilterMenu activeAccent={activeAccent} />
        </li>
        {/* Vertical divider between the filter and the section beats. */}
        <li aria-hidden className="px-1">
          <span className="block h-5 w-px bg-foreground/20" />
        </li>
        {regular.map((s) => (
          <li key={s._id}>
            <SectionLink
              slug={s.slug}
              name={localizeSectionName(s, lang)}
              accent={s.accentColor}
              active={trunkSlug === s.slug}
              activeAccent={activeAccent}
            />
          </li>
        ))}
        {specialty.map((s) => (
          <li key={s._id}>
            <SectionLink
              slug={s.slug}
              name={localizeSectionName(s, lang)}
              accent={s.accentColor}
              active={trunkSlug === s.slug}
              activeAccent={activeAccent}
            />
          </li>
        ))}
      </ul>
    </nav>
  )
}

// Each section's hover background = a tint of its accent color
// (Sports → pale blue, Food → pale orange, etc) with text that's a
// deeper shade of the same hue. Accents in the seed are mostly Tailwind
// -600s; mixing toward white at 30% lands near -200, mixing toward black
// at 45% lands near -950 — both produced inline via color-mix so a
// single accent value drives the whole interaction state.
// Single class string drives every state. Idle inherits
// `text-foreground` — when the masthead carries `.themed-chrome` (a
// section is active) that token is repointed to the section's
// -950 (light) / -200 (dark) palette step via styles.css, so the row
// auto-flips for both modes without per-element light/dark wiring.
// Hover + active both raise specificity by adding a pseudo-class or
// attribute selector, overriding idle deterministically — no source-
// order race. `transition` covers color + background-color + opacity
// so the dim/undim and the hover color shift use the same easing.
const linkClass =
  "block rounded-md px-2.5 py-1.5 font-sans text-base font-bold transition text-foreground data-[nav-state=active]:bg-[var(--hover-bg)] data-[nav-state=active]:text-[var(--hover-fg)] hover:bg-[var(--hover-bg)] hover:text-[var(--hover-fg)]"

// Map any accent onto a target Tailwind palette step. Uses
// `oklch(from)` so the lightness is FIXED regardless of source hue —
// crucial for yellow, whose -600 (L≈0.80) is far lighter than blue-600
// (L≈0.55). A simple `color-mix(... black)` darkens proportionally and
// would land yellow around -800 instead of the required -950. Chroma
// scales down too, mirroring Tailwind's own palette compression as you
// step away from -500.
const fg950 = (accent: string) =>
  `oklch(from ${accent} 0.27 calc(c * 0.5) h)`
const bg200 = (accent: string) =>
  `oklch(from ${accent} 0.92 calc(c * 0.35) h)`

// Idle text is inherited via `text-foreground`, which `themed-chrome`
// swaps between `--section-fg-light` (-950) and `--section-fg-dark`
// (-200) per `.dark`.
//
// Hover/active pair *inverts* between light and dark so the chrome
// reads as a "stamped pill" in both themes: pale -200 bg over deep
// -950 fg in light mode, and the reverse (deep bg / pale fg) in dark
// mode. Without this swap, the dark-mode pill ended up pale-on-dark
// — visually identical to light mode and out-of-place against the
// dark chrome. `light-dark()` resolves against the document's
// `color-scheme`, which is set on `:root` / `.dark` in styles.css.
function accentVars(
  ownAccent: string,
  _activeAccent: string | null,
): React.CSSProperties {
  void _activeAccent
  const pale = bg200(ownAccent)
  const deep = fg950(ownAccent)
  return {
    ["--hover-bg" as string]: `light-dark(${pale}, ${deep})`,
    ["--hover-fg" as string]: `light-dark(${deep}, ${pale})`,
  }
}

function SectionLink({
  slug,
  name,
  accent,
  active,
  activeAccent,
}: {
  slug: string
  name: string
  accent: string
  /** When true, render as active even if the URL doesn't match this slug
   *  exactly — used to keep the parent trunk lit up while the reader is
   *  on one of its sub-sections. */
  active?: boolean
  /** Active section's accent color (the trunk currently lit up), or null
   *  when not on a section page. Tints every nav item's foreground when
   *  set. */
  activeAccent: string | null
}) {
  return (
    <Link
      to="/section/$slug"
      params={{ slug }}
      className={linkClass}
      activeProps={{ "data-nav-state": "active" }}
      data-nav-state={active ? "active" : "inactive"}
      style={accentVars(accent, activeAccent)}
    >
      {name}
    </Link>
  )
}

// Events + Neighborhoods keep the solid-accent treatment, but invert
// the bg/fg pair across themes so they read as a "stamped pill" in
// both modes. `--primary` is the deep brand brown in light and a
// cream tone in dark, so naive `bg: var(--primary)` would land as a
// pale pill in dark mode — the same out-of-place feel the section
// accents had. `light-dark()` resolves to whichever token is dark on
// each side, giving deep-bg + pale-fg consistently.
function brandVars(_activeAccent: string | null): React.CSSProperties {
  void _activeAccent
  return {
    ["--hover-bg" as string]:
      "light-dark(var(--primary), var(--primary-foreground))",
    ["--hover-fg" as string]:
      "light-dark(var(--primary-foreground), var(--primary))",
  }
}


// Site-wide neighborhood filter dropdown. Multi-select via checkboxes.
// Empty selection = "all" = no filter applied. The trigger label
// summarizes the current state ("All Neighborhoods" / "Wynwood" / "3
// neighborhoods"). When the reader is on a /neighborhood/$slug page,
// that route's loader pre-applies the filter to that single slug, so
// the dropdown reads the matching state from the shared context.
function NeighborhoodFilterMenu({
  activeAccent,
}: {
  activeAccent: string | null
}) {
  const { selected, toggle, clear } = useNeighborhoodFilter()
  const active = selected.length > 0

  const triggerLabel = (() => {
    if (selected.length === 0) return "All Neighborhoods"
    if (selected.length === 1) {
      const match = NEIGHBORHOODS.find((n) => n.slug === selected[0])
      return match?.name ?? "1 neighborhood"
    }
    return `${selected.length} neighborhoods`
  })()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={`${linkClass} inline-flex w-44 items-center justify-between gap-1`}
        data-nav-state={active ? "active" : "inactive"}
        style={brandVars(activeAccent)}
      >
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown className="size-4 shrink-0" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="max-h-[28rem] overflow-y-auto [&:has([data-nav-state=inactive]:hover)_[data-nav-state=inactive]:not(:hover)]:opacity-70"
      >
        {/* All Neighborhoods row — clearing collapses to the empty / unfiltered
            state. Bolds when no filter active so the reader can see
            "you're seeing everything". */}
        <DropdownMenuItem
          className="cursor-pointer transition font-semibold"
          data-nav-state={!active ? "active" : "inactive"}
          onClick={() => clear()}
        >
          <span className="mr-2 inline-flex size-4 items-center justify-center">
            {!active ? <Check className="size-3.5" aria-hidden /> : null}
          </span>
          All Neighborhoods
        </DropdownMenuItem>
        <div className="my-1 h-px bg-foreground/10" />
        {NEIGHBORHOODS.map((n) => {
          const checked = selected.includes(n.slug)
          return (
            <DropdownMenuItem
              key={n.slug}
              className="cursor-pointer transition"
              data-nav-state={checked ? "active" : "inactive"}
              // Base UI's Menu.Item closes the menu on click by
              // default; the multi-select dropdown needs to stay open
              // so the reader can tick several neighborhoods in a row.
              closeOnClick={false}
              onClick={() => toggle(n.slug)}
            >
              <span className="mr-2 inline-flex size-4 items-center justify-center">
                {checked ? <Check className="size-3.5" aria-hidden /> : null}
              </span>
              {n.name}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
