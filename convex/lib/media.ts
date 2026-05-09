// Hero resolution outcome. Unsplash was removed as an auto-fallback
// (stock photos read as confusing on hyperlocal coverage); the
// fallback chain is now: source page OG/Twitter image → Wikimedia
// Commons (place / landmark / public-figure photos) → none. Stories
// and events without a hero render fine — better empty than wrong.
export type HeroResolution =
  | { source: "source"; url: string; caption?: string }
  | { source: "wikimedia"; url: string; caption: string }
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

// Social-media share-card detector. Bluesky/X/Threads/Reddit pages
// for cross-posted news links return the publisher's LOGO as their
// og:image, not the actual story photo. So when a citation list mixes
// social and news URLs, news wins.
const SOCIAL_HOSTS = new Set([
  "bsky.app",
  "twitter.com",
  "x.com",
  "threads.net",
  "reddit.com",
  "old.reddit.com",
])
function isSocialUrl(url: string): boolean {
  try {
    return SOCIAL_HOSTS.has(new URL(url).hostname.replace(/^www\./, ""))
  } catch {
    return false
  }
}

// Path-based logo detector. Catches images like
// `cdn.example.com/static/logo.png`, `branding/header.svg`, etc.
// Cheap to run, no fetch required. Doesn't catch every logo (some
// publishers use timestamped filenames) but eliminates the obvious
// share-card cases.
function looksLikeLogo(imageUrl: string): boolean {
  const u = imageUrl.toLowerCase()
  return (
    /\/(?:logo|logos|branding|favicon|icon|share-card|sharecard)\b/.test(u) ||
    /-logo\.(?:png|jpg|jpeg|svg|webp)/.test(u) ||
    /default-share/.test(u)
  )
}

// HEAD-check Content-Length as a proxy for image quality. Logos are
// typically <50KB; real photos run 200KB-2MB. We HEAD instead of GET
// so we don't blow bandwidth on a quality probe. Some CDNs block
// HEAD — those return 0 here and we just trust the candidate.
async function imageByteSize(url: string): Promise<number> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: {
        "user-agent": "miami.community/1.0 (+https://miami.community)",
      },
    })
    if (!res.ok) return 0
    const len = Number(res.headers.get("content-length") ?? "0")
    return Number.isFinite(len) ? len : 0
  } catch {
    return 0
  }
}

const MIN_GOOD_IMAGE_BYTES = 30_000 // ~30KB cutoff under which we treat as logo-y

export async function resolveHero(
  citationUrls: Array<string>,
  fallbackQuery: string,
): Promise<HeroResolution> {
  // Layer 1: rank citations — news domains first, social as last resort.
  const candidates = citationUrls.slice(0, 6)
  const newsCitations = candidates.filter((u) => !isSocialUrl(u))
  const socialCitations = candidates.filter((u) => isSocialUrl(u))
  const ordered = [...newsCitations, ...socialCitations]

  // Walk the ordered list; for each citation extract its og:image; skip
  // any that look like logos by URL pattern (Layer 2). Collect the
  // surviving candidates so we can score them by size below (Layer 3).
  type Candidate = { url: string; cite: string; isSocial: boolean }
  const surviving: Array<Candidate> = []
  for (const cite of ordered) {
    const og = await extractOgImage(cite)
    if (!og) continue
    if (looksLikeLogo(og)) continue
    surviving.push({ url: og, cite, isSocial: isSocialUrl(cite) })
    // Cap: 4 candidates is enough; prevents runaway HEAD probes.
    if (surviving.length >= 4) break
  }

  // Layer 3: HEAD-check each candidate, pick the largest. News-citation
  // candidates start with a +50% bonus so we don't accidentally promote
  // a high-byte social-card logo over a smaller-but-real news photo.
  if (surviving.length > 0) {
    const scored = await Promise.all(
      surviving.map(async (c) => {
        const bytes = await imageByteSize(c.url)
        const score = bytes * (c.isSocial ? 0.5 : 1.0)
        return { ...c, bytes, score }
      }),
    )
    scored.sort((a, b) => b.score - a.score)
    const best = scored[0]
    // If even the best one is under the logo-byte cutoff, treat as
    // unusable and fall through to Wikimedia. Logos shouldn't sneak
    // in — but if every candidate HEADed at <30KB, it probably is one.
    if (best.bytes === 0 || best.bytes >= MIN_GOOD_IMAGE_BYTES) {
      return { source: "source", url: best.url }
    }
  }

  // Wikimedia Commons fallback — public-domain / CC-licensed photos
  // of civic landmarks, places, public figures, museums. Higher signal
  // than stock photography for the kind of stories this paper covers.
  const wm = await searchWikimediaMany(fallbackQuery, 1)
  const first = wm[0]
  if (first?.url) {
    return {
      source: "wikimedia",
      url: first.url,
      caption: first.caption ?? "Photo: Wikimedia Commons",
    }
  }
  return { source: "none" }
}

