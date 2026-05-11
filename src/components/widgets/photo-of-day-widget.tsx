import { useQuery } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useState } from "react"

import { SectionHeaderCell } from "@/components/editorial/section-header-cell"
import { HeroImg } from "@/components/site/hero-img"
import { Skeleton } from "@/components/ui/skeleton"

// Wikimedia Commons "Photo of the day" widget — daily-rotating image
// of a Miami subject. Deterministic pick: today's date (Miami-time)
// hashes to an index into the result set, so every user on the same
// day sees the same photo, and the photo changes at Miami-midnight.
//
// Client-side fetch with a 24h staleTime — Wikimedia's Commons API is
// CORS-friendly via origin=*. Zero backend, zero cost.

type CommonsPage = {
  title?: string
  imageinfo?: Array<{
    thumburl?: string
    url?: string
    descriptionurl?: string
    extmetadata?: {
      Artist?: { value?: string }
      ImageDescription?: { value?: string }
    }
  }>
}

type Photo = {
  url: string
  pageUrl?: string
  title: string
  artist?: string
  description?: string
}

// Six rotating queries — each day picks the matching one by day-of-year
// mod count, then picks a photo within that query's result set by
// day-of-year div count. Yields ~25 distinct photos before any repeat.
const QUERIES = [
  "Miami Florida skyline",
  "Miami Beach Art Deco",
  "Wynwood Miami",
  "Vizcaya Museum",
  "Coral Gables Florida",
  "Everglades National Park",
] as const

async function fetchPhotos(query: string): Promise<Array<Photo>> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: `filetype:bitmap ${query}`,
    gsrlimit: "10",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "1200",
  })
  const res = await fetch(
    `https://commons.wikimedia.org/w/api.php?${params}`,
  )
  if (!res.ok) return []
  const json = (await res.json()) as {
    query?: { pages?: Record<string, CommonsPage> }
  }
  const pages = Object.values(json.query?.pages ?? {})
  return pages
    .map((p): Photo | null => {
      const info = p.imageinfo?.[0]
      const url = info?.thumburl ?? info?.url
      if (!url) return null
      const artistRaw = info?.extmetadata?.Artist?.value
      const artist = artistRaw
        ? artistRaw.replace(/<[^>]+>/g, "").trim().slice(0, 80)
        : undefined
      const descRaw = info?.extmetadata?.ImageDescription?.value
      const description = descRaw
        ? descRaw.replace(/<[^>]+>/g, "").trim().slice(0, 160)
        : undefined
      return {
        url,
        pageUrl: info?.descriptionurl,
        title: p.title?.replace(/^File:/, "") ?? "",
        artist,
        description,
      }
    })
    .filter((p): p is Photo => p !== null)
}

// Day-of-year in Miami time. Used to deterministically pick a photo
// that's the same for every viewer on a given day and changes at
// Miami-midnight. Returns 1..366.
function miamiDayOfYear(): number {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const [y, m, d] = fmt.format(new Date()).split("-").map(Number)
  const start = Date.UTC(y, 0, 1)
  const today = Date.UTC(y, m - 1, d)
  return Math.floor((today - start) / 86_400_000) + 1
}

// Fetch every query bucket in parallel and concatenate. Yields ~60
// distinct photos (6 queries × 10) for the user to walk through with
// chevrons. Deduped by image URL.
async function fetchAllPhotos(): Promise<Array<Photo>> {
  const buckets = await Promise.all(QUERIES.map((q) => fetchPhotos(q)))
  const seen = new Set<string>()
  const all: Array<Photo> = []
  for (const bucket of buckets) {
    for (const p of bucket) {
      if (seen.has(p.url)) continue
      seen.add(p.url)
      all.push(p)
    }
  }
  return all
}

export function PhotoOfDayWidget() {
  const dayOfYear = miamiDayOfYear()

  const { data: photos } = useQuery({
    queryKey: ["wikimedia-photo-of-day", "all"],
    queryFn: fetchAllPhotos,
    staleTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  // Default to a deterministic "today's pick" — every visitor sees
  // the same hero on the same day. ‹ › walks the user back/forward
  // through the rest of the catalog within the session.
  const total = photos?.length ?? 0
  const todayIdx = total > 0 ? dayOfYear % total : 0
  const [cursor, setCursor] = useState<number | null>(null)
  const idx = cursor ?? todayIdx
  const showNav = total > 1
  const canPrev = showNav && idx > 0
  const canNext = showNav && idx < total - 1

  return (
    <div>
      <SectionHeaderCell
        title="Photo of the day"
        right={
          showNav ? (
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setCursor(Math.max(0, idx - 1))}
                disabled={!canPrev}
                aria-label="Previous photo"
                className="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronLeft className="size-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setCursor(Math.min(total - 1, idx + 1))}
                disabled={!canNext}
                aria-label="Next photo"
                className="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronRight className="size-3.5" aria-hidden />
              </button>
            </div>
          ) : null
        }
      />
      <div className="pt-3 pb-1">
        {!photos ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="aspect-[4/3] w-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ) : photos.length === 0 ? null : (
          (() => {
            const photo = photos[idx]
            if (!photo) return null
            return (
              <figure>
                <a
                  href={photo.pageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-md"
                >
                  <HeroImg
                    url={photo.url}
                    width={600}
                    className="aspect-[4/3] w-full object-cover transition-transform duration-200 ease-out hover:scale-[1.01]"
                  />
                </a>
                {photo.description ? (
                  <figcaption className="font-editorial mt-2 text-sm leading-snug text-muted-foreground">
                    {photo.description}
                  </figcaption>
                ) : null}
                <p className="meta mt-1.5 text-[0.65rem]">
                  {photo.artist ? `${photo.artist} · ` : ""}Wikimedia Commons
                </p>
              </figure>
            )
          })()
        )}
      </div>
    </div>
  )
}
