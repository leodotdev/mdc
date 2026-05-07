import { convexQuery } from "@convex-dev/react-query"
import { useSuspenseQuery } from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"
import type { FunctionReturnType } from "convex/server"
import { Play } from "lucide-react"

import { api } from "../../../convex/_generated/api"
import { PageHeader } from "@/components/editorial/page-header"
import { SectionBadge } from "@/components/editorial/section-badge"
import { HeroImg } from "@/components/site/hero-img"
import { convexSuspenseQuery } from "@/lib/convex-suspense"
import { relativeTime } from "@/lib/dates"
import { useOpenArticleDrawer } from "@/lib/use-open-article-drawer"

// /watch — first-class video listing. Same pattern as /events: one
// route, scoped query, grid layout, every card opens the drawer or
// the dedicated article route. Pulls articles where mediaType="video"
// (auto-detected at insert time when a citation is YouTube/Vimeo).
//
// Filters by `?section=<slug>` when present, otherwise shows every
// video. The section filter mirrors the events page's section chip
// pattern; for now keep it URL-driven without UI affordance — that
// can come once we know which sections actually accumulate videos.

type WatchSearch = { section?: string }

export const Route = createFileRoute("/_site/watch")({
  validateSearch: (search: Record<string, unknown>): WatchSearch => ({
    section:
      typeof search.section === "string" && /^[a-z0-9-]+$/.test(search.section)
        ? search.section
        : undefined,
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(
      convexQuery(api.articles.recentVideos, { limit: 60 }),
    )
  },
  head: () => ({
    meta: [{ title: "Watch · miami.community" }],
  }),
  component: WatchPage,
})

function WatchPage() {
  const { section } = Route.useSearch()
  const { data: videos } = useSuspenseQuery(
    convexSuspenseQuery(api.articles.recentVideos, {
      limit: 60,
      sectionSlug: section,
    }),
  )
  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title="Watch"
        dek="Video stories from Miami's local outlets — pulled from YouTube channels, segments, and clips that publishers post throughout the day."
      />

      {videos.length === 0 ? (
        <p className="font-editorial mt-12 max-w-2xl text-lg text-muted-foreground">
          No video stories yet. The desk drafts video stories whenever a
          local outlet posts a clip — check back in a few hours.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-x-6 gap-y-10 md:grid-cols-2 lg:grid-cols-3">
          {videos.map((v) => (
            <VideoCard key={v._id} article={v} />
          ))}
        </div>
      )}
    </div>
  )
}

type VideoArticle = FunctionReturnType<typeof api.articles.recentVideos>[number]

function VideoCard({ article: a }: { article: VideoArticle }) {
  const openInDrawer = useOpenArticleDrawer()
  const link = {
    to: "/article/$slug" as const,
    params: { slug: a.slug },
    onClick: (e: React.MouseEvent) => openInDrawer(a.slug, e),
  }
  return (
    <article className="group/video flex flex-col gap-3">
      <Link {...link} className="relative block aspect-video w-full">
        {/* Thumbnail layer */}
        <HeroImg
          url={
            a.heroImage ??
            (a.videoEmbed?.provider === "youtube"
              ? `https://i.ytimg.com/vi/${a.videoEmbed.id}/hqdefault.jpg`
              : undefined)
          }
          className="h-full w-full object-cover"
        />
        {/* Play overlay — soft tint + centered glyph. Hover scales it
            slightly so the card feels actionable. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20 transition-opacity group-hover/video:bg-black/30">
          <span className="grid size-12 place-items-center rounded-full bg-white/90 text-black transition-transform group-hover/video:scale-110">
            <Play className="size-5 fill-current" aria-hidden />
          </span>
        </div>
      </Link>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <SectionBadge section={a.section} size="sm" />
          {a.publishedAt ? (
            <span className="kicker text-muted-foreground text-xs">
              {relativeTime(a.publishedAt)}
            </span>
          ) : null}
        </div>
        <Link {...link}>
          <h3 className="font-heading text-lg leading-tight font-semibold tracking-tight transition-colors group-hover/video:text-primary">
            {a.title}
          </h3>
        </Link>
      </div>
    </article>
  )
}
