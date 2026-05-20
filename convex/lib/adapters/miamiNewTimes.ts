import { extractPriceFromText } from "../priceExtract"
import type { RawItem, SourceForAdapter } from "./types"

// Miami New Times event-search scraper.
//
// MNT publishes a hand-curated event roster at /eventsearch/ but
// doesn't expose JSON-LD Event microdata anywhere — so the generic
// `events-html` adapter can't extract anything. This adapter parses
// the page's CSS-classed card layout directly:
//
//   <div class="events-calendar__list-item">
//     <h2 class="event-title h4"><a href="…">Title</a></h2>
//     <div class="event-occurrences">Wed., May 20, 7:00 am</div>
//     <a class="event-location-name">Venue</a>
//     <span class="event-location-address">, 401 Biscayne Blvd.</span>
//     <div class="event-neighbourhood">Neighborhood: <strong>X</strong></div>
//   </div>
//
// Pagination follows ?page=N. The adapter walks the first N pages
// (default 3 ≈ 60-90 events) per fetch tick.
//
// Date parsing is deliberately conservative: only items whose
// occurrence string matches a single-date + time pattern get
// emitted with a real startsAt. "Every day" / "Through May 31"
// (recurring or open-ended ranges) are skipped — the deterministic
// pipeline needs a concrete startsAt, and these often duplicate
// museum tours we already ingest.

const MAX_PAGES = 3

const MONTH_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

// "Wed., May 20, 7:00 am" — with or without the day-of-week prefix.
// Also handles "Sat., Jun. 7, 9:30 pm".
const DATE_TIME = /(?:[A-Za-z]+\.,\s+)?([A-Za-z]+)\.?\s+(\d{1,2}),\s+(\d{1,2})(?::(\d{2}))?\s+(am|pm)/i

function parseMiamiDate(s: string): number | undefined {
  const m = DATE_TIME.exec(s)
  if (!m) return undefined
  const [, monthRaw, day, hourRaw, minuteRaw, ampm] = m
  const mo = MONTH_MAP[monthRaw.slice(0, 3).toLowerCase()]
  if (mo === undefined) return undefined
  let hour = Number(hourRaw)
  if (ampm.toLowerCase() === "pm" && hour !== 12) hour += 12
  if (ampm.toLowerCase() === "am" && hour === 12) hour = 0
  const minute = minuteRaw ? Number(minuteRaw) : 0
  // Year inference — MNT omits the year. Pick the year that puts
  // the parsed (month, day) in the next 12 months from today.
  const now = new Date()
  const nowMs = now.getTime()
  for (const yearOffset of [0, 1]) {
    const candidate = miamiTimestamp(
      now.getFullYear() + yearOffset,
      mo,
      Number(day),
      hour,
      minute,
    )
    if (candidate > nowMs - 24 * 3_600_000) return candidate
  }
  return undefined
}

// Construct a UTC ms for a Miami-local wall-clock time. America/New_York
// observes DST, so we can't just add a fixed offset — instead, take
// the wall time as UTC, format what New York would have shown for
// that instant, and shift by the diff.
function miamiTimestamp(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number {
  const wallAsUtc = Date.UTC(year, month, day, hour, minute)
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(wallAsUtc)).map((p) => [p.type, p.value]),
  )
  const nyAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
  )
  const offset = wallAsUtc - nyAsUtc
  return wallAsUtc + offset
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#038;/g, "&")
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#8217;/g, "’")
    .replace(/&#8216;/g, "‘")
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&nbsp;/g, " ")
    .trim()
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
}

function pick(re: RegExp, html: string): string | undefined {
  const m = re.exec(html)
  return m ? decode(stripTags(m[1])) : undefined
}

