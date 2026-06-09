import { convexQuery } from "@convex-dev/react-query"
import { useSuspenseQuery } from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"

import { api } from "../../../convex/_generated/api"
import { BlockSeparator } from "@/components/editorial/block-separator"
import { HeroSplit } from "@/components/editorial/hero-split"
import { PageHeader } from "@/components/editorial/page-header"
import { SectionHeaderCell } from "@/components/editorial/section-header-cell"
import { SidebarRail } from "@/components/editorial/sidebar-rail"
import { CalendarMonth } from "@/components/editorial/calendar-month"
import { EventsMap } from "@/components/editorial/events-map"
import { EventListView } from "@/components/editorial/event-list-view"
import { EventCard } from "@/components/editorial/event-card"
import { XlRowList } from "@/components/editorial/xl-row-list"
import { BannerAd } from "@/components/site/banner-ad"
import { convexSuspenseQuery } from "@/lib/convex-suspense"
import { useNeighborhoodFilter } from "@/lib/neighborhood-filter"
import { useViewMode } from "@/lib/view-mode"

function humanize(slug: string): string {
  return slug
    .split("-")
    .map((p) => (p.length > 0 ? p[0].toUpperCase() + p.slice(1) : p))
    .join(" ")
}

export const Route = createFileRoute("/_site/tag/$slug")({
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(
      convexQuery(api.events.listByTag, { tag: params.slug, limit: 60 }),
    )
  },
  head: ({ params }) => ({
    meta: [{ title: `${humanize(params.slug)} · miami.community` }],
  }),
  component: TagPage,
})

function TagPage() {
  const { slug } = Route.useParams()
  const { mode } = useViewMode()
  const { data: dataRaw } = useSuspenseQuery(
    convexSuspenseQuery(api.events.listByTag, { tag: slug, limit: 60 }),
  )
  const { matches, selected, clear } = useNeighborhoodFilter()
  const filterActive = selected.length > 0
  const data = dataRaw.filter(matches)

  // Same wave layout as section pages: hero split → xl rows → long
  // tail. Tag pages don't have an importance ranking yet, so we use
  // recency as the proxy.
  const lead = data[0]
  const subleads = data.slice(1, 3)
  const xlRows = data.slice(3, 8)
  const longTail = data.slice(8)

  // Co-occurring tags: tags that appear on the same items. Useful
  // rail content + helps readers navigate the tag graph.
  const tagFreq = new Map<string, number>()
  for (const a of data) {
    for (const t of a.tags ?? []) {
      if (t === slug) continue
      tagFreq.set(t, (tagFreq.get(t) ?? 0) + 1)
    }
  }
  const coTags = Array.from(tagFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)

  // Alternate view modes — share the same header but swap the body.
  if (mode === "list") {
    return (
      <div className="flex flex-col gap-10">
        <PageHeader
          kicker={`Tag · ${slug}`}
          title={`#${humanize(slug).toLowerCase()}`}
        />
        <EventListView
          events={data}
          emptyLabel={`Nothing tagged "${slug}" yet.`}
        />
      </div>
    )
  }
  if (mode === "month") {
    return (
      <div className="flex flex-col gap-10">
        <PageHeader
          kicker={`Tag · ${slug}`}
          title={`#${humanize(slug).toLowerCase()}`}
        />
        <TagMonthView tag={slug} />
      </div>
    )
  }
  if (mode === "map") {
    return (
      <div className="flex flex-col gap-10">
        <PageHeader
          kicker={`Tag · ${slug}`}
          title={`#${humanize(slug).toLowerCase()}`}
        />
        <TagMapView tag={slug} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        kicker={`Tag · ${slug}`}
        title={`#${humanize(slug).toLowerCase()}`}
        dek={
          data.length > 0
            ? `${data.length} ${data.length === 1 ? "event" : "events"} tagged.`
            : undefined
        }
      />

      {data.length === 0 ? (
        <div className="font-editorial mt-12 text-lg text-muted-foreground">
          {filterActive && dataRaw.length > 0 ? (
            <>
              <p>
                No #{slug} events match the neighborhoods you picked.
              </p>
              <p className="mt-6">
                <button
                  type="button"
                  onClick={() => clear()}
                  className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/85"
                >
                  Show all neighborhoods
                </button>
              </p>
            </>
          ) : (
            <>
              <p>Nothing tagged "{slug}" yet.</p>
              <p className="mt-3">
                <Link to="/" className="underline">
                  Back to the front page
                </Link>
              </p>
            </>
          )}
        </div>
      ) : (
        <section className="grid grid-cols-1 gap-y-8 lg:grid-cols-12 lg:gap-x-6">
          <div className="lg:col-span-9">
            {lead ? <HeroSplit lead={lead} subleads={subleads} /> : null}
            {xlRows.length > 0 ? (
              <BlockSeparator className="mt-2">
                <XlRowList events={xlRows} />
              </BlockSeparator>
            ) : null}
          </div>

          <SidebarRail className="lg:col-span-3">
            {coTags.length > 0 ? (
              <section>
                <SectionHeaderCell title="Often together" className="mb-4" />
                <div className="flex flex-wrap gap-2">
                  {coTags.map(([tag, count]) => (
                    <Link
                      key={tag}
                      to="/tag/$slug"
                      params={{ slug: tag }}
                      className="meta inline-flex items-center gap-1 rounded-full border border-foreground/20 px-3 py-1 text-xs hover:bg-muted"
                    >
                      #{tag}
                      <span className="font-mono text-[0.6rem] tabular-nums opacity-60">
                        {count}
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}
          </SidebarRail>
        </section>
      )}

      <BannerAd slot={`tag-${slug}-mid`} className="pt-4" />

      {longTail.length > 0 ? (
        <section className="pt-10">
          <SectionHeaderCell
            title={`More tagged #${slug}`}
            className="mb-6"
          />
          <div className="grid border-t border-l border-foreground md:grid-cols-3">
            {longTail.map((event) => (
              <EventCard
                key={event._id}
                event={event}
                layout="framed"
                size="sm"
                imageAspect="4/3"
                showDek={false}
                showKicker={false}
              />
            ))}
          </div>
        </section>
      ) : null}

      <BannerAd slot={`tag-${slug}-bottom`} className="pt-6" />
    </div>
  )
}

function TagMonthView({ tag }: { tag: string }) {
  const search = Route.useSearch() as { month?: string }
  const now = new Date()
  const yearMonth =
    search.month ??
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  const { data: monthEvents } = useSuspenseQuery(
    convexSuspenseQuery(api.events.inMonth, { yearMonth, tag }),
  )
  const { matches } = useNeighborhoodFilter()
  return (
    <CalendarMonth events={monthEvents.filter(matches)} yearMonth={yearMonth} />
  )
}

function TagMapView({ tag }: { tag: string }) {
  const { data: mapEvents } = useSuspenseQuery(
    convexSuspenseQuery(api.events.placedOnMap, { tag }),
  )
  const { matches } = useNeighborhoodFilter()
  return <EventsMap events={mapEvents.filter(matches)} />
}
