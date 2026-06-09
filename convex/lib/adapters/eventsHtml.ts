import { extractPriceFromText } from "../priceExtract"
import type { RawItem, SourceForAdapter } from "./types"

// JSON-LD events scraper. Many Miami venues (Vizcaya, Deering Estate,
// and a long tail of museums/parks/theaters built on WordPress with
// Yoast-Schema or The Events Calendar plugin) don't expose RSS or iCal
// — but they DO embed schema.org Event objects in the page's
// `<script type="application/ld+json">` blocks. Those blocks carry
// `name`, `startDate`, `endDate`, `location`, `description`, `url`
// directly, so we get structured event data without writing a per-venue
// CSS selector.
//
// Why a dedicated adapter (vs. the generic RSS one): the page itself
// is HTML, not feed XML, so the RSS parser would fail at the entry
// point. Why not just scrape with CSS selectors: every venue's markup
// differs; JSON-LD is the one universal interface modern CMS-generated
// venue pages all agree on.
//
// Drops events whose start is more than 24h in the past (so the queue
// doesn't fill with last week's recurring tours).
//
// Follows up to two extra WordPress-style pagination pages
// (`?paged=2`, `?paged=3`) when the first page yields ≥10 events —
// many "The Events Calendar" / Yoast venue sites only show ~10 per
// page, so a single fetch was capping us at ~10 even when the venue
// had 30+ upcoming. Bounded: 3 pages total. Stops on 4xx/5xx or an
// empty page so non-paginating sites pay one extra fetch at most.
export async function fetchEventsHtml(
  source: SourceForAdapter,
): Promise<Array<RawItem>> {
  const cutoff = Date.now() - 24 * 3_600_000
  const events: Array<RawItem> = []
  const seen = new Set<string>()

  const page1 = await fetchEventsHtmlPage(source.url, cutoff, seen)
  events.push(...page1)

  // Only paginate when page 1 looks "full" and the URL has no query
  // string — query-bearing URLs (e.g. faceted calendar filters) often
  // 404 or return the same page when we append `?paged=N`.
  if (page1.length >= 10 && !source.url.includes("?")) {
    for (let p = 2; p <= 3; p++) {
      const pageUrl = `${source.url}${source.url.endsWith("/") ? "" : "/"}?paged=${p}`
      try {
        const more = await fetchEventsHtmlPage(pageUrl, cutoff, seen)
        if (more.length === 0) break
        events.push(...more)
      } catch {
        // 4xx/5xx — stop paginating; either the site doesn't support
        // it or we've walked past the last page.
        break
      }
    }
  }

  events.sort((a, b) => (a.publishedAt ?? 0) - (b.publishedAt ?? 0))
  return events.slice(0, 50)
}