const NEIGHBORHOOD_MAP: Record<string, string> = {
  wynwood: "wynwood-design-district",
  "design district": "wynwood-design-district",
  "wynwood/design district": "wynwood-design-district",
  midtown: "midtown",
  brickell: "brickell",
  downtown: "downtown",
  "downtown/overtown": "downtown",
  overtown: "overtown",
  "little havana": "little-havana",
  "little haiti": "little-haiti",
  "coral gables": "coral-gables",
  "coconut grove": "coconut-grove",
  "key biscayne": "key-biscayne",
  "miami beach": "miami-beach",
  "south beach": "miami-beach",
  "mid-beach": "miami-beach",
  "north beach": "miami-beach",
  edgewater: "edgewater",
  doral: "doral",
  hialeah: "hialeah",
  homestead: "homestead",
  aventura: "aventura",
  "north miami": "north-miami",
  "north miami beach": "north-miami-beach",
  allapattah: "allapattah",
  pinecrest: "pinecrest",
  "miami shores": "miami-shores",
  "south miami": "south-miami",
}

function normalizeHood(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const key = raw.toLowerCase().trim()
  return NEIGHBORHOOD_MAP[key]
}

export async function fetchMiamiNewTimes(
  source: SourceForAdapter,
): Promise<Array<RawItem>> {
  const items: Array<RawItem> = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url =
      page === 1
        ? source.url
        : `${source.url}${source.url.includes("?") ? "&" : "?"}page=${page}`
    let html: string
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (compatible; miami-community-bot/1.0; +https://miami.community)",
          accept: "text/html,application/xhtml+xml",
        },
      })
      if (!res.ok) {
        if (page === 1) throw new Error(`MNT eventsearch → ${res.status}`)
        break
      }
      html = await res.text()
    } catch (err) {
      if (page === 1) throw err
      break
    }

    // Each event card is a div.events-calendar__list-item containing
    // a div.event-content with the structured pieces. Match the
    // outer container via a non-greedy span between the opening and
    // closing of event-content.
    const cardRe =
      /<div class="event-content">([\s\S]*?)<\/div>\s*<\/div>(?:\s*<div class="events-calendar__list-(?:item|advertisement)")?/g
    let m: RegExpExecArray | null
    let pageHits = 0
    while ((m = cardRe.exec(html)) !== null) {
      const block = m[1]
      const titleMatch =
        /<h2[^>]*class="event-title[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/.exec(
          block,
        )
      if (!titleMatch) continue
      const eventUrl = titleMatch[1].trim()
      const title = decode(stripTags(titleMatch[2]))
      if (!title) continue
      const idMatch = /-(\d+)\/?$/.exec(eventUrl)
      const externalId = idMatch ? `mnt_${idMatch[1]}` : `mnt_${eventUrl}`
      const occurrence =
        pick(
          /<div class="event-occurrences"[^>]*>([\s\S]*?)<\/div>/,
          block,
        ) ?? ""
      const startsAt = parseMiamiDate(occurrence)
      // Skip recurring / ranged events without a concrete startsAt.
      // The dedup pipeline downstream depends on (title + day).
      if (!startsAt) continue
      const locationName = pick(
        /<a[^>]*class="event-location-name"[^>]*>([\s\S]*?)<\/a>/,
        block,
      )
      const locationAddress = pick(
        /<span[^>]*class="event-location-address"[^>]*>([\s\S]*?)<\/span>/,
        block,
      )?.replace(/^,\s*/, "")
      const hood = pick(
        /<div class="event-neighbourhood"[^>]*>[\s\S]*?<strong[^>]*>([\s\S]*?)<\/strong>/,
        block,
      )
      const description = `${occurrence}${
        locationName ? ` · ${locationName}` : ""
      }${hood ? ` · ${hood}` : ""}`
      pageHits += 1
      items.push({
        externalId,
        url: eventUrl,
        title,
        snippet: description.slice(0, 240),
        body: description,
        publishedAt: startsAt,
        startsAt,
        locationName: locationName || undefined,
        locationAddress: locationAddress || undefined,
        price: extractPriceFromText(occurrence),
        // We can't tag neighborhoodSlugs at item level (the schema
        // attaches that to sources, not items), but the venue +
        // address are enough for downstream Haiku enrichment to
        // place the event. Hood name carried in body text.
      })
      void normalizeHood // reserved for a future per-item neighborhood passthrough
    }
    // Stop early if a page came back empty — past the last result.
    if (pageHits === 0) break
  }
  return items
}
