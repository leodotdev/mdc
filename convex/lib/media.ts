export type HeroResolution =
  | { source: "source"; url: string; caption?: string }
  | { source: "unsplash"; url: string; caption: string }
  | { source: "none" }

function metaContent(html: string, prop: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
    "i",
  )
  const m = html.match(re)
  return m?.[1]
}

async function extractOgImage(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": "miami.community/1.0 (+https://miami.community)",
      },
    })
    if (!res.ok) return undefined
    const html = await res.text()
    return (
      metaContent(html, "og:image") ?? metaContent(html, "twitter:image")
    )
  } catch {
    return undefined
  }
}

async function searchUnsplash(
  query: string,
): Promise<{ url: string; caption: string } | undefined> {
  const key = process.env.UNSPLASH_ACCESS_KEY
  if (!key) return undefined
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(
      query,
    )}&per_page=1&orientation=landscape&content_filter=high`
    const res = await fetch(url, {
      headers: { Authorization: `Client-ID ${key}` },
    })
    if (!res.ok) return undefined
    const json = (await res.json()) as {
      results?: Array<{
        urls?: { regular?: string }
        user?: { name?: string; links?: { html?: string } }
      }>
    }
    const first = json.results?.[0]
    if (!first?.urls?.regular) return undefined
    const photographer = first.user?.name ?? "Unsplash"
    return {
      url: first.urls.regular,
      caption: `Photo: ${photographer} / Unsplash`,
    }
  } catch {
    return undefined
  }
}

export async function resolveHero(
  citationUrls: Array<string>,
  fallbackQuery: string,
): Promise<HeroResolution> {
  for (const url of citationUrls.slice(0, 4)) {
    const og = await extractOgImage(url)
    if (og) return { source: "source", url: og }
  }
  const unsplash = await searchUnsplash(fallbackQuery)
  if (unsplash) {
    return {
      source: "unsplash",
      url: unsplash.url,
      caption: unsplash.caption,
    }
  }
  return { source: "none" }
}

// =====================================================================
// Multi-candidate finder — used by the editor's "Find image" picker so
// they can choose from several options instead of accepting whatever
// auto-resolution picked. Returns up to ~12 candidates: every OG /
// twitter:image / first inline <img> from each cited source page,
// plus Unsplash matches and Wikimedia Commons matches as fallbacks.
//
// We deliberately do NOT HEAD-check candidates server-side — many CDNs
// (newspaper sites especially) refuse HEAD or block server-side IPs
// while serving the same URL fine to the browser. That false-negative
// rate was killing the picker. Instead we trust the browser to render
// and the picker UI hides any tile whose <img> fires onError.
// =====================================================================

export type HeroCandidate = {
  url: string
  source: "source" | "unsplash" | "wikimedia"
  caption?: string
  /** Display label — e.g. "miamiherald.com" or "Photo: Jane Doe / Unsplash". */
  label: string
}

export type HeroFinderDiagnostics = {
  sourcesScanned: number
  sourcesWithImage: number
  unsplashEnabled: boolean
  unsplashCount: number
  wikimediaCount: number
  totalCandidates: number
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

// Pull every plausible image candidate from a single source page —
// not just og:image. Returns dedup'd absolute URLs in priority order.
async function extractImagesFromPage(url: string): Promise<Array<string>> {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; miami.community/1.0; +https://miami.community)",
      },
    })
    if (!res.ok) return []
    const html = await res.text()
    const found: Array<string> = []
    const push = (raw?: string) => {
      if (!raw) return
      try {
        const abs = new URL(raw, url).toString()
        if (!found.includes(abs)) found.push(abs)
      } catch {
        // ignore unparseable URLs
      }
    }
    push(metaContent(html, "og:image"))
    push(metaContent(html, "og:image:url"))
    push(metaContent(html, "og:image:secure_url"))
    push(metaContent(html, "twitter:image"))
    push(metaContent(html, "twitter:image:src"))
    // Pull a couple of inline <img> tags as fallback (skip tiny ones).
    const imgRe = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
    let m: RegExpExecArray | null
    let inlineCount = 0
    while ((m = imgRe.exec(html)) !== null && inlineCount < 4) {
      const src = m[1]
      // Skip data URIs, sprite/icon shaped paths, and obvious 1x1 pixels.
      if (/^data:/.test(src)) continue
      if (/(sprite|icon|favicon|logo|pixel|track|spacer|placeholder)/i.test(src))
        continue
      push(src)
      inlineCount += 1
    }
    return found
  } catch {
    return []
  }
}

async function searchUnsplashMany(
  query: string,
  count: number,
): Promise<Array<HeroCandidate>> {
  const key = process.env.UNSPLASH_ACCESS_KEY
  if (!key) return []
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(
      query,
    )}&per_page=${Math.min(count, 12)}&orientation=landscape&content_filter=high`
    const res = await fetch(url, {
      headers: { Authorization: `Client-ID ${key}` },
    })
    if (!res.ok) return []
    const json = (await res.json()) as {
      results?: Array<{
        urls?: { regular?: string }
        user?: { name?: string }
      }>
    }
    return (json.results ?? [])
      .map((r) => {
        if (!r.urls?.regular) return null
        const photographer = r.user?.name ?? "Unsplash"
        const c: HeroCandidate = {
          url: r.urls.regular,
          source: "unsplash",
          caption: `Photo: ${photographer} / Unsplash`,
          label: `Unsplash · ${photographer}`,
        }
        return c
      })
      .filter((c): c is HeroCandidate => c !== null)
  } catch {
    return []
  }
}

