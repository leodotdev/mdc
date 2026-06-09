import { convexQuery } from "@convex-dev/react-query"
import { useSuspenseQuery } from "@tanstack/react-query"
import {
  Link,
  createFileRoute,
  notFound,
} from "@tanstack/react-router"
import { useEffect } from "react"

import { api } from "../../../convex/_generated/api"
import { neighborhoodName } from "../../../convex/lib/neighborhoods"
import { compareByImportance } from "../../../convex/lib/scoring"
import { PageHeader } from "@/components/editorial/page-header"
import { SectionHeaderCell } from "@/components/editorial/section-header-cell"
import { EventCard } from "@/components/editorial/event-card"
import { CalendarMonth } from "@/components/editorial/calendar-month"
import { EventsMap } from "@/components/editorial/events-map"
import { EventListView } from "@/components/editorial/event-list-view"
import { EventListItem } from "@/components/events/event-list-item"
import { BannerAd } from "@/components/site/banner-ad"
import { HeroImg } from "@/components/site/hero-img"
import { convexSuspenseQuery } from "@/lib/convex-suspense"
import { useTranslation } from "@/lib/i18n/context"
import { useOpenEventDrawer } from "@/lib/use-open-article-drawer"
import { useNeighborhoodFilter } from "@/lib/neighborhood-filter"
import { useViewMode } from "@/lib/view-mode"

const BLOCK = "pt-10"
const HEAVY = "border-t border-foreground"

// Neighborhood pages mirror the section page layout exactly. There's no
// per-neighborhood accent (neighborhoods don't carry color assignments
// the way sections do), so the brand `--primary` stands in everywhere
// the section page would use `section.accentColor`.
const NEIGHBORHOOD_ACCENT = "var(--primary)"

const ARTICLE_FETCH_LIMIT = 60

export const Route = createFileRoute("/_site/neighborhood/$slug")({
  loader: async ({ context, params }) => {
    const name = neighborhoodName(params.slug)
    if (!name) throw notFound()
    await Promise.all([
      context.queryClient.ensureQueryData(
        convexQuery(api.events.listByNeighborhood, {
          slug: params.slug,
          limit: ARTICLE_FETCH_LIMIT,
        }),
      ),
      context.queryClient.ensureQueryData(
        convexQuery(api.events.popularByNeighborhood, {
          slug: params.slug,
          limit: 5,
        }),
      ),
    ])
    return { name }
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.name
          ? `${loaderData.name} · miami.community`
          : "miami.community",
      },
    ],
  }),
  component: NeighborhoodPage,
})

