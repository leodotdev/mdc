import { convexQuery } from "@convex-dev/react-query"
import { useSuspenseQuery } from "@tanstack/react-query"
import { Link, createFileRoute  } from "@tanstack/react-router"


import { api } from "../../../convex/_generated/api"
import { TrendingStrip } from "@/components/editorial/trending-strip"
import { SectionHeaderCell } from "@/components/editorial/section-header-cell"
import { StoryItem } from "@/components/editorial/story-item"
import { EventListItem } from "@/components/events/event-list-item"
import { HeroImg } from "@/components/site/hero-img"
import { PhotoOfDayWidget } from "@/components/widgets/photo-of-day-widget"
import { RadarWidget } from "@/components/widgets/radar-widget"
import {
  AnimalFactWidget,
  FunFactWidget,
  LandmarkWidget,
  OnThisDayWidget,
  QuoteWidget,
} from "@/components/widgets/rail-widgets"
import { SportsWidget } from "@/components/widgets/sports-widget"
import { WeatherWidget } from "@/components/widgets/weather-widget"
import { convexSuspenseQuery } from "@/lib/convex-suspense"
import { useTranslation } from "@/lib/i18n/context"
import { localizeSectionName } from "@/lib/i18n/sections"
import { useOpenEventDrawer } from "@/lib/use-open-article-drawer"
import { proxiedImageSrcSet } from "@/lib/image-proxy"
import { BannerAd } from "@/components/site/banner-ad"

// `sizes` for the homepage lead image — must match the rendered slot
// (cols 6-12 of a 12-col grid inside `container-page`'s breakpoint
// caps). Used by both the rendered <HeroImg> default override and the
// `<link rel="preload">` injected into the document head so the
// browser starts pulling the LCP image as the HTML streams.
const LEAD_HERO_SIZES =
  "(min-width: 1280px) 753px, (min-width: 1024px) 597px, (min-width: 768px) 443px, 100vw"

export const Route = createFileRoute("/_site/")({
  loader: async ({ context }) => {
    const [top, latest] = await Promise.all([
      context.queryClient.ensureQueryData(
        convexQuery(api.events.topToday, { limit: 8 }),
      ),
      context.queryClient.ensureQueryData(
        convexQuery(api.events.latestEditorial, { limit: 40 }),
      ),
      context.queryClient.ensureQueryData(convexQuery(api.sections.list, {})),
      context.queryClient.ensureQueryData(
        convexQuery(api.events.upcoming, { limit: 5, days: 14 }),
      ),
    ])
    // The lead image is the LCP candidate — top event preferred, latest
    // event as fallback. Returned so the route's `head` function can
    // emit a `<link rel="preload">` for it.
    const leadHeroUrl = top?.[0]?.heroImage ?? latest?.[0]?.heroImage
    return { leadHeroUrl }
  },
  head: ({ loaderData }) => {
    const url = loaderData?.leadHeroUrl
    const srcSet = url ? proxiedImageSrcSet(url) : undefined
    return {
      links: srcSet
        ? [
            {
              rel: "preload",
              as: "image",
              imageSrcSet: srcSet,
              imageSizes: LEAD_HERO_SIZES,
              fetchPriority: "high",
            },
          ]
        : [],
    }
  },
  component: HomePage,
})

// Vertical spacing between major page blocks. We dropped the heavy
// `border-t border-foreground` rule because each block now opens with a
// SectionHeaderCell (3px accent rule + kicker), and stacking the dark
// hairline above the colored rule reads as a double divider. Spacing
// alone is enough — the section header itself separates blocks.
const BLOCK = "pt-10"

// Heavy rule between consecutive "tables" inside the top hero column —
// equivalent to WaPo's grid-horizontal-divider-bold.
const HEAVY = "border-t border-foreground"

