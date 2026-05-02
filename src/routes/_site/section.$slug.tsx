import { convexQuery } from "@convex-dev/react-query"
import { useSuspenseQuery } from "@tanstack/react-query"
import {
  Link,
  createFileRoute,
  notFound,
  redirect,
} from "@tanstack/react-router"

import { api } from "../../../convex/_generated/api"
import { BlockSeparator } from "@/components/editorial/block-separator"
import { HeroSplit } from "@/components/editorial/hero-split"
import { MostReadStrip } from "@/components/editorial/most-read-strip"
import { PageHeader } from "@/components/editorial/page-header"
import { SectionHeaderCell } from "@/components/editorial/section-header-cell"
import { SidebarRail } from "@/components/editorial/sidebar-rail"
import { StoryItem } from "@/components/editorial/story-item"
import { XlRowList } from "@/components/editorial/xl-row-list"
import { convexSuspenseQuery } from "@/lib/convex-suspense"
import { localizeSectionDescription, localizeSectionName } from "@/lib/i18n/sections"
import { useTranslation } from "@/lib/i18n/context"

export const Route = createFileRoute("/_site/section/$slug")({
  loader: async ({ context, params }) => {
    // Things-to-do is now surfaced as /events (events + stories merged).
    if (params.slug === "things-to-do") {
      throw redirect({ to: "/events" })
    }
    const section = await context.queryClient.ensureQueryData(
      convexQuery(api.sections.getBySlug, { slug: params.slug }),
    )
    if (!section) throw notFound()
    await Promise.all([
      context.queryClient.ensureQueryData(
        convexQuery(api.articles.topInSection, {
          sectionSlug: params.slug,
          limit: 6,
        }),
      ),
      context.queryClient.ensureQueryData(
        convexQuery(api.articles.listBySection, {
          sectionSlug: params.slug,
          paginationOpts: { numItems: 24, cursor: null },
        }),
      ),
      context.queryClient.ensureQueryData(
        convexQuery(api.sections.list, {}),
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
  const { lang } = useTranslation()
  // Top stories ranked by importance (above-fold candidates).
  const { data: top } = useSuspenseQuery(
    convexSuspenseQuery(api.articles.topInSection, {
      sectionSlug: slug,
      limit: 6,
    }),
  )
  // Recent stories paginated (long tail).
  const { data: list } = useSuspenseQuery(
    convexSuspenseQuery(api.articles.listBySection, {
      sectionSlug: slug,
      paginationOpts: { numItems: 24, cursor: null },
    }),
  )
  // Sub-sections for the rail nav (e.g. Music under Arts & Culture).
  const { data: allSections } = useSuspenseQuery(
    convexSuspenseQuery(api.sections.list, {}),
  )
  const subSections = allSections.filter((s) => s.parentId === section._id)

  // Wave 1: hero split (lead + 2 sub-leads). Wave 2: xl rows. Wave 3:
  // long tail in a framed-cell grid for visual variety. Dedupe across
  // waves so no story shows twice.
  const used = new Set<string>()
  const take = (
    pool: Array<(typeof list.page)[number]>,
    n: number,
  ) => {
    const out: Array<(typeof list.page)[number]> = []
    for (const a of pool) {
      if (used.has(a._id as string)) continue
      out.push(a)
      used.add(a._id as string)
      if (out.length >= n) break
    }
    return out
  }

  const rankedPool = top.length > 0 ? top : list.page
  const allPool = [...rankedPool, ...list.page]

  const lead = take(rankedPool, 1)[0]
  const subleads = take(allPool, 2)
  const xlRows = take(allPool, 5)
  const longTail = list.page.filter((a) => !used.has(a._id as string)).slice(0, 9)

  const sectionName = localizeSectionName(section, lang)
  const sectionDescription = localizeSectionDescription(section, lang)

  return (
    <div className="space-y-10">
      <PageHeader
        kicker={sectionName}
        kickerColor={section.accentColor}
        title={sectionName}
        dek={sectionDescription}
        right={
          subSections.length > 0 ? (
            <nav className="flex flex-wrap items-center gap-2">
              {subSections.map((s) => (
                <Link
                  key={s._id}
                  to="/section/$slug"
                  params={{ slug: s.slug }}
                  className="rounded-full border border-foreground/20 px-3 py-1 font-sans text-xs font-bold tracking-[0.12em] uppercase transition-colors hover:bg-muted"
                  style={{ color: s.accentColor }}
                >
                  {localizeSectionName(s, lang)}
                </Link>
              ))}
            </nav>
          ) : null
        }
      />

      {list.page.length === 0 ? (
        <div className="font-editorial mt-12 max-w-2xl text-lg text-muted-foreground">
          <p>No published stories in {sectionName} yet.</p>
          <p className="mt-4 text-base">
            <Link to="/" className="underline">
              Browse the front page
            </Link>{" "}
            or check{" "}
            <Link to="/about" className="underline">
              how the newsroom works
            </Link>
            .
          </p>
        </div>
      ) : (
        <section className="grid grid-cols-1 gap-y-8 lg:grid-cols-12 lg:gap-x-6">
          {/* Main column — 8/12 */}
          <div className="lg:col-span-9">
            {lead ? <HeroSplit lead={lead} subleads={subleads} /> : null}
            {xlRows.length > 0 ? (
              <BlockSeparator
                accent={section.accentColor}
                className="mt-2"
              >
                <XlRowList articles={xlRows} />
              </BlockSeparator>
            ) : null}
          </div>

          {/* Right rail — 4/12. Most read in section + sub-section nav. */}
          <SidebarRail className="lg:col-span-3">
            <MostReadStrip
              label={`Most Read in ${sectionName}`}
              articles={rankedPool}
            />
          </SidebarRail>
        </section>
      )}

      {/* Long-tail framed-cell grid — visual texture below the rail block. */}
      {longTail.length > 0 ? (
        <section className="pt-10">
          <SectionHeaderCell
            title={`More from ${sectionName}`}
            accent={section.accentColor}
            className="mb-6"
          />
          <div className="grid border-t border-l border-foreground md:grid-cols-3">
            {longTail.map((article) => (
              <StoryItem
                key={article._id}
                article={article}
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
    </div>
  )
}
