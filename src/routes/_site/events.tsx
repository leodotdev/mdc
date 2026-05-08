import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"

import { api } from "../../../convex/_generated/api"
import { CalendarList } from "@/components/events/calendar-list"
import { HappeningNowStrip } from "@/components/events/happening-now-strip"
import { PageHeader } from "@/components/editorial/page-header"
import { BannerAd } from "@/components/site/banner-ad"
import { bucketEventsByDay } from "@/lib/event-helpers"
import { useTranslation } from "@/lib/i18n/context"

// Public events page — a single forward-looking list of every
// approved upcoming event, grouped by day. No view switching, no
// time-range chips, no map toggle. Pure scroll. Section filtering is
// retained as a query param but doesn't render UI right now.

const SLUG_PATTERN = /^[a-z0-9-]+$/

type EventsSearch = {
  /** Section slugs to filter the feed to. Multi-select. URL-only;
   *  no UI control on the page. */
  sections?: Array<string>
}

const UPCOMING_DAYS = 365
const UPCOMING_LIMIT = 200

export const Route = createFileRoute("/_site/events")({
  validateSearch: (search: Record<string, unknown>): EventsSearch => {
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
    return { sections }
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(
      convexQuery(api.events.upcoming, {
        limit: UPCOMING_LIMIT,
        days: UPCOMING_DAYS,
      }),
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

  const selectedSections = search.sections ?? []
  const { data: sectionsList } = useQuery(convexQuery(api.sections.list, {}))
  const sectionMatcher = makeSectionMatcher(
    selectedSections,
    sectionsList ?? [],
  )

  const { data: events } = useQuery(
    convexQuery(api.events.upcoming, {
      limit: UPCOMING_LIMIT,
      days: UPCOMING_DAYS,
    }),
  )

  const filtered = (events ?? []).filter(sectionMatcher)
  const daysWithEvents = (() => {
    const map = bucketEventsByDay(filtered)
    return Array.from(map.keys())
      .sort()
      .map((k) => ({ dayKey: k, events: map.get(k) ?? [] }))
  })()

  // "Happening now" strip — the next 24h. Same query result, just
  // sliced to the leading window so we don't double-fetch.
  const now = Date.now()
  const filteredSoon = filtered.filter(
    (e) => e.startsAt >= now && e.startsAt < now + 24 * 3_600_000,
  )

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        kicker={t("events.kicker")}
        title="Events"
        dek={t("events.subtitle")}
      />

      {filtered.length === 0 ? (
        <p className="font-editorial mt-12 max-w-2xl text-lg text-muted-foreground">
          Nothing on the calendar yet. The desk extracts events from source
          items mentioning a concrete date — they'll appear here as feeds
          publish.
        </p>
      ) : (
        <CalendarList
          daysWithEvents={daysWithEvents}
          focalDay={undefined}
          loading={false}
          onLoadMore={() => {}}
        />
      )}

      <BannerAd slot="events-mid" className="pt-4" />

      <HappeningNowStrip events={filteredSoon} />

      <BannerAd slot="events-bottom" className="pt-4" />
    </div>
  )
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