function HomePage() {
  const { t, lang } = useTranslation()
  const openInDrawer = useOpenEventDrawer()
  // Lift heroCaption + title localization once per render so the raw
  // <img> / Link blocks below can read the right-language caption
  // without re-running the helper at each call site. Image src and
  // event slug stay on the canonical (EN) record — those are URL
  // fields that don't translate.
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
  const { data: top } = useSuspenseQuery(
    convexSuspenseQuery(api.events.topToday, { limit: 8 }),
  )
  const { data: latest } = useSuspenseQuery(
    convexSuspenseQuery(api.events.latestEditorial, { limit: 40 }),
  )
  const { data: sections } = useSuspenseQuery(
    convexSuspenseQuery(api.sections.list, {}),
  )
  const { data: upcomingEvents } = useSuspenseQuery(
    convexSuspenseQuery(api.events.upcoming, { limit: 5, days: 14 }),
  )

  if (latest.length === 0) {
    return (
      <div className="mx-auto max-w-2xl py-16 text-center">
        <h1 className="display-lg">{t("home.empty.title")}</h1>
        <p className="font-editorial mt-4 text-lg text-muted-foreground">
          {t("home.empty.body")}
        </p>
      </div>
    )
  }

  const used = new Set<string>()
  const take = (
    pool: Array<(typeof latest)[number]>,
    n: number,
  ): Array<(typeof latest)[number]> => {
    const picked: Array<(typeof latest)[number]> = []
    for (const a of pool) {
      if (used.has(a._id)) continue
      picked.push(a)
      used.add(a._id)
      if (picked.length >= n) break
    }
    return picked
  }

  const rankedPool = top.length > 0 ? top : latest
  const allPool = [...rankedPool, ...latest]

  // Top hero (mirrors WaPo hp-top-table-main):
  // • Lead split — 1 article with image + dek; 2 text-only headlines
  //   stacked under the lead's text column (sharing the row with the image).
  // • Followed by 5 wide "xl" rows where text sits left, image sits right —
  //   one article per row, with a heavy rule between rows.
  const lead = take(rankedPool, 1)[0]
  const leadStack = take(allPool, 2)
  const xlRows = take(allPool, 5)

  // More Top Stories (mirrors WaPo's second hero block):
  // • Lead xl on the left.
  // • 4 text-only headlines stacked on the right.
  const morelead = take(allPool, 1)[0]
  const moreRail = take(allPool, 4)

  const trending = rankedPool.slice(0, 4)

  const railsBySection = new Map<string, typeof latest>()
  for (const article of latest) {
    if (used.has(article._id)) continue
    if (!article.section) continue
    const list = railsBySection.get(article.section.slug) ?? []
    list.push(article)
    railsBySection.set(article.section.slug, list)
  }

  return (
    <div className="flex flex-col gap-10">
      {/* ════════════════════ TOP HERO TABLE ════════════════════
          Mirrors WaPo's hp-top-table-main: an 8/4 split where the main
          column stacks several "tables" (split lead + xl rows) and the
          right rail hosts events for the full vertical span. */}
      <section className="grid grid-cols-1 gap-y-8 lg:grid-cols-12 lg:gap-x-6">
        {/* MAIN COLUMN — 8 of 12 */}
        <div className="flex flex-col lg:col-span-9">
          {/* TABLE 1 — split lead: image (right) + text col with stacked
              text-only headlines (left). On mobile, image stacks first. */}
          {lead ? (
            <div className="grid grid-cols-1 gap-x-6 gap-y-6 pb-8 md:grid-cols-12">
              {/* Image col — appears first on mobile, lives in cols 6-12 on desktop */}
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
                    sizes={LEAD_HERO_SIZES}
                    className="aspect-[3/2] w-full object-cover transition-transform duration-200 ease-out group-hover/lead:scale-[1.015]"
                  />
                  {tr(lead).heroCaption ? (
                    <figcaption className="meta mt-2">
                      {tr(lead).heroCaption}
                    </figcaption>
                  ) : null}
                </Link>
              ) : null}
              {/* Text col — lead with kicker/headline/dek + 2 text-only stacked */}
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

          {/* TABLES 2..N — wide xl rows: text 5 cols (left) + image 7 cols (right).
              Each row is its own table separated by a heavy rule. */}
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

        {/* RIGHT RAIL — 3 of 12. Stacks all sidebar widgets vertically so
            the rail extends past the hero's main column when the LLM-fed
            widgets are populated. Order: weather, sports, events, then
            the daily-rotating LLM widgets — first the date-specific
            "On this day" up top, followed by the rotation set. */}
        <aside className="flex flex-col gap-8 lg:col-span-3 lg:border-l lg:border-foreground/15 lg:pl-6">
          <WeatherWidget />
          <RadarWidget />
          <SportsWidget />
          <div>
            <SectionHeaderCell
              title={t("nav.events")}
            />
            <div className="flex flex-col divide-y divide-foreground/15">
              {upcomingEvents.length === 0 ? (
                <p className="meta py-6 text-xs">{t("home.empty.calendar")}</p>
              ) : (
                upcomingEvents.map((e) => (
                  <div key={e._id} className="py-4 first:pt-5 last:pb-0">
                    <EventListItem event={e} />
                  </div>
                ))
              )}
            </div>
          </div>
          <OnThisDayWidget />
          <PhotoOfDayWidget />
          <LandmarkWidget />
          <AnimalFactWidget />
          <FunFactWidget />
          <QuoteWidget />
        </aside>
      </section>

      <BannerAd slot="home-mid" className={BLOCK} />

      {/* ════════════════════ More Top Stories ════════════════════
          Mirrors WaPo's second hero chain: lead xl on the left + 4 text-only
          headlines stacked on the right with a vertical hairline between. */}
      {morelead ? (
        <section className={BLOCK}>
          <SectionHeaderCell
            title={t("home.moreTopStories")}
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
            label={t("home.trending")}
            articles={trending}
          />
        </section>
      ) : null}

      {/* ════════════════════ Per-section blocks ════════════════════
          Mirrors WaPo's "double-wide-layout": image+headline feature on the
          left half, four text-only headlines stacked on the right half with
          a vertical hairline between. Section header banner sits on top. */}
      {sections.map((section) => {
        const items = railsBySection.get(section.slug) ?? []
        if (items.length < 2) return null
        const [feature, ...rest] = items.slice(0, 5)
        return (
          <section key={section._id} className={BLOCK}>
            <SectionHeaderCell
              title={localizeSectionName(section, lang)}
              accent={section.accentColor}
              moreHref="/section/$slug"
              moreParams={{ slug: section.slug }}
              className="mb-6"
            />
            <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-12 lg:divide-x lg:divide-foreground/15">
              <div className="lg:col-span-6 lg:pr-6">
                <StoryItem
                  article={feature}
                  layout="image-top"
                  size="lead"
                  showDek
                />
              </div>
              <div className="flex flex-col divide-y divide-foreground/15 lg:col-span-6 lg:pl-6">
                {rest.map((a, i) => (
                  <div
                    key={a._id}
                    className={
                      i === 0
                        ? "pb-4"
                        : i === rest.length - 1
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
        )
      })}

      <BannerAd slot="home-bottom" className={BLOCK} />
    </div>
  )
}
