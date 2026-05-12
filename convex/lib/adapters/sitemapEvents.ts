import type { RawItem, SourceForAdapter } from "./types"

// Sitemap-driven event discovery. Given a base URL (or an explicit
// sitemap URL), this adapter:
//
//   1. Fetches /sitemap.xml (or the path the source URL points at).
//   2. Recurses into sitemap-index entries — many large venues split
//      their sitemap by content type (`sitemap-events.xml`,
//      `sitemap-posts.xml`, etc.).
//   3. Filters discovered URLs to ones that look event-shaped
//      (path contains `/event/`, `/events/`, `/calendar/`,
//      `/show/`, `/exhibition/`, `/performance/`, or `/program/`).
//   4. Scrapes each filtered URL for JSON-LD `Event` schema using
//      the same logic as `eventsHtml.ts`.
//
// Why a separate adapter (vs. just expanding eventsHtml): venues
// expose hundreds of individual event-detail pages, not one event
// listing page. eventsHtml is for the latter; sitemapEvents is for
// when the listing is the sitemap itself.
//
// Cost shape: 1 sitemap fetch + N event-page fetches. N is capped
// hard (default 40) so a venue with 500 listed events doesn't blow
// our HTTP budget per cron tick. Recent-only — we sort by
// `<lastmod>` when present and take the most recently-changed URLs
// first.
//
// Bounded crawl, no recursion past 2 levels of sitemap-index nesting.

type SitemapConfig = {
  /** Override the path inside the base URL where the sitemap lives.
   *  Defaults to "/sitemap.xml". Some venues use "/sitemap_index.xml"
   *  or "/wp-sitemap.xml" — set this when the default doesn't work. */
  sitemapPath?: string
  /** Cap on the number of event-detail pages scraped per fetch. */
  maxEvents?: number
  /** Override the URL-path patterns that mark a URL as event-shaped.
   *  Defaults to /event/, /events/, /calendar/, /show/, /exhibition/,
   *  /performance/, /program/. */
  eventPathPatterns?: ReadonlyArray<string>
}

const DEFAULT_EVENT_PATH_PATTERNS = [
  "/event/",
  "/events/",
  "/calendar/",
  "/show/",
  "/exhibition/",
  "/performance/",
  "/program/",
]

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  Accept:
    "application/xml, text/xml, text/html, application/xhtml+xml, */*;q=0.5",
  "Accept-Language": "en-US,en;q=0.9",
} as const

export async function fetchSitemapEvents(
  source: SourceForAdapter,
): Promise<Array<RawItem>> {
  const cfg = (source.config as SitemapConfig | undefined) ?? {}
  const maxEvents = Math.min(cfg.maxEvents ?? 40, 100)
  const patterns = cfg.eventPathPatterns ?? DEFAULT_EVENT_PATH_PATTERNS

  // Source URL can be either a base origin (`https://venue.com`) or
  // an explicit sitemap URL (`https://venue.com/sitemap-events.xml`).
  // Treat as explicit-sitemap when the URL ends in .xml, otherwise
  // resolve cfg.sitemapPath (or `/sitemap.xml` default) against it.
  const sitemapUrl = source.url.endsWith(".xml")
    ? source.url
    : new URL(cfg.sitemapPath ?? "/sitemap.xml", source.url).toString()

  // Recursively collect URLs from the sitemap tree, capped at
  // 5000 raw URLs before the event-pattern filter to stop runaway
  // crawls of huge content sitemaps.
  const collected = await collectSitemapUrls(sitemapUrl, 0, new Set())
  const eventUrls = collected
    .filter((entry) =>
      patterns.some((p) => entry.loc.toLowerCase().includes(p)),
    )
    // Most-recently-modified first when lastmod is present; URLs
    // without lastmod fall to the end.
    .sort((a, b) => (b.lastmod ?? 0) - (a.lastmod ?? 0))
    .slice(0, maxEvents)

  // Fetch each event page and JSON-LD-scrape. Run concurrent up to
  // a small cap so a 40-page batch doesn't burst-fire 40 sockets.
  const CONCURRENCY = 6
  const results: Array<RawItem> = []
  for (let i = 0; i < eventUrls.length; i += CONCURRENCY) {
    const batch = eventUrls.slice(i, i + CONCURRENCY)
    const fetched = await Promise.all(
      batch.map((entry) => scrapeJsonLdEvent(entry.loc).catch(() => null)),
    )
    for (const item of fetched) {
      if (item) results.push(item)
    }
  }
  return results
}

// =====================================================================
// Sitemap parsing
// =====================================================================

