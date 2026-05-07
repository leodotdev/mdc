import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { Check, ChevronDown } from "lucide-react"

import { api } from "../../../convex/_generated/api"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTranslation } from "@/lib/i18n/context"
import { localizeSectionName } from "@/lib/i18n/sections"

// Multi-select section filter, modeled on `<NeighborhoodsMenu>` so the
// /events subnav reads as the same family of control as the main nav's
// Neighborhoods dropdown. Selecting a section toggles its slug in the
// `selected` array; the trigger label flips from "All sections" → the
// section's name (1 selected) → "Sports + 2" (more).
//
// Reuses the dropdown's own click-to-toggle convention rather than
// shadcn's CheckboxItem so a checkmark on the active rows is the only
// visual cue — matches the Neighborhoods item styling exactly.
export function SectionFilterDropdown({
  selected,
  onChange,
  triggerClassName,
  triggerStyle,
}: {
  selected: ReadonlyArray<string>
  onChange: (next: Array<string>) => void
  /** Caller passes the same `linkClass` the rest of the nav uses so the
   *  trigger sits flush with the surrounding chips. */
  triggerClassName?: string
  triggerStyle?: React.CSSProperties
}) {
  const { lang } = useTranslation()
  const { data: sections } = useQuery(convexQuery(api.sections.list, {}))

  // Top-level sections only — sub-sections aren't standalone feeds; the
  // parent's filter naturally includes events filed under any of its
  // children via the same `sectionMatcher` logic the page uses.
  const topLevel = (sections ?? []).filter((s) => !s.parentId)
  const selectedSet = new Set(selected)
  const active = selected.length > 0

  // Trigger label: 0 → "All sections", 1 → that section's name, more →
  // "<first> + N" (matches the neighborhoods-trigger selected-value
  // pattern but compresses for multi-select).
  let triggerLabel: string
  if (selected.length === 0) {
    triggerLabel = "All sections"
  } else if (selected.length === 1) {
    const only = topLevel.find((s) => s.slug === selected[0])
    triggerLabel = only ? localizeSectionName(only, lang) : selected[0]
  } else {
    const first = topLevel.find((s) => s.slug === selected[0])
    const head = first ? localizeSectionName(first, lang) : selected[0]
    triggerLabel = `${head} + ${selected.length - 1}`
  }

  const toggle = (slug: string) => {
    const next = selectedSet.has(slug)
      ? selected.filter((s) => s !== slug)
      : [...selected, slug]
    onChange(next)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={`${triggerClassName ?? ""} inline-flex items-center gap-1`}
        data-nav-state={active ? "active" : "inactive"}
        style={triggerStyle}
      >
        {triggerLabel}
        <ChevronDown className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="center"
        sideOffset={6}
        className="[&:has([data-nav-state=inactive]:hover)_[data-nav-state=inactive]:not(:hover)]:opacity-70"
      >
        {/* Clear-all row — only renders when at least one section is
            picked, to keep the menu tight when nothing is filtered yet. */}
        {active ? (
          <DropdownMenuItem
            className="cursor-pointer transition"
            data-nav-state="active"
            onClick={() => onChange([])}
          >
            <span className="size-4" aria-hidden />
            <span>All sections</span>
          </DropdownMenuItem>
        ) : null}
        {topLevel.map((s) => {
          const isOn = selectedSet.has(s.slug)
          return (
            <DropdownMenuItem
              key={s._id}
              className="cursor-pointer transition"
              data-nav-state={isOn ? "active" : "inactive"}
              // Prevent base-ui from auto-closing on item select so the
              // user can toggle several sections in one open. Tap-out or
              // Esc still closes.
              closeOnClick={false}
              onClick={(e) => {
                e.preventDefault()
                toggle(s.slug)
              }}
            >
              {isOn ? (
                <Check className="size-4" />
              ) : (
                <span
                  aria-hidden
                  className="size-4 inline-flex items-center justify-center"
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{ background: s.accentColor }}
                  />
                </span>
              )}
              <span>{localizeSectionName(s, lang)}</span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
