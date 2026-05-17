import { convexQuery } from "@convex-dev/react-query"
import { useSuspenseQuery } from "@tanstack/react-query"
import {
  Link,
  createFileRoute,
  notFound,
  redirect,
} from "@tanstack/react-router"

import { api } from "../../../convex/_generated/api"
import { PageHeader } from "@/components/editorial/page-header"
import { TrendingInline } from "@/components/editorial/trending-inline"
import { TrendingStrip } from "@/components/editorial/trending-strip"
import { SectionHeaderCell } from "@/components/editorial/section-header-cell"
import { StoryItem } from "@/components/editorial/story-item"
import { EventListItem } from "@/components/events/event-list-item"
import { BannerAd } from "@/components/site/banner-ad"
import { HeroImg } from "@/components/site/hero-img"
import { TeamWidgets } from "@/components/widgets/sports-widget"
import { convexSuspenseQuery } from "@/lib/convex-suspense"
import { useTranslation } from "@/lib/i18n/context"
import { useOpenEventDrawer } from "@/lib/use-open-article-drawer"
import { localizeSectionName } from "@/lib/i18n/sections"
import { useViewMode } from "@/lib/view-mode"
import { EventListView } from "@/components/editorial/event-list-view"
import { CalendarMonth } from "@/components/editorial/calendar-month"
import { EventsMap } from "@/components/editorial/events-map"

// Vertical spacing between major page blocks. Mirrors the homepage's
// `BLOCK` rhythm so the two pages read as one paper.
const BLOCK = "pt-10"
// Heavy rule between consecutive xl rows in the top hero stack.
const HEAVY = "border-t border-foreground"

export const Route = createFileRoute("/_site/section/$slug")({
  loader: async ({ context, params }) => {
    // Legacy /section/things-to-do URLs land on the homepage now — the
    // events-only pivot turned the homepage into the events feed and
    // there's no separate "things to do" section anymore.
    if (params.slug === "things-to-do") {
      throw redirect({ to: "/" })
    }
    const section = await context.queryClient.ensureQueryData(
      convexQuery(api.sections.getBySlug, { slug: params.slug }),
    )
    if (!section) throw notFound()
    await Promise.all([
      context.queryClient.ensureQueryData(
        convexQuery(api.events.topInSection, {
          sectionSlug: params.slug,
          limit: 8,
        }),
      ),
      context.queryClient.ensureQueryData(
        convexQuery(api.events.listBySection, {
          sectionSlug: params.slug,
          paginationOpts: { numItems: 40, cursor: null },
        }),
      ),
      context.queryClient.ensureQueryData(
        convexQuery(api.sections.list, {}),
      ),
      context.queryClient.ensureQueryData(
        convexQuery(api.events.upcomingBySectionSlug, {
          sectionSlug: params.slug,
          limit: 5,
        }),
      ),
    ])
    return { section }
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.section
          ? `${loaderData.section.name} · miami.community`
          : "miami.community",
      },
    ],
  }),
  component: SectionPage,
})

