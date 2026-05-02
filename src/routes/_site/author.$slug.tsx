import { convexQuery } from "@convex-dev/react-query"
import { useSuspenseQuery } from "@tanstack/react-query"
import { Link, createFileRoute, notFound } from "@tanstack/react-router"

import { api } from "../../../convex/_generated/api"
import { AuthorCard } from "@/components/editorial/author-card"
import { BlockSeparator } from "@/components/editorial/block-separator"
import { HeroSplit } from "@/components/editorial/hero-split"
import { MostReadStrip } from "@/components/editorial/most-read-strip"
import { PageHeader } from "@/components/editorial/page-header"
import { SectionHeaderCell } from "@/components/editorial/section-header-cell"
import { SidebarRail } from "@/components/editorial/sidebar-rail"
import { StoryItem } from "@/components/editorial/story-item"
import { XlRowList } from "@/components/editorial/xl-row-list"
import { convexSuspenseQuery } from "@/lib/convex-suspense"

export const Route = createFileRoute("/_site/author/$slug")({
  loader: async ({ context, params }) => {
    const author = await context.queryClient.ensureQueryData(
      convexQuery(api.authors.getBySlug, { slug: params.slug }),
    )
    if (!author) throw notFound()
    await context.queryClient.ensureQueryData(
      convexQuery(api.articles.listByAuthor, {
        authorSlug: params.slug,
        paginationOpts: { numItems: 24, cursor: null },
      }),
    )
    return { author }
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.author
          ? `${loaderData.author.name} · miami.community`
          : "miami.community",
      },
    ],
  }),
  component: AuthorPage,
})

function AuthorPage() {
  const { slug } = Route.useParams()
  const { author } = Route.useLoaderData()
  const { data } = useSuspenseQuery(
    convexSuspenseQuery(api.articles.listByAuthor, {
      authorSlug: slug,
      paginationOpts: { numItems: 24, cursor: null },
    }),
  )

  const articles = data.page
  const lead = articles[0]
  const subleads = articles.slice(1, 3)
  const xlRows = articles.slice(3, 8)
  const longTail = articles.slice(8)

  return (
    <div className="space-y-10">
      <PageHeader
        kicker={author.title ?? "Reporter"}
        title={author.name}
        dek={author.bio}
        right={
          <span className="meta tabular-nums">
            {articles.length} {articles.length === 1 ? "story" : "stories"}
          </span>
        }
      />

      {articles.length === 0 ? (
        <div className="font-editorial mt-12 text-lg text-muted-foreground">
          <p>No published bylines yet.</p>
          <p className="mt-4 text-base">
            <Link to="/" className="underline">
              Back to the front page
            </Link>
          </p>
        </div>
      ) : (
        <section className="grid grid-cols-1 gap-y-8 lg:grid-cols-12 lg:gap-x-6">
          <div className="lg:col-span-9">
            {lead ? <HeroSplit lead={lead} subleads={subleads} /> : null}
            {xlRows.length > 0 ? (
              <BlockSeparator className="mt-2">
                <XlRowList articles={xlRows} />
              </BlockSeparator>
            ) : null}
          </div>

          <SidebarRail className="lg:col-span-3">
            <section>
              <SectionHeaderCell title="About" className="mb-4" />
              <AuthorCard author={author} />
            </section>
            <MostReadStrip
              label={`Most Read by ${author.name.split(" ")[0]}`}
              articles={articles}
            />
          </SidebarRail>
        </section>
      )}

      {longTail.length > 0 ? (
        <section className="pt-10">
          <SectionHeaderCell
            title={`More by ${author.name}`}
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