// Single-page fetch + extract. Shared between page 1 and the optional
// pagination follow-ups. `seen` is threaded through both the JSON-LD
// and Eventbrite passes so the same event isn't emitted twice across
// pages.
async function fetchEventsHtmlPage(
  url: string,
  cutoff: number,
  seen: Set<string>,
): Promise<Array<RawItem>> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  })
  if (!res.ok) throw new Error(`events-html ${url} → ${res.status}`)
  const html = await res.text()

  // Pull every JSON-LD island out of the page. We don't care about
  // ordering — each block is a self-contained schema.org graph.
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
      // Malformed JSON-LD — skip silently. Some venues' Yoast emits
      // trailing commas or single quotes that JSON.parse rejects.
    }
  }

  const events: Array<RawItem> = []
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
          const eventUrl =
            typeof obj.url === "string" && obj.url.length > 0
              ? obj.url
              : url
          // Dedupe within the page — Yoast often emits the same event
          // in both an `ItemList` and as a standalone block.
          const key = `${eventUrl}|${startRaw}`
          if (!seen.has(key)) {
            seen.add(key)
            const description =
              typeof obj.description === "string"
                ? decodeEntities(obj.description)
                : undefined
            const loc = obj.location
            const locObj =
              loc && typeof loc === "object"
                ? (loc as Record<string, unknown>)
                : null
            const locName =
              typeof locObj?.name === "string"
                ? decodeEntities(locObj.name)
                : undefined
            // schema.org Place uses `address` — either a string or a
            // PostalAddress object with streetAddress / addressLocality.
            const addrRaw = locObj?.address
            const locAddress = (() => {
              if (typeof addrRaw === "string") return decodeEntities(addrRaw)
              if (addrRaw && typeof addrRaw === "object") {
                const a = addrRaw as Record<string, unknown>
                const parts = [a.streetAddress, a.addressLocality, a.addressRegion]
                  .filter((v): v is string => typeof v === "string")
                  .map((v) => decodeEntities(v))
                if (parts.length > 0) return parts.join(", ")
              }
              return undefined
            })()
            const endRaw =
              typeof obj.endDate === "string" ? obj.endDate : undefined
            const endMs = endRaw ? Date.parse(endRaw) : undefined
            // schema.org Offer — single object or array. Format the
            // lowest-priced one as a human-readable string. "Free" wins
            // when price is 0; otherwise prefix with the currency
            // symbol when it's USD, else keep the ISO code. Falls back
            // to regex over the description text when no Offer is
            // present.
            const price =
              extractPrice(obj.offers) ?? extractPriceFromText(description)
            // schema.org Event.image — string URL, array of URLs, or
            // an ImageObject. Pick the first usable URL.
            const mediaUrl = extractImage(obj.image)
            const body =
              [description, locName ? `Location: ${locName}` : null]
                .filter(Boolean)
                .join("\n\n") || undefined
            events.push({
              externalId: `evhtml_${key}`,
              url: eventUrl,
              title: decodeEntities(name),
              snippet: description?.slice(0, 400),
              body,
              mediaUrl,
              publishedAt: startMs,
              // Structured event fields — fed straight to the
              // deterministic ingest pipeline.
              startsAt: startMs,
              endsAt: Number.isFinite(endMs) ? endMs : undefined,
              locationName: locName,
              locationAddress: locAddress,
              price,
            })
          }
        }
      }
    }
    // Recurse into nested graph nodes — schema.org `@graph` arrays,
    // organizer/location/subEvent fields, etc.
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") stack.push(v)
    }
  }

  // Pass 2 — Eventbrite organizer/listing pages. They emit a
  // `<script id="__NEXT_DATA__" type="application/json">` blob with
  // the full Event objects under `props.pageProps`. We only run this
  // when JSON-LD didn't already cover the page (Eventbrite event
  // *detail* pages do emit JSON-LD; *organizer* pages don't, but they
  // carry the full event list in Next data). Cheap to run on every
  // events-html source — the regex bails immediately when no
  // `__NEXT_DATA__` block is present.
  if (events.length === 0) {
    const nextEvents = extractEventbriteNextData(html, url, cutoff, seen)
    for (const e of nextEvents) events.push(e)
  }

  return events
}

// Eventbrite embeds Next.js page data in a single inline JSON blob.
// We walk it and grab every node that looks like an event: a string
// `name` + ISO `start.utc` (organizer pages) or `startDate`
// (detail pages). Same dedupe key as the JSON-LD pass so we don't
// double-emit when both fire.
function extractEventbriteNextData(
  html: string,
  sourceUrl: string,
  cutoff: number,
  seen: Set<string>,
): Array<RawItem> {
  const m = html.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  )
  if (!m) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(m[1].trim())
  } catch {
    return []
  }
  const out: Array<RawItem> = []
  const stack: Array<unknown> = [parsed]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (Array.isArray(cur)) {
      for (const x of cur) if (x && typeof x === "object") stack.push(x)
      continue
    }
    if (!cur || typeof cur !== "object") continue
    const obj = cur as Record<string, unknown>

    // Two shapes: organizer pages use { name, start: { utc }, end: { utc },
    // venue: {…}, url } per event in props.pageProps.events.
    // Detail pages use { name, startDate, endDate, location, url }.
    const name = typeof obj.name === "string" ? obj.name : undefined
    const startCandidate =
      typeof obj.startDate === "string"
        ? obj.startDate
        : typeof (obj.start as Record<string, unknown> | undefined)?.utc ===
            "string"
          ? ((obj.start as Record<string, unknown>).utc as string)
          : undefined
    const url = typeof obj.url === "string" ? obj.url : undefined
    if (name && startCandidate && url && /eventbrite\.com\/e\//.test(url)) {
      const startMs = Date.parse(startCandidate)
      if (Number.isFinite(startMs) && startMs >= cutoff) {
        const key = `${url}|${startCandidate}`
        if (!seen.has(key)) {
          seen.add(key)
          const endCandidate =
            typeof obj.endDate === "string"
              ? obj.endDate
              : typeof (obj.end as Record<string, unknown> | undefined)?.utc ===
                  "string"
                ? ((obj.end as Record<string, unknown>).utc as string)
                : undefined
          const endMs = endCandidate ? Date.parse(endCandidate) : undefined
          const venue = obj.venue as Record<string, unknown> | undefined
          const locName =
            typeof venue?.name === "string" ? venue.name : undefined
          const addr = venue?.address as Record<string, unknown> | undefined
          const locAddress = (() => {
            const parts = [
              addr?.address_1,
              addr?.city,
              addr?.region,
            ].filter((v): v is string => typeof v === "string")
            return parts.length > 0 ? parts.join(", ") : undefined
          })()
          const description =
            typeof obj.description === "string"
              ? obj.description
              : typeof (obj.description as Record<string, unknown> | undefined)
                    ?.text === "string"
                ? ((obj.description as Record<string, unknown>).text as string)
                : undefined
          const image =
            typeof (obj.image as Record<string, unknown> | undefined)?.url ===
            "string"
              ? ((obj.image as Record<string, unknown>).url as string)
              : typeof (obj.logo as Record<string, unknown> | undefined)
                    ?.url === "string"
                ? ((obj.logo as Record<string, unknown>).url as string)
                : undefined
          const price = extractPriceFromText(description)
          out.push({
            externalId: `evbrite_${key}`,
            url,
            title: decodeEntities(name),
            snippet: description?.slice(0, 400),
            body:
              [
                description,
                locName ? `Location: ${locName}` : null,
              ]
                .filter(Boolean)
                .join("\n\n") || undefined,
            mediaUrl: image,
            publishedAt: startMs,
            startsAt: startMs,
            endsAt: Number.isFinite(endMs) ? endMs : undefined,
            locationName: locName ? decodeEntities(locName) : undefined,
            locationAddress: locAddress ? decodeEntities(locAddress) : undefined,
            price,
          })
        }
      }
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") stack.push(v)
    }
  }
  // Note `sourceUrl` is used implicitly via dedupe; explicit param
  // kept for symmetry with the JSON-LD path.
  void sourceUrl
  return out
}