function SectionPage() {
  const { slug } = Route.useParams()
  const { section } = Route.useLoaderData()
  const { lang, t } = useTranslation()
  const { mode } = useViewMode()
  const openInDrawer = useOpenEventDrawer()

  // Pull localized title/heroCaption alongside the canonical record so
  // img/Link blocks stay simple. Mirrors the homepage helper.
  const tr = (e: {
    heroCaption?: string
    title: string
    translations?: { es?: { title: string; heroCaption?: string } }
  }) =>
    lang === "es"
      ? {
          title: e.translations?.es?.title ?? e.title,
          heroCaption: e.translations?.es?.heroCaption ?? e.heroCaption,
        }
      : { title: e.title, heroCaption: e.heroCaption }

  // Top events ranked by importance — feeds the above-fold hero
  // blocks AND the right rail "Top events" list. Pulling 8 gives the
  // rail 5 + a few extras after dedup with the lead picks.
  const { data: top } = useSuspenseQuery(
    convexSuspenseQuery(api.events.topInSection, {
      sectionSlug: slug,
      limit: 8,
    }),
  )
  // All events for this section, paginated. Long-tail chronological
  // feed beneath the importance-ranked hero blocks.
  const { data: list } = useSuspenseQuery(
    convexSuspenseQuery(api.events.listBySection, {
      sectionSlug: slug,
      paginationOpts: { numItems: 40, cursor: null },
    }),
  )

  const sectionName = localizeSectionName(section, lang)

  if (list.page.length === 0) {
    return (
      <div className="flex flex-col gap-10">
        <PageHeader title={sectionName} ruleBottom={false} className="pb-2" />
        <div className="font-editorial mt-12 max-w-2xl text-lg text-muted-foreground">
          <p>No published events in {sectionName} yet.</p>
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

  // Dedupe across the page so the same story doesn't appear twice in
  // different blocks. Mirrors the homepage `take` pattern exactly.
  const used = new Set<string>()
  const take = (
    pool: Array<(typeof list.page)[number]>,
    n: number,
  ): Array<(typeof list.page)[number]> => {
    const picked: Array<(typeof list.page)[number]> = []
    for (const a of pool) {
      if (used.has(a._id)) continue
      picked.push(a)
      used.add(a._id)
      if (picked.length >= n) break
    }
    return picked
  }

  const rankedPool = top.length > 0 ? top : list.page
  const allPool = [...rankedPool, ...list.page]

  // Top hero (mirrors homepage):
  //   Lead split + 2 stacked text-only + 5 xl rows.
  const lead = take(rankedPool, 1)[0]
  const leadStack = take(allPool, 2)
  const xlRows = take(allPool, 5)

  // More Top Stories block: 1 lead + 4 stacked text-only.
  const morelead = take(allPool, 1)[0]
  const moreRail = take(allPool, 4)

  // Trending uses the same ranked pool; cap to 4 for the strip.
  const trending = rankedPool.slice(0, 4)

  // Long-tail framed grid below — leftovers after every block grabs.
  const longTail = list.page
    .filter((a) => !used.has(a._id as string))
    .slice(0, 9)

  // Alternate view modes — same shape as the homepage. The section
  // page's list-mode header still shows the section name + accent so
  // the reader knows what they're filtered to.
  if (mode === "list") {
    return (
      <div className="flex flex-col gap-10">
        <div className="rule-bottom flex flex-col gap-3 pb-6">
          <PageHeader
            title={sectionName}
            ruleBottom={false}
            className="pb-0"
          />
        </div>
        <EventListView
          events={list.page}
          emptyLabel={`No upcoming events in ${sectionName}.`}
        />
      </div>
    )
  }
  if (mode === "month") {
    return (
      <div className="flex flex-col gap-10">
        <PageHeader title={sectionName} />
        <SectionMonthView slug={slug} />
      </div>
    )
  }
  if (mode === "map") {
    return (
      <div className="flex flex-col gap-10">
        <PageHeader title={sectionName} />
        <SectionMapView slug={slug} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-10">
      {/* Title + inline trending strip read as one block — the
          trending row replaces what used to be the section dek, sits
          centered under the title, and shares its scale. The heavy
          rule lands at the BOTTOM of the combined block (after
          trending), so the page's first horizontal rule echoes the
          masthead nav rule. */}
      <div className="rule-bottom flex flex-col gap-3 pb-6">
        <PageHeader title={sectionName} ruleBottom={false} className="pb-0" />
        <TrendingInline
          articles={top.slice(0, 2)}
          className="justify-center border-0 pb-0"
        />
      </div>

      {/* ════════════════════ TOP HERO TABLE ════════════════════
          Same 9/3 split as the homepage, scoped to this section. */}
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
                  <StoryItem
                    article={lead}
                    layout="text-only"
                    size="lead"
                    showDek

                  />
                </div>
                {leadStack[0] ? (
                  <div className="py-5">
                    <StoryItem
                      article={leadStack[0]}
                      layout="text-only"
                      size="compact"
  
                    />
                  </div>
                ) : null}
                {leadStack[1] ? (
                  <div className="pt-5">
                    <StoryItem
                      article={leadStack[1]}
                      layout="text-only"
                      size="compact"
  
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
                <StoryItem
                  article={a}
                  layout="text-only"
                  size="lead"
                  showDek

                />
              </div>
            </div>
          ))}
        </div>

        {/* Right rail — Top Events for this section (importance-ranked,
            5 max). Mirrors the homepage's "Top events" treatment but
            scoped. The Sports widget is hoisted into this rail on the
            sports section so every franchise's latest result lives next
            to the section's coverage. */}
        <aside className="flex flex-col gap-8 lg:col-span-3 lg:border-l lg:border-foreground/15 lg:pl-6">
          {slug === "sports" ? <TeamWidgets /> : null}
          <div>
            <SectionHeaderCell
              title="Top events"
              accent={section.accentColor}
            />
            <div className="flex flex-col divide-y divide-foreground/15">
              {top.length === 0 ? (
                <p className="meta py-6 text-xs">
                  No upcoming events in {sectionName}.
                </p>
              ) : (
                top.slice(0, 5).map((e) => (
                  <div key={e._id} className="py-4 first:pt-5 last:pb-0">
                    <EventListItem event={e} />
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </section>

      <BannerAd slot={`section-${slug}-mid`} className={BLOCK} />

      {/* ════════════════════ More Top Stories ════════════════════ */}
      {morelead ? (
        <section className={BLOCK}>
          <SectionHeaderCell
            title={t("home.moreTopStories")}
            accent={section.accentColor}
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
                  <StoryItem
                    article={morelead}
                    layout="text-only"
                    size="lead"
                    showDek

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
                  <StoryItem
                    article={a}
                    layout="text-only"
                    size="compact"

                  />
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* ════════════════════ Trending ════════════════════ */}
      {trending.length > 0 ? (
        <section className={BLOCK}>
          <TrendingStrip
            label={`${t("home.trending")} · ${sectionName}`}
            articles={trending}
          />
        </section>
      ) : null}

      {/* ════════════════════ Long-tail grid ════════════════════
          No cell borders — just an auto-fit grid with comfortable
          gaps between cards. The SectionHeaderCell rule above is
          enough visual structure for this block. */}
      {longTail.length > 0 ? (
        <section className={BLOCK}>
          <SectionHeaderCell
            title={`More from ${sectionName}`}
            accent={section.accentColor}
            className="mb-6"
          />
          <div className="grid gap-x-6 gap-y-10 md:grid-cols-2 lg:grid-cols-3">
            {longTail.map((article) => (
              <StoryItem
                key={article._id}
                article={article}
                layout="image-top"
                size="compact"
                imageAspect="16/9"
                showDek={false}
              />
            ))}
          </div>
        </section>
      ) : null}

      <BannerAd slot={`section-${slug}-bottom`} className={BLOCK} />
    </div>
  )
}

// Section-scoped month view. Same shape as HomepageMonthView but
// passes the section slug down so inMonth applies the section's
// children + cross-listed + associated-tag enrichment.
function SectionMonthView({ slug }: { slug: string }) {
  const search = Route.useSearch() as { month?: string }
  const now = new Date()
  const yearMonth =
    search.month ??
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  const { data: monthEvents } = useSuspenseQuery(
    convexSuspenseQuery(api.events.inMonth, {
      yearMonth,
      sectionSlug: slug,
    }),
  )
  return <CalendarMonth events={monthEvents} yearMonth={yearMonth} />
}

function SectionMapView({ slug }: { slug: string }) {
  const { data: mapEvents } = useSuspenseQuery(
    convexSuspenseQuery(api.events.placedOnMap, { sectionSlug: slug }),
  )
  return <EventsMap events={mapEvents} />
}
