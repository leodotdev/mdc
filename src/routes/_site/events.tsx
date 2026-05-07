import { convexQuery } from "@convex-dev/react-query"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"

import { api } from "../../../convex/_generated/api"
import type {EventRange} from "@/lib/event-helpers";
import { CalendarList } from "@/components/events/calendar-list"
import { CalendarMap } from "@/components/events/calendar-map"
import { HappeningNowStrip } from "@/components/events/happening-now-strip"
import { PageHeader } from "@/components/editorial/page-header"
import { BannerAd } from "@/components/site/banner-ad"
import {
  
  bucketEventsByDay,
  formatRangeLabel,
  rangeForDay,
  rangeWindow
} from "@/lib/event-helpers"
import { useTranslation } from "@/lib/i18n/context"

const SLUG_PATTERN = /^[a-z0-9-]+$/
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const RANGE_VALUES = new Set<EventRange>(["today", "weekend", "nextWeekend"])

type EventsSearch = {
  range?: EventRange
  /** Set by the subnav chevrons or the Today datepicker (single-day or
   *  range-start). Takes precedence over `range`. */
  day?: string
  /** Set when the Today dropdown's range mode picks a (start, end) pair.
   *  When present, the window is [day, until] (inclusive); otherwise it
   *  collapses to a single-day window. */
  until?: string
  view?: "map"
  /** Top-level section slugs to filter the feed to. Multi-select. */
  sections?: Array<string>
}

export const Route = createFileRoute("/_site/events")({
  validateSearch: (search: Record<string, unknown>): EventsSearch => {
    const range =
      typeof search.range === "string" && RANGE_VALUES.has(search.range as EventRange)
        ? (search.range as EventRange)
        : undefined
    const day =
      typeof search.day === "string" && DAY_PATTERN.test(search.day)
        ? search.day
        : undefined
    const until =
      typeof search.until === "string" && DAY_PATTERN.test(search.until)
        ? search.until
        : undefined
    const view = search.view === "map" ? "map" : undefined
    let sections: Array<string> | undefined
    const raw = search.sections
    if (typeof raw === "string" && raw.length > 0) {
      sections = raw.split(",").filter((s) => SLUG_PATTERN.test(s))
    } else if (Array.isArray(raw)) {
      sections = raw.filter(
        (s): s is string => typeof s === "string" && SLUG_PATTERN.test(s),
      )
    }
    if (sections && sections.length === 0) sections = undefined
    return { range, day, until, view, sections }
  },
  loader: async ({ context }) => {
    // Pre-warm "today" so the page paints immediately. Other ranges
    // refetch on the client when their chip is clicked — they're each a
    // small windowed query so the cost is bounded.
    const { startMs, endMs } = rangeWindow("today")
    await context.queryClient.ensureQueryData(
      convexQuery(api.events.inRange, { rangeStart: startMs, rangeEnd: endMs }),
    )
  },
  head: () => ({
    meta: [{ title: "Events · miami.community" }],
  }),
  component: EventsPage,
})