function NeighborhoodPage() {
  const { slug } = Route.useParams()
  const { name } = Route.useLoaderData()
  const { lang, t } = useTranslation()
  const { mode } = useViewMode()
  const openInDrawer = useOpenEventDrawer()

  // /neighborhood/$slug stays as a deep-link shortcut: visiting one
  // pre-applies the site-wide filter to that single slug, so the
  // dropdown elsewhere reflects "you're seeing wynwood events". The
  // hook reads the URL on mount; this effect ensures bookmark loads
  // also propagate into the filter context.
  const { selected, setSelected } = useNeighborhoodFilter()
  useEffect(() => {
    if (selected.length === 1 && selected[0] === slug) return
    setSelected([slug])
    // Only fire when slug or filter state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  const tr = (a: {
    heroCaption?: string
    title: string
    translations?: { es?: { title: string; heroCaption?: string } }
  }) =>
    lang === "es"
      ? {
          title: a.translations?.es?.title ?? a.title,
          heroCaption: a.translations?.es?.heroCaption ?? a.heroCaption,
        }
      : { title: a.title, heroCaption: a.heroCaption }

  // Single source for events — neighborhoods don't have a separate
  // importance-ranked query the way sections do, so we re-sort the
  // chronological list client-side using the same comparator the section
  // page's `topInSection` uses on the server.
  const { data: list } = useSuspenseQuery(
    convexSuspenseQuery(api.events.listByNeighborhood, {
      slug,
      limit: ARTICLE_FETCH_LIMIT,
    }),
  )
  const { data: events } = useSuspenseQuery(
    convexSuspenseQuery(api.events.popularByNeighborhood, {
      slug,
      limit: 5,
    }),
  )

  if (list.length === 0) {
    return (
      <div className="flex flex-col gap-10">
        <PageHeader
          title={name}
          dek={`Events tied to ${name}.`}
        />
        <div className="font-editorial mt-12 max-w-2xl text-lg text-muted-foreground">
          <p>Nothing tagged {name} yet.</p>
          <p className="mt-4 text-base">
            <Link to="/" className="underline">
              Browse the front page
            </Link>
            .
          </p>
        </div>
      </div>
    )
  }

  const now = Date.now()
  // Adapter for the article-flavored importance comparator: events
  // carry optional `derivedFromItems` / `citations`, so default to
  // empty arrays for safety on legacy rows.
  const asScorable = (e: (typeof list)[number]) => ({
    derivedFromItems: e.derivedFromItems ?? [],
    citations: e.citations ?? [],
    tags: e.tags ?? [],
    title: e.title,
    publishedAt: e.publishedAt,
    createdAt: e.createdAt,
  })
  const ranked = [...list].sort((a, b) =>
    compareByImportance(asScorable(a), asScorable(b), now),
  )

  // Dedupe across the page so the same event doesn't appear twice in
  // different blocks. Mirrors the section/homepage `take` pattern exactly.
  const used = new Set<string>()
  const take = (
    pool: Array<(typeof list)[number]>,
    n: number,
  ): Array<(typeof list)[number]> => {
    const picked: Array<(typeof list)[number]> = []
    for (const a of pool) {
      if (used.has(a._id)) continue
      picked.push(a)
      used.add(a._id)
      if (picked.length >= n) break
    }
    return picked
  }

  const allPool = [...ranked, ...list]

  const lead = take(ranked, 1)[0]
  const leadStack = take(allPool, 2)
  const xlRows = take(allPool, 5)

  const morelead = take(allPool, 1)[0]
  const moreRail = take(allPool, 4)

  const longTail = list
    .filter((a) => !used.has(a._id as string))
    .slice(0, 9)

  if (mode === "list") {
    return (
      <div className="flex flex-col gap-10">
        <PageHeader title={name} />
        <EventListView
          events={list}
          emptyLabel={`No upcoming events tied to ${name}.`}
        />
      </div>
    )
  }
  if (mode === "month") {
    return (
      <div className="flex flex-col gap-10">
        <PageHeader title={name} />
        <NeighborhoodMonthView slug={slug} />
      </div>
    )
  }
  if (mode === "map") {
    return (
      <div className="flex flex-col gap-10">
        <PageHeader title={name} />
        <NeighborhoodMapView slug={slug} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title={name}
        dek={`Events tied to ${name}.`}
      />

      {/* ════════════════════ TOP HERO TABLE ════════════════════ */}
      <section className="grid grid-cols-1 gap-y-8 lg:grid-cols-12 lg:gap-x-6">
        <div className="flex flex-col lg:col-span-9">
          {lead ? (
            <div className="grid grid-cols-1 gap-x-6 gap-y-6 pb-8 md:grid-cols-12">
              {lead.heroImage ? (
                <Link
                  to="/event/$slug"
                  params={{ slug: lead.slug }}
                  onClick={(e) => openInDrawer(lead.slug, e)}
                  className="group/lead block self-start [contain:paint] md:col-span-7 md:col-start-6"
                >
                  <HeroImg
                    url={lead.heroImage}
                    width={1200}
                    priority
                    className="aspect-[3/2] w-full object-cover transition-transform duration-200 ease-out group-hover/lead:scale-[1.015]"
                  />
                  {tr(lead).heroCaption ? (
                    <figcaption className="meta mt-2">
                      {tr(lead).heroCaption}
                    </figcaption>
                  ) : null}
                </Link>
              ) : null}
              <div className="flex flex-col divide-y divide-foreground/15 md:col-span-5 md:col-start-1 md:row-start-1">
                <div className="pb-5">
                  <EventCard
                    event={lead}
                    layout="text-only"
                    size="lead"
                    showDek
                    showKicker={false}
                  />
                </div>
                {leadStack[0] ? (
                  <div className="py-5">
                    <EventCard
                      event={leadStack[0]}
                      layout="text-only"
                      size="compact"
                      showKicker={false}
                    />
                  </div>
                ) : null}
                {leadStack[1] ? (
                  <div className="pt-5">
                    <EventCard
                      event={leadStack[1]}
                      layout="text-only"
                      size="compact"
                      showKicker={false}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {xlRows.map((a) => (
            <div
              key={a._id}
              className={`${HEAVY} grid grid-cols-1 gap-x-6 gap-y-4 pt-8 pb-8 md:grid-cols-12`}
            >
              {a.heroImage ? (
                <Link
                  to="/event/$slug"
                  params={{ slug: a.slug }}
                  onClick={(e) => openInDrawer(a.slug, e)}
                  className="group/xl block self-start [contain:paint] md:col-span-7 md:col-start-6"
                >
                  <HeroImg
                    url={a.heroImage}
                    width={1000}
                    className="aspect-[3/2] w-full object-cover transition-transform duration-200 ease-out group-hover/xl:scale-[1.015]"
                  />
                  {tr(a).heroCaption ? (
                    <figcaption className="meta mt-2">
                      {tr(a).heroCaption}
                    </figcaption>
                  ) : null}
                </Link>
              ) : null}
              <div className="flex flex-col md:col-span-5 md:col-start-1 md:row-start-1">
                <EventCard
                  event={a}
                  layout="text-only"
                  size="lead"
                  showDek
                  showKicker={false}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Right rail — events scoped to this neighborhood. */}
        <aside className="lg:col-span-3 lg:border-l lg:border-foreground/15 lg:pl-6">
          <SectionHeaderCell
            title={t("rail.popularIn").replace("{name}", name)}
            accent={NEIGHBORHOOD_ACCENT}
          />
          <div className="flex flex-col divide-y divide-foreground/15">
            {events.length === 0 ? (
              <p className="meta py-6 text-xs">
                No upcoming events in {name}.
              </p>
            ) : (
              events.map((e) => (
                <div key={e._id} className="py-4 first:pt-5 last:pb-0">
                  <EventListItem event={e} />
                </div>
              ))
            )}
          </div>
        </aside>
      </section>

      <BannerAd slot={`neighborhood-${slug}-mid`} className={BLOCK} />

      {/* ════════════════════ More upcoming events ════════════════════ */}
      {morelead ? (
        <section className={BLOCK}>
          <SectionHeaderCell
            title={t("home.moreTopStories")}
            accent={NEIGHBORHOOD_ACCENT}
            className="mb-6"
          />
          <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-12 lg:divide-x lg:divide-foreground/15">
            <div className="lg:col-span-9 lg:pr-6">
              <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-12">
                {morelead.heroImage ? (
                  <Link
                    to="/event/$slug"
                    params={{ slug: morelead.slug }}
                    onClick={(e) => openInDrawer(morelead.slug, e)}
                    className="group/more block self-start [contain:paint] md:col-span-7 md:col-start-6"
                  >
                    <HeroImg
                      url={morelead.heroImage}
                      width={1000}
                      className="aspect-[3/2] w-full object-cover transition-transform duration-200 ease-out group-hover/more:scale-[1.015]"
                    />
                    {tr(morelead).heroCaption ? (
                      <figcaption className="meta mt-2">
                        {tr(morelead).heroCaption}
                      </figcaption>
                    ) : null}
                  </Link>
                ) : null}
                <div className="flex flex-col md:col-span-5 md:col-start-1 md:row-start-1">
                  <EventCard
                    event={morelead}
                    layout="text-only"
                    size="lead"
                    showDek
                    showKicker={false}
                  />
                </div>
              </div>
            </div>
            <div className="flex flex-col divide-y divide-foreground/15 lg:col-span-3 lg:pl-6">
              {moreRail.map((a, i) => (
                <div
                  key={a._id}
                  className={
                    i === 0
                      ? "pb-4"
                      : i === moreRail.length - 1
                        ? "pt-4"
                        : "py-4"
                  }
                >
                  <EventCard
                    event={a}
                    layout="text-only"
                    size="compact"
                    showKicker={false}
                  />
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}


      {/* ════════════════════ Long-tail grid ════════════════════
          No cell borders — just gap-separated image-top cards. */}
      {longTail.length > 0 ? (
        <section className={BLOCK}>
          <SectionHeaderCell
            title={`More from ${name}`}
            accent={NEIGHBORHOOD_ACCENT}
            className="mb-6"
          />
          <div className="grid gap-x-6 gap-y-10 md:grid-cols-2 lg:grid-cols-3">
            {longTail.map((event) => (
              <EventCard
                key={event._id}
                event={event}
                layout="image-top"
                size="compact"
                imageAspect="16/9"
                showDek={false}
                showKicker={false}
              />
            ))}
          </div>
        </section>
      ) : null}

      <BannerAd slot={`neighborhood-${slug}-bottom`} className={BLOCK} />
    </div>
  )
}

function NeighborhoodMonthView({ slug }: { slug: string }) {
  const search = Route.useSearch() as { month?: string }
  const now = new Date()
  const yearMonth =
    search.month ??
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  const { data: monthEvents } = useSuspenseQuery(
    convexSuspenseQuery(api.events.inMonth, {
      yearMonth,
      neighborhoodSlug: slug,
    }),
  )
  return <CalendarMonth events={monthEvents} yearMonth={yearMonth} />
}

function NeighborhoodMapView({ slug }: { slug: string }) {
  const { data: mapEvents } = useSuspenseQuery(
    convexSuspenseQuery(api.events.placedOnMap, { neighborhoodSlug: slug }),
  )
  return <EventsMap events={mapEvents} />
}
