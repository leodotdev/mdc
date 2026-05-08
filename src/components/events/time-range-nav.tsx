import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { SectionFilterDropdown } from "./section-filter-dropdown"
import type {EventRange} from "@/lib/event-helpers";
import {
  
  dayKey,
  rangeForDay,
  rangeWindow
} from "@/lib/event-helpers"

// Sub-nav strip for /events. Mounted in the masthead's sub-nav slot
// (alongside SubNav for /section/$slug) so it reads as the same family
// of chrome on every route. Layout, weight and pill sizing match SubNav
// exactly. Order:
//
//   [‹] Today [›]  |  This Weekend  Next Weekend  |  Map  Sections ▾
//
// The chevrons flank "Today" — they step the focal day ±1 from
// whichever window is active, so a reader can wander through the week
// without losing the section / map / filter context. The two weekend
// chips are direct jump-to-window shortcuts.
//
// State is fully URL-driven so deep links + back-button work:
//   ?range=today | weekend | nextWeekend
//   ?day=YYYY-MM-DD          (set by chevrons; overrides range)
//   ?view=map                (toggle)
//   ?sections=music,food     (multi-select, comma-joined)

const RANGE_LABELS: Record<EventRange, string> = {
  today: "Today",
  weekend: "This Weekend",
  nextWeekend: "Next Weekend",
}

const WEEKEND_RANGES: ReadonlyArray<EventRange> = ["weekend", "nextWeekend"]

// Label for the Today dropdown trigger. Reflects the current selection
// so the trigger doubles as a "selected value" — same pattern as the
// Neighborhoods menu in the main nav.
function todayLabel(
  day: string | undefined,
  until: string | undefined,
  activeRange: EventRange | null,
): string {
  if (day && until) {
    return `${formatShortDay(day)} – ${formatShortDay(until)}`
  }
  if (day) return formatShortDay(day)
  if (activeRange === "today") return "Today"
  return "Today"
}

function formatShortDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number)
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)))
}

// Same class shapes as the SubNav so the strip blends with the section
// sub-nav on /section/$slug pages. Pulls `--hover-bg` and `--hover-fg`
// from inline style; the events page anchors on `--primary`.
// Idle is the bare `text-[var(--hover-fg)]` (lowest specificity) so the
// hover + active variants — which add a pseudo-class or attribute
// selector — beat it deterministically. The previous
// `data-[nav-state=inactive]:` qualifier had equal specificity to
// `hover:`, leaving CSS source order in charge and the hover text
// invisible (currentColor on a primary-coloured pill).
const PILL_CLASS =
  "block rounded-md px-2.5 py-1.5 font-sans text-base font-normal transition text-[var(--hover-fg)] data-[nav-state=active]:bg-[var(--hover-bg)] data-[nav-state=active]:text-white hover:bg-[var(--hover-bg)] hover:text-white"

const PILL_VARS: React.CSSProperties = {
  ["--hover-bg" as string]: "var(--primary)",
  ["--hover-fg" as string]: "currentColor",
}

const ICON_PILL_CLASS =
  "inline-flex size-9 items-center justify-center rounded-md transition hover:bg-[var(--hover-bg)] hover:text-white"

export function TimeRangeNav() {
  const search = useSearch({ strict: false })
  const navigate = useNavigate()

  // Active range = explicit range param OR (when chevron-stepped to an
  // arbitrary day) the preset window that day falls into. Defaults to
  // "today" when nothing is set.
  const activeRange: EventRange | null = search.range
    ? search.range
    : rangeForDay(search.day) ?? (search.day ? null : "today")

  const selectedSections = search.sections ?? []
  const view = search.view

  const stepDay = (delta: 1 | -1) => {
    // Anchor day = explicit day OR the start of the active range OR today.
    const baseMs = search.day
      ? new Date(`${search.day}T00:00:00Z`).getTime()
      : activeRange
        ? rangeWindow(activeRange).startMs
        : Date.now()
    const nextMs = baseMs + delta * 24 * 3_600_000
    void navigate({
      to: "/events",
      search: {
        ...search,
        range: undefined,
        day: dayKey(nextMs),
        until: undefined,
      },
    })
  }

  const onChangeSections = (next: Array<string>) => {
    void navigate({
      to: "/events",
      search: {
        ...search,
        sections: next.length > 0 ? next : undefined,
      },
    })
  }

  return (
    <nav aria-label="Event range" className="py-2">
      <ul className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1 [&:has([data-nav-state=inactive]:hover)_[data-nav-state=inactive]:not(:hover)]:opacity-70">
        {/* [‹] Today [›] — chevrons flank the Today chip so the day
            stepper reads as one cluster. */}
        <li>
          <button
            type="button"
            aria-label="Previous day"
            className={ICON_PILL_CLASS}
            style={PILL_VARS}
            onClick={() => stepDay(-1)}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
        </li>
        <li>
          {/* "Today" — clicking it resets to the events page default
              landing (today's window, no range/day overrides). When the
              chevrons have stepped to another day the label shows that
              date instead so the user always knows where they are; the
              click still resets to today. */}
          <Link
            to="/events"
            search={{
              ...search,
              range: undefined,
              day: undefined,
              until: undefined,
            }}
            className={PILL_CLASS}
            data-nav-state={
              !search.day && (!search.range || search.range === "today")
                ? "active"
                : "inactive"
            }
            style={PILL_VARS}
          >
            {todayLabel(search.day, search.until, activeRange)}
          </Link>
        </li>
        <li>
          <button
            type="button"
            aria-label="Next day"
            className={ICON_PILL_CLASS}
            style={PILL_VARS}
            onClick={() => stepDay(1)}
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </li>

        <li aria-hidden className="px-1">
          <span className="block h-5 w-px bg-foreground/20" />
        </li>

        {/* Jump-to-weekend chips. */}
        {WEEKEND_RANGES.map((r) => {
          const isActive = activeRange === r
          return (
            <li key={r}>
              <Link
                to="/events"
                search={{ ...search, range: r, day: undefined }}
                className={PILL_CLASS}
                data-nav-state={isActive ? "active" : "inactive"}
                style={PILL_VARS}
              >
                {RANGE_LABELS[r]}
              </Link>
            </li>
          )
        })}

        <li aria-hidden className="px-1">
          <span className="block h-5 w-px bg-foreground/20" />
        </li>

        <li>
          <Link
            to="/events"
            search={{
              ...search,
              view: view === "list" ? undefined : "list",
            }}
            className={PILL_CLASS}
            data-nav-state={view === "list" ? "active" : "inactive"}
            style={PILL_VARS}
          >
            List
          </Link>
        </li>
        <li>
          <Link
            to="/events"
            search={{
              ...search,
              view: view === "map" ? undefined : "map",
            }}
            className={PILL_CLASS}
            data-nav-state={view === "map" ? "active" : "inactive"}
            style={PILL_VARS}
          >
            Map
          </Link>
        </li>

        <li>
          <SectionFilterDropdown
            selected={selectedSections}
            onChange={onChangeSections}
            triggerClassName={PILL_CLASS}
            triggerStyle={PILL_VARS}
          />
        </li>
      </ul>
    </nav>
  )
}