// Public — let other server modules ask "is this hero image probably
// a logo / share-card?" so the watchdog can re-resolve known-bad cases.
export function isLowQualityHero(url: string): boolean {
  return looksLikeLogo(url)
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
  source: "source" | "wikimedia"
  caption?: string
  /** Display label — e.g. "miamiherald.com" or "Wikimedia · Jane Doe". */
  label: string
}

export type HeroFinderDiagnostics = {
  sourcesScanned: number
  sourcesWithImage: number
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

// Wikimedia Commons fallback — no key required. Indexes a large pool
// of public-domain / CC-licensed photos, especially strong for local
// civic, political, landmark, and museum imagery — the kind of subject
// matter newspaper-style stories tend to need.
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

// Extract a YouTube video ID from a URL (youtube.com/watch?v=ID or youtu.be/ID).
// Returns the ID or null when not a YouTube URL.
function youtubeId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname.endsWith("youtube.com") || u.hostname.endsWith("youtu.be")) {
      if (u.hostname.endsWith("youtu.be")) {
        return u.pathname.slice(1).split("/")[0] || null
      }
      const v = u.searchParams.get("v")
      if (v) return v
      // /shorts/ID, /embed/ID
      const segs = u.pathname.split("/").filter(Boolean)
      if (segs.length >= 2 && (segs[0] === "shorts" || segs[0] === "embed")) {
        return segs[1] || null
      }
    }
  } catch {
    // fall through
  }
  return null
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
      // Drop logos / share-cards before they ever surface to the
      // editor — they're never the right hero. Same heuristic
      // resolveHero uses at draft time.
      if (looksLikeLogo(img)) continue
      seen.add(img)
      ogCandidates.push({
        url: img,
        source: "source",
        label: hostnameOf(url),
        caption: `Image: ${hostnameOf(url)}`,
      })
    }
  }

  // 1.5. YouTube thumbnails — when a citation URL is a YouTube video,
  // grab the high-res thumbnail (no API call required). Cheap and very
  // reliable; a great hero source for entertainment / music desks.
  for (const url of sourceUrls) {
    const ytId = youtubeId(url)
    if (!ytId) continue
    const thumb = `https://i.ytimg.com/vi/${ytId}/maxresdefault.jpg`
    if (seen.has(thumb)) continue
    seen.add(thumb)
    ogCandidates.push({
      url: thumb,
      source: "source",
      label: "YouTube",
      caption: `Image: youtube.com`,
    })
  }

  // 2. Wikimedia Commons fallback — first attempt uses the narrow
  // tags-and-section query the caller passed in. If that returns zero,
  // retry with a one-word broadening (last word, usually the section
  // name) which is far more likely to hit. "Miami" as the absolute
  // last resort.
  const lastWord =
    opts.fallbackQuery.split(/\s+/).filter(Boolean).slice(-1)[0] ?? "Miami"
  const wikimedia = await (async () => {
    const first = await searchWikimediaMany(opts.fallbackQuery, 8)
    if (first.length > 0) return first
    return await searchWikimediaMany(lastWord, 8)
  })()
  const wikimediaCandidates = wikimedia.filter((c) => {
    if (seen.has(c.url)) return false
    seen.add(c.url)
    return true
  })

  const candidates = [...ogCandidates, ...wikimediaCandidates]

  return {
    candidates,
    diagnostics: {
      sourcesScanned: sourceUrls.length,
      sourcesWithImage,
      wikimediaCount: wikimediaCandidates.length,
      totalCandidates: candidates.length,
    },
  }
}