// schema.org Event.image is "Text|URL|ImageObject" or array. Walk the
// shape and return the first plausible URL. Filters out empty strings
// and obvious data:image URIs.
function extractImage(raw: unknown): string | undefined {
  const candidates = Array.isArray(raw) ? raw : raw != null ? [raw] : []
  for (const c of candidates) {
    if (typeof c === "string") {
      const trimmed = c.trim()
      if (trimmed.length > 0 && !trimmed.startsWith("data:")) return trimmed
    } else if (c && typeof c === "object") {
      const obj = c as Record<string, unknown>
      const url =
        typeof obj.url === "string"
          ? obj.url
          : typeof obj.contentUrl === "string"
            ? obj.contentUrl
            : undefined
      if (url && url.trim().length > 0 && !url.startsWith("data:")) {
        return url.trim()
      }
    }
  }
  return undefined
}

// Format a schema.org Offer (or array of Offers) into a human-readable
// price label. Picks the lowest non-null price; renders "Free" at 0,
// "$N" for USD, "N CUR" for anything else. Returns undefined when no
// usable price is present so the renderer can omit the price slot.
function extractPrice(raw: unknown): string | undefined {
  const offers = Array.isArray(raw) ? raw : raw != null ? [raw] : []
  type Parsed = { value: number; currency: string }
  const parsed: Array<Parsed> = []
  for (const o of offers) {
    if (!o || typeof o !== "object") continue
    const obj = o as Record<string, unknown>
    const priceRaw = obj.price ?? obj.lowPrice
    const value =
      typeof priceRaw === "number"
        ? priceRaw
        : typeof priceRaw === "string"
          ? Number(priceRaw.replace(/[^0-9.]/g, ""))
          : NaN
    if (!Number.isFinite(value)) continue
    const currency =
      typeof obj.priceCurrency === "string" ? obj.priceCurrency : "USD"
    parsed.push({ value, currency })
  }
  if (parsed.length === 0) return undefined
  parsed.sort((a, b) => a.value - b.value)
  const cheapest = parsed[0]
  if (cheapest.value === 0) return "Free"
  if (cheapest.currency === "USD") return `$${formatPrice(cheapest.value)}`
  return `${formatPrice(cheapest.value)} ${cheapest.currency}`
}

function formatPrice(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

// Decode the common WordPress / Yoast HTML entities that show up in
// JSON-LD strings. Full HTML decoding would need a DOM; this covers the
// ones we've actually seen on Miami venue pages.
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
