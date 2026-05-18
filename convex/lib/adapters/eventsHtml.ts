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
export async function fetchEventsHtml(
  source: SourceForAdapter,
): Promise<Array<RawItem>> {
  const res = await fetch(source.url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  })
  if (!res.ok) throw new Error(`events-html ${source.url} → ${res.status}`)
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

  const cutoff = Date.now() - 24 * 3_600_000
  const events: Array<RawItem> = []
  const seen = new Set<string>()
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
          const url =
            typeof obj.url === "string" && obj.url.length > 0
              ? obj.url
              : source.url
          // Dedupe within the page — Yoast often emits the same event
          // in both an `ItemList` and as a standalone block.
          const key = `${url}|${startRaw}`
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
            // symbol when it's USD, else keep the ISO code.
            const price = extractPrice(obj.offers)
            const body =
              [description, locName ? `Location: ${locName}` : null]
                .filter(Boolean)
                .join("\n\n") || undefined
            events.push({
              externalId: `evhtml_${key}`,
              url,
              title: decodeEntities(name),
              snippet: description?.slice(0, 400),
              body,
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

  events.sort((a, b) => (a.publishedAt ?? 0) - (b.publishedAt ?? 0))
  return events.slice(0, 50)
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