// Wikimedia Commons is a no-key fallback — useful when Unsplash returns
// nothing and the source pages block bots. It indexes a large pool of
// public-domain / CC-licensed photos, including local civic + political
// imagery that newspaper-style stories often need.
async function searchWikimediaMany(
  query: string,
  count: number,
): Promise<Array<HeroCandidate>> {
  try {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",
      generator: "search",
      gsrnamespace: "6", // File:
      gsrsearch: `filetype:bitmap ${query}`,
      gsrlimit: String(Math.min(count, 12)),
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      iiurlwidth: "1200",
    })
    const res = await fetch(
      `https://commons.wikimedia.org/w/api.php?${params}`,
      {
        headers: {
          "user-agent":
            "miami.community/1.0 (+https://miami.community)",
        },
      },
    )
    if (!res.ok) return []
    const json = (await res.json()) as {
      query?: {
        pages?: Record<
          string,
          {
            title?: string
            imageinfo?: Array<{
              thumburl?: string
              url?: string
              extmetadata?: { Artist?: { value?: string } }
            }>
          }
        >
      }
    }
    const pages = Object.values(json.query?.pages ?? {})
    return pages
      .map((p) => {
        const info = p.imageinfo?.[0]
        const u = info?.thumburl ?? info?.url
        if (!u) return null
        const artistRaw = info?.extmetadata?.Artist?.value
        const artist = artistRaw
          ? artistRaw.replace(/<[^>]+>/g, "").trim().slice(0, 60)
          : null
        const c: HeroCandidate = {
          url: u,
          source: "wikimedia",
          caption: artist
            ? `Photo: ${artist} / Wikimedia Commons`
            : "Photo: Wikimedia Commons",
          label: artist
            ? `Wikimedia · ${artist}`
            : "Wikimedia Commons",
        }
        return c
      })
      .filter((c): c is HeroCandidate => c !== null)
  } catch {
    return []
  }
}

export async function findHeroCandidates(opts: {
  citationUrls: Array<string>
  fallbackQuery: string
  /** Existing image to exclude from the candidate list. */
  excludeUrl?: string
}): Promise<{
  candidates: Array<HeroCandidate>
  diagnostics: HeroFinderDiagnostics
}> {
  const seen = new Set<string>()
  if (opts.excludeUrl) seen.add(opts.excludeUrl)

  // 1. Pull every plausible image from each citation source page.
  const sourceUrls = opts.citationUrls.slice(0, 6)
  const perPage = await Promise.all(
    sourceUrls.map(async (url) => ({
      url,
      images: await extractImagesFromPage(url),
    })),
  )
  const ogCandidates: Array<HeroCandidate> = []
  let sourcesWithImage = 0
  for (const { url, images } of perPage) {
    if (images.length > 0) sourcesWithImage += 1
    for (const img of images) {
      if (seen.has(img)) continue
      seen.add(img)
      ogCandidates.push({
        url: img,
        source: "source",
        label: hostnameOf(url),
        caption: `Image: ${hostnameOf(url)}`,
      })
    }
  }

  // 2. Unsplash and Wikimedia in parallel — first attempt uses the
  // narrow tags-and-section query the caller passed in. If that returns
  // zero from a service, retry it with a one-word broadening (the last
  // word of the query, usually the section name) which is far more
  // likely to have hits. "Miami" as the absolute last resort.
  const lastWord =
    opts.fallbackQuery.split(/\s+/).filter(Boolean).slice(-1)[0] ?? "Miami"
  const [unsplash, wikimedia] = await Promise.all([
    (async () => {
      const first = await searchUnsplashMany(opts.fallbackQuery, 6)
      if (first.length > 0) return first
      return await searchUnsplashMany(lastWord, 6)
    })(),
    (async () => {
      const first = await searchWikimediaMany(opts.fallbackQuery, 6)
      if (first.length > 0) return first
      return await searchWikimediaMany(lastWord, 6)
    })(),
  ])
  const unsplashCandidates = unsplash.filter((c) => {
    if (seen.has(c.url)) return false
    seen.add(c.url)
    return true
  })
  const wikimediaCandidates = wikimedia.filter((c) => {
    if (seen.has(c.url)) return false
    seen.add(c.url)
    return true
  })

  const candidates = [
    ...ogCandidates,
    ...unsplashCandidates,
    ...wikimediaCandidates,
  ]

  return {
    candidates,
    diagnostics: {
      sourcesScanned: sourceUrls.length,
      sourcesWithImage,
      unsplashEnabled: !!process.env.UNSPLASH_ACCESS_KEY,
      unsplashCount: unsplashCandidates.length,
      wikimediaCount: wikimediaCandidates.length,
      totalCandidates: candidates.length,
    },
  }
}
