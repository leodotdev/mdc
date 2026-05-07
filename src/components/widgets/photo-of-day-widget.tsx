import { useQuery } from "@tanstack/react-query"

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

export function PhotoOfDayWidget() {
  const dayOfYear = miamiDayOfYear()
  const queryIndex = dayOfYear % QUERIES.length
  const queryString = QUERIES[queryIndex]

  const { data: photos } = useQuery({
    queryKey: ["wikimedia-photo-of-day", queryString],
    queryFn: () => fetchPhotos(queryString),
    staleTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  return (
    <div>
      <SectionHeaderCell title="Photo of the day" />
      <div className="pt-3 pb-1">
        {!photos ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="aspect-[4/3] w-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ) : photos.length === 0 ? null : (
          (() => {
            // Pick the Nth photo within the day's query bucket so the
            // selection drifts across days even within the same query.
            const idx = Math.floor(dayOfYear / QUERIES.length) % photos.length
            const photo = photos[idx]
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