function EventsPage() {
  const search = Route.useSearch()
  const { t } = useTranslation()

  // Resolve the active window. Day (chevron-stepped) wins; otherwise the
  // explicit range; otherwise today.
  const activeRange: EventRange | null = search.range
    ? search.range
    : rangeForDay(search.day) ?? (search.day ? null : "today")

  const window = (() => {
    if (search.day && search.until) {
      // Range mode — inclusive end; bump by one day so the
      // `inRange` query covers the whole final day.
      const startMs = new Date(`${search.day}T00:00:00Z`).getTime()
      const endMs =
        new Date(`${search.until}T00:00:00Z`).getTime() + 24 * 3_600_000
      return { startMs, endMs }
    }
    if (search.day) {
      const ts = new Date(`${search.day}T00:00:00Z`).getTime()
      return { startMs: ts, endMs: ts + 24 * 3_600_000 }
    }
    return rangeWindow(activeRange ?? "today")
  })()

  const selectedSections = search.sections ?? []
  const { data: sections } = useQuery(convexQuery(api.sections.list, {}))
  const sectionMatcher = makeSectionMatcher(selectedSections, sections ?? [])

  const { data: events } = useQuery({
    ...convexQuery(api.events.inRange, {
      rangeStart: window.startMs,
      rangeEnd: window.endMs,
    }),
    placeholderData: keepPreviousData,
  })

  const filtered = (events ?? []).filter(sectionMatcher)
  const daysWithEvents = (() => {
    const map = bucketEventsByDay(filtered)
    return Array.from(map.keys())
      .sort()
      .map((k) => ({ dayKey: k, events: map.get(k) ?? [] }))
  })()

  // "Happening soon" — tiny 24h query, deduped per page.
  const now = Date.now()
  const { data: soonEvents } = useQuery({
    ...convexQuery(api.events.inRange, {
      rangeStart: now,
      rangeEnd: now + 24 * 3_600_000,
    }),
    placeholderData: keepPreviousData,
  })
  const filteredSoon = (soonEvents ?? []).filter(sectionMatcher)

  const headerLabel = search.day
    ? formatDay(search.day)
    : activeRange
      ? formatRangeLabel(activeRange)
      : "Today"

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        kicker={t("events.kicker")}
        title="Events"
        dek={t("events.subtitle")}
      />

      {filtered.length === 0 ? (
        <EmptyState activeRange={activeRange} />
      ) : search.view === "map" ? (
        <div className="full-bleed">
          <CalendarMap events={filtered} />
        </div>
      ) : (
        <section>
          <p className="meta mb-4">{headerLabel}</p>
          <CalendarList
            daysWithEvents={daysWithEvents}
            focalDay={search.day}
            loading={false}
            onLoadMore={() => {}}
          />
        </section>
      )}

      <BannerAd slot="events-mid" className="pt-4" />

      <HappeningNowStrip events={filteredSoon} />

      <BannerAd slot="events-bottom" className="pt-4" />
    </div>
  )
}

function EmptyState({ activeRange }: { activeRange: EventRange | null }) {
  const navigate = useNavigate()
  // Suggest the next preset window when the active one is empty —
  // chains today → weekend → nextWeekend.
  const suggestion: EventRange | null = (() => {
    if (activeRange === "today") return "weekend"
    if (activeRange === "weekend") return "nextWeekend"
    return null
  })()
  return (
    <div className="font-editorial mt-12 max-w-2xl text-lg text-muted-foreground">
      <p>Nothing on the calendar for this window yet.</p>
      {suggestion ? (
        <p className="mt-3 text-base">
          Try{" "}
          <Link
            to="/events"
            search={(prev: Record<string, unknown>) => ({
              ...prev,
              range: suggestion,
              day: undefined,
            })}
            className="underline hover:text-foreground"
            onClick={(e) => {
              // Defensive — the Link does navigate, this just keeps
              // smooth scroll-to-top from interfering.
              e.preventDefault()
              void navigate({
                to: "/events",
                search: ((prev: Record<string, unknown>) => ({
                  ...prev,
                  range: suggestion,
                  day: undefined,
                })) as never,
              })
            }}
          >
            {nextRangeLabel(suggestion)}
          </Link>
          {" instead."}
        </p>
      ) : null}
    </div>
  )
}

function nextRangeLabel(r: EventRange): string {
  if (r === "weekend") return "this weekend"
  if (r === "nextWeekend") return "next weekend"
  return "today"
}

function formatDay(day: string): string {
  const ts = new Date(`${day}T00:00:00Z`).getTime()
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(ts))
}

// Build a section matcher that's true for every event whose section
// (or section's parent — sub-sections roll up to their trunk) matches
// any of the selected slugs. Empty selection passes everything through.
function makeSectionMatcher(
  selected: ReadonlyArray<string>,
  sections: ReadonlyArray<{
    _id: string
    slug: string
    parentId?: string
  }>,
): (e: { section?: { slug?: string } | null }) => boolean {
  if (selected.length === 0) return () => true
  const selectedSet = new Set(selected)
  // Build a map of every section slug → its top-level (trunk) slug so a
  // sub-section like "music" matches when the user filters on "arts".
  const trunkBySlug = new Map<string, string>()
  for (const s of sections) {
    if (!s.parentId) {
      trunkBySlug.set(s.slug, s.slug)
    } else {
      const parent = sections.find((p) => p._id === s.parentId)
      trunkBySlug.set(s.slug, parent?.slug ?? s.slug)
    }
  }
  return (e) => {
    const slug = e.section?.slug
    if (!slug) return false
    const trunk = trunkBySlug.get(slug) ?? slug
    return selectedSet.has(trunk)
  }
}

