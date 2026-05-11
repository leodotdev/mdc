import { convexQuery } from "@convex-dev/react-query"
import { useSuspenseQuery } from "@tanstack/react-query"
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import type { FunctionReturnType } from "convex/server"
import { Play } from "lucide-react"
import { useEffect, useMemo, useRef } from "react"

import { api } from "../../../convex/_generated/api"
import { PageHeader } from "@/components/editorial/page-header"
import { SectionBadge } from "@/components/editorial/section-badge"
import { HeroImg } from "@/components/site/hero-img"
import { convexSuspenseQuery } from "@/lib/convex-suspense"
import { relativeTime } from "@/lib/dates"

// /watch — playlist-style video page. Big embedded player on the left,
// scrollable Up-next queue on the right (stacked on mobile). URL state
// ?v=<slug> picks the active video; default is the freshest one. When
// a YouTube clip ends we auto-advance to the next item in the queue via
// the IFrame Player API (postMessage). Autoplay is muted by browser
// policy so the lean-back flow works without an unmute gesture — the
// user clicks the player to unmute if they want sound.

type WatchSearch = { section?: string; v?: string }

export const Route = createFileRoute("/_site/watch")({
  validateSearch: (search: Record<string, unknown>): WatchSearch => ({
    section:
      typeof search.section === "string" && /^[a-z0-9-]+$/.test(search.section)
        ? search.section
        : undefined,
    v:
      typeof search.v === "string" && /^[a-z0-9-]+$/.test(search.v)
        ? search.v
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

type VideoArticle = FunctionReturnType<typeof api.articles.recentVideos>[number]

function embedSrc(article: VideoArticle): string | null {
  const ve = article.videoEmbed
  if (!ve) return null
  if (ve.provider === "youtube") {
    const origin =
      typeof window !== "undefined" ? window.location.origin : ""
    const params = new URLSearchParams({
      autoplay: "1",
      mute: "1",
      enablejsapi: "1",
      rel: "0",
      modestbranding: "1",
      playsinline: "1",
    })
    if (origin) params.set("origin", origin)
    return `https://www.youtube.com/embed/${ve.id}?${params}`
  }
  return `https://player.vimeo.com/video/${ve.id}?autoplay=1&muted=1`
}

function WatchPage() {
  const { section, v } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { data: videos } = useSuspenseQuery(
    convexSuspenseQuery(api.articles.recentVideos, {
      limit: 60,
      sectionSlug: section,
    }),
  )

  const selectedIdx = useMemo(() => {
    if (!v) return 0
    const i = videos.findIndex((x) => x.slug === v)
    return i >= 0 ? i : 0
  }, [v, videos])

  const current: VideoArticle | undefined = videos[selectedIdx]

  const selectByIdx = (i: number) => {
    const next = videos[i]
    if (!next) return
    navigate({
      search: (prev: WatchSearch) => ({ ...prev, v: next.slug }),
    })
    // Bring the player back into view on mobile after picking from the queue.
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" })
    }
  }

  const advance = () => {
    if (selectedIdx + 1 < videos.length) selectByIdx(selectedIdx + 1)
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Watch"
        dek="Video stories from Miami's local outlets — pulled from YouTube channels, segments, and clips that publishers post throughout the day. Plays through like a playlist."
      />

      {videos.length === 0 || !current ? (
        <p className="font-editorial mt-12 max-w-2xl text-lg text-muted-foreground">
          No video stories yet. The desk drafts video stories whenever a
          local outlet posts a clip — check back in a few hours.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <PlayerColumn article={current} onEnded={advance} />
          <QueueColumn
            videos={videos}
            selectedIdx={selectedIdx}
            onSelect={selectByIdx}
          />
        </div>
      )}
    </div>
  )
}

function PlayerColumn({
  article,
  onEnded,
}: {
  article: VideoArticle
  onEnded: () => void
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const onEndedRef = useRef(onEnded)
  useEffect(() => {
    onEndedRef.current = onEnded
  }, [onEnded])

  // Wire up the YouTube IFrame Player API via postMessage. The player
  // only emits state-change events to a parent that has explicitly
  // subscribed, so we send a `listening` + `addEventListener` pair
  // after each iframe loads. When playerState === 0 the clip ended,
  // and we advance to the next item in the queue.
  useEffect(() => {
    if (article.videoEmbed?.provider !== "youtube") return
    const iframe = iframeRef.current
    if (!iframe) return

    function handleMessage(e: MessageEvent) {
      if (e.source !== iframe?.contentWindow) return
      if (typeof e.data !== "string") return
      let data: { event?: string; info?: unknown }
      try {
        data = JSON.parse(e.data) as { event?: string; info?: unknown }
      } catch {
        return
      }
      const ended =
        (data.event === "onStateChange" && data.info === 0) ||
        (data.event === "infoDelivery" &&
          typeof data.info === "object" &&
          data.info !== null &&
          (data.info as { playerState?: number }).playerState === 0)
      if (ended) onEndedRef.current()
    }

    function subscribe() {
      iframe?.contentWindow?.postMessage(
        JSON.stringify({ event: "listening", id: 1, channel: "watch" }),
        "*",
      )
      iframe?.contentWindow?.postMessage(
        JSON.stringify({
          event: "command",
          func: "addEventListener",
          args: ["onStateChange"],
          id: 1,
          channel: "watch",
        }),
        "*",
      )
    }

    window.addEventListener("message", handleMessage)
    iframe.addEventListener("load", subscribe)
    // The iframe may already be loaded by the time this effect runs
    // (route swap, fast network) — try subscribing once after a beat.
    const t = setTimeout(subscribe, 800)

    return () => {
      window.removeEventListener("message", handleMessage)
      iframe.removeEventListener("load", subscribe)
      clearTimeout(t)
    }
  }, [article._id, article.videoEmbed?.provider])

  const src = embedSrc(article)

  return (
    <div className="flex flex-col gap-4">
      <div className="relative aspect-video w-full overflow-hidden rounded-md bg-black">
        {src ? (
          <iframe
            ref={iframeRef}
            key={article._id}
            src={src}
            title={article.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="absolute inset-0 h-full w-full"
          />
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <SectionBadge section={article.section} size="sm" />
          {article.publishedAt ? (
            <span className="kicker text-muted-foreground text-xs">
              {relativeTime(article.publishedAt)}
            </span>
          ) : null}
        </div>
        <h1 className="font-heading text-2xl leading-tight font-semibold tracking-tight md:text-3xl">
          <Link
            to="/article/$slug"
            params={{ slug: article.slug }}
            className="transition-colors hover:text-primary"
          >
            {article.title}
          </Link>
        </h1>
        {article.dek ? (
          <p className="font-editorial mt-1 max-w-3xl text-base leading-snug text-muted-foreground">
            {article.dek}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function QueueColumn({
  videos,
  selectedIdx,
  onSelect,
}: {
  videos: ReadonlyArray<VideoArticle>
  selectedIdx: number
  onSelect: (i: number) => void
}) {
  return (
    <aside className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="kicker text-xs">Up next</h2>
        <span className="kicker text-muted-foreground text-xs">
          {videos.length} clips
        </span>
      </div>
      <ol className="flex flex-col divide-y divide-border/60 lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto">
        {videos.map((v, i) => (
          <li key={v._id}>
            <QueueItem
              article={v}
              active={i === selectedIdx}
              onSelect={() => onSelect(i)}
            />
          </li>
        ))}
      </ol>
    </aside>
  )
}

function QueueItem({
  article: a,
  active,
  onSelect,
}: {
  article: VideoArticle
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={`group/qitem flex w-full items-start gap-3 py-3 text-left transition-colors ${
        active ? "bg-muted/40" : "hover:bg-muted/30"
      }`}
    >
      <div className="relative aspect-video w-32 flex-shrink-0 overflow-hidden rounded">
        <HeroImg
          url={
            a.heroImage ??
            (a.videoEmbed?.provider === "youtube"
              ? `https://i.ytimg.com/vi/${a.videoEmbed.id}/hqdefault.jpg`
              : undefined)
          }
          className="h-full w-full object-cover"
        />
        {active ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40">
            <span className="grid size-7 place-items-center rounded-full bg-white text-black">
              <Play className="size-3 fill-current" aria-hidden />
            </span>
          </div>
        ) : (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/10 opacity-0 transition-opacity group-hover/qitem:opacity-100">
            <span className="grid size-7 place-items-center rounded-full bg-white/90 text-black">
              <Play className="size-3 fill-current" aria-hidden />
            </span>
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <SectionBadge section={a.section} size="sm" />
          {a.publishedAt ? (
            <span className="kicker text-muted-foreground text-[0.65rem]">
              {relativeTime(a.publishedAt)}
            </span>
          ) : null}
        </div>
        <h3
          className={`font-heading text-sm leading-tight font-semibold tracking-tight ${
            active ? "text-foreground" : "text-foreground/90"
          }`}
        >
          {a.title}
        </h3>
      </div>
    </button>
  )
}
