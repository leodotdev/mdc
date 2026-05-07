import { useQuery } from "@tanstack/react-query"
import { Squirrel } from "lucide-react"

// Wildlife illustration — fetches a Wikipedia thumbnail of the named
// species and paints it through an SVG watercolor filter so the result
// reads as a hand-painted illustration rather than a photo. The filter
// chain (turbulence → displacement → soft blur → desaturate) is static
// SVG markup mounted once per page; every wildlife image references it
// by id so the GPU only compiles the filter once.
//
// When Wikipedia returns no image (or the request fails), we degrade
// to the lucide Squirrel glyph on a paper-tinted card — still illustrated,
// just generic. No server changes required.

type WikiSummary = {
  thumbnail?: { source?: string }
  originalimage?: { source?: string }
}

async function fetchWikiThumbnail(title: string): Promise<string | null> {
  // REST API summary endpoint — public, no key required, CORS-allowed.
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
    title.replace(/\s+/g, "_"),
  )}`
  const res = await fetch(url)
  if (!res.ok) return null
  const json = (await res.json()) as WikiSummary
  return json.thumbnail?.source ?? json.originalimage?.source ?? null
}

export function WildlifeIllustration({
  species,
  className,
}: {
  /** Common name from the widget entry — used as the Wikipedia query.  */
  species: string
  className?: string
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["wikipedia-thumb", species],
    queryFn: () => fetchWikiThumbnail(species),
    staleTime: 24 * 60 * 60 * 1000,
    retry: 0,
  })

  if (isLoading) {
    return (
      <div
        className={
          "aspect-[4/3] w-full animate-pulse rounded-md bg-amber-50/40 dark:bg-amber-950/20 " +
          (className ?? "")
        }
      />
    )
  }
  if (!data) {
    // Generic illustrated fallback — paper-tinted card with the lucide
    // glyph centered. Still feels like an illustration, just not the
    // specific species.
    return (
      <div
        className={
          "flex aspect-[4/3] w-full items-center justify-center rounded-md bg-amber-50/40 text-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200/30 " +
          (className ?? "")
        }
        aria-hidden
      >
        <Squirrel className="size-10" />
      </div>
    )
  }
  return (
    <div
      className={
        "aspect-[4/3] w-full overflow-hidden rounded-md bg-amber-50/40 dark:bg-amber-950/20 " +
        (className ?? "")
      }
    >
      <img
        src={data}
        alt={species}
        loading="lazy"
        className="h-full w-full object-cover [filter:url(#watercolor)_saturate(0.85)_contrast(0.95)]"
      />
    </div>
  )
}

// Mount this once near the page root. The filter is referenced by id
// from every <WildlifeIllustration> via CSS `filter: url(#watercolor)`.
// SVG with width/height 0 keeps it out of layout while the browser
// still parses and registers the filter.
export function WatercolorFilterDefs() {
  return (
    <svg
      aria-hidden
      width="0"
      height="0"
      style={{ position: "absolute" }}
    >
      <defs>
        <filter id="watercolor" x="-5%" y="-5%" width="110%" height="110%">
          {/* Brush-bleed: fractal noise displaces the source pixels by
              a few px to mimic uneven pigment edges. */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.012 0.018"
            numOctaves="2"
            seed="3"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="6"
            xChannelSelector="R"
            yChannelSelector="G"
            result="displaced"
          />
          {/* Soften high-frequency detail so it reads like a wash, not
              a photo. */}
          <feGaussianBlur in="displaced" stdDeviation="0.6" result="soft" />
          {/* Lift midtones slightly + bias toward warm paper tone. */}
          <feColorMatrix
            in="soft"
            type="matrix"
            values="
              1.05 0     0     0    0.02
              0    1.02  0     0    0.02
              0    0     0.95  0    0
              0    0     0     1    0"
          />
        </filter>
      </defs>
    </svg>
  )
}