type SitemapEntry = {
  loc: string
  lastmod?: number
}

async function collectSitemapUrls(
  url: string,
  depth: number,
  seen: Set<string>,
): Promise<Array<SitemapEntry>> {
  if (depth > 2) return [] // hard recursion cap
  if (seen.has(url)) return []
  seen.add(url)

  const res = await fetch(url, { headers: BROWSER_HEADERS })
  if (!res.ok) return []
  const xml = await res.text()

  // sitemap-index? Pull child sitemap URLs and recurse.
  if (/<sitemapindex/i.test(xml)) {
    const children = parseLocs(xml)
    const out: Array<SitemapEntry> = []
    for (const child of children.slice(0, 20)) {
      const nested = await collectSitemapUrls(child.loc, depth + 1, seen)
      out.push(...nested)
      if (out.length >= 5000) break
    }
    return out
  }
  // urlset — terminal sitemap, return its <url>/<loc> entries.
  return parseLocs(xml).slice(0, 5000)
}

// Pull every <loc>...</loc> entry and the adjacent <lastmod>. Cheap
// regex parse — sitemap.org XML is simple and predictable.
function parseLocs(xml: string): Array<SitemapEntry> {
  const out: Array<SitemapEntry> = []
  // Match each <url>...</url> (or <sitemap>...</sitemap>) block.
  const blockRe =
    /<(?:url|sitemap)[^>]*>([\s\S]*?)<\/(?:url|sitemap)>/gi
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(xml)) !== null) {
    const block = m[1]
    const loc = block.match(/<loc>([^<]+)<\/loc>/i)?.[1]?.trim()
    if (!loc) continue
    const lastmodStr = block.match(/<lastmod>([^<]+)<\/lastmod>/i)?.[1]
    const lastmod = lastmodStr ? Date.parse(lastmodStr) : undefined
    out.push({ loc, lastmod: Number.isFinite(lastmod) ? lastmod : undefined })
  }
  return out
}

// =====================================================================
// Per-page JSON-LD Event scrape — same shape as eventsHtml.ts but
// inlined so the two adapters stay independent. Returns at most ONE
// RawItem per page (the first Event node found in any JSON-LD
// block). Pages that don't carry Event schema yield null.
// =====================================================================

async function scrapeJsonLdEvent(url: string): Promise<RawItem | null> {
  const res = await fetch(url, { headers: BROWSER_HEADERS })
  if (!res.ok) return null
  const html = await res.text()
  const blocks: Array<unknown> = []
  const blockRe =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(html)) !== null) {
    const raw = m[1].trim()
    if (!raw) continue
    try {
      blocks.push(JSON.parse(raw))
    } catch {
      // skip malformed
    }
  }
  const cutoff = Date.now() - 24 * 3_600_000
  const stack: Array<unknown> = [...blocks]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (Array.isArray(cur)) {
      stack.push(...cur)
      continue
    }
    if (!cur || typeof cur !== "object") continue
    const obj = cur as Record<string, unknown>
    const t = obj["@type"]
    const isEvent =
      (typeof t === "string" && /event/i.test(t)) ||
      (Array.isArray(t) &&
        t.some((x) => typeof x === "string" && /event/i.test(x)))
    if (isEvent) {
      const name = typeof obj.name === "string" ? obj.name : undefined
      const startRaw =
        typeof obj.startDate === "string" ? obj.startDate : undefined
      if (name && startRaw) {
        const startMs = Date.parse(startRaw)
        if (Number.isFinite(startMs) && startMs >= cutoff) {
          const description =
            typeof obj.description === "string"
              ? decodeEntities(obj.description)
              : undefined
          const loc = obj.location
          const locName =
            loc && typeof loc === "object"
              ? (loc as Record<string, unknown>).name
              : undefined
          const locStr =
            typeof locName === "string" ? decodeEntities(locName) : undefined
          const body =
            [description, locStr ? `Location: ${locStr}` : null]
              .filter(Boolean)
              .join("\n\n") || undefined
          return {
            externalId: `sitemap_${url}`,
            url,
            title: decodeEntities(name),
            snippet: description?.slice(0, 400),
            body,
            publishedAt: startMs,
          }
        }
      }
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") stack.push(v)
    }
  }
  return null
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#038;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&#8216;/g, "‘")
    .replace(/&#8217;/g, "’")
    .replace(/&#8220;/g, "“")
    .replace(/&#8221;/g, "”")
    .replace(/&#8230;/g, "…")
    .replace(/&nbsp;/g, " ")
}
