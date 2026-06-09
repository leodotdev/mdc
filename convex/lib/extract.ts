// Unified extraction pipeline. One entry point — `extract(input)` — that:
//
//   1. Does ONE conditional GET (honors If-None-Match / If-Modified-Since)
//   2. Returns immediately on 304 (skips all parse + LLM work)
//   3. Sniffs the response (content-type, URL pattern, body fingerprints)
//      to pick a parser:
//        - text/calendar         → ICS parse
//        - sitemap.xml           → sitemap walk (delegated)
//        - miaminewtimes search  → MNT scraper  (delegated)
//        - HTML with JSON-LD     → events-html parse
//        - HTML otherwise        → LLM extract
//   4. Reports back the new ETag / Last-Modified so the next tick can
//      conditional-fetch.
//
// Operator UX:  the source's `type` field is now just a hint kept for
// backward compatibility — the pipeline chooses at runtime so a URL
// change can't silently miss-route. `forceBrowser: true` flips the
// fallback path to Cloudflare Browser Rendering.

import { fetchMiamiNewTimes } from "./adapters/miamiNewTimes"
import { fetchSitemapEvents } from "./adapters/sitemapEvents"
import { generatePageEventExtraction } from "./llm"
import { extractPriceFromText } from "./priceExtract"
import type { RawItem } from "./adapters/types"

export type ExtractInput = {
  url: string
  config?: unknown
  /** If-None-Match value from the last successful fetch. */
  etag?: string
  /** If-Modified-Since value from the last successful fetch. */
  lastModified?: string
  /** Skip plain-fetch and go straight to Cloudflare Browser Rendering. */
  forceBrowser?: boolean
}

export type ExtractResult = {
  items: ReadonlyArray<RawItem>
  /** True when the server returned 304 — caller should NOT update
   *  recordFetch's items but SHOULD bump lastFetchedAt so the
   *  source health timer resets. */
  notModified: boolean
  /** Fresh caching headers from this fetch, if the server sent them. */
  etag?: string
  lastModified?: string
  /** Short identifier of which strategy produced the items — surfaced
   *  in recordFetch for /admin/sources debugging ("ics", "jsonld",
   *  "llm", "browser-llm", "sitemap", "mnt"). */
  strategy: string
}

const PAGE_TEXT_CAP = 8000
const MIAMI_TZ = "America/New_York"

// ── Entry point ─────────────────────────────────────────────────────────
export async function extract(input: ExtractInput): Promise<ExtractResult> {
  // URL-pattern fast paths — these adapters do their own multi-page
  // fetches so the caching shortcut wouldn't help anyway. They keep
  // their existing behavior unchanged.
  if (input.url.includes("miaminewtimes.com/eventsearch")) {
    const items = await fetchMiamiNewTimes({
      type: "miami-new-times",
      url: input.url,
      config: input.config,
    })
    return { items, notModified: false, strategy: "mnt" }
  }
  if (/sitemap.*\.xml(?:\?|$)/i.test(input.url)) {
    const items = await fetchSitemapEvents({
      type: "sitemap-events",
      url: input.url,
      config: input.config,
    })
    return { items, notModified: false, strategy: "sitemap" }
  }

  // Browser-rendered path — bypass plain fetch entirely.
  if (input.forceBrowser) {
    const html = await renderViaCloudflareBrowser(input.url)
    if (!html) return { items: [], notModified: false, strategy: "browser-llm-failed" }
    const items = await llmExtractFromHtml(html, input.url)
    return { items, notModified: false, strategy: "browser-llm" }
  }

  // ── Single conditional GET ────────────────────────────────────────────
  const headers: Record<string, string> = {
    "user-agent":
      "Mozilla/5.0 (compatible; miami-community-bot/1.0; +https://miami.community)",
    accept:
      "text/html,application/xhtml+xml,text/calendar,application/xml;q=0.9,*/*;q=0.8",
  }
  if (input.etag) headers["if-none-match"] = input.etag
  if (input.lastModified) headers["if-modified-since"] = input.lastModified

  const res = await fetch(input.url, { headers })

  if (res.status === 304) {
    return {
      items: [],
      notModified: true,
      etag: input.etag,
      lastModified: input.lastModified,
      strategy: "304",
    }
  }
  if (!res.ok) {
    throw new Error(`extract ${input.url} → ${res.status}`)
  }

  const nextEtag = res.headers.get("etag") ?? undefined
  const nextLastModified = res.headers.get("last-modified") ?? undefined
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase()
  const body = await res.text()

  // ── Strategy selection ───────────────────────────────────────────────
  // ICS — text/calendar OR body starts with BEGIN:VCALENDAR.
  if (contentType.includes("text/calendar") || /^BEGIN:VCALENDAR/i.test(body)) {
    const items = parseIcs(body, input.url, input.config)
    return { items, notModified: false, etag: nextEtag, lastModified: nextLastModified, strategy: "ics" }
  }

  // HTML — count JSON-LD Event blocks. 1+ → structured parse.
  const jsonLdHits = countJsonLdEventScripts(body)
  if (jsonLdHits >= 1) {
    const items = parseEventsHtml(body, input.url)
    if (items.length > 0) {
      return { items, notModified: false, etag: nextEtag, lastModified: nextLastModified, strategy: "jsonld" }
    }
    // Fall through to LLM if the JSON-LD parse came back empty
    // (sometimes the blocks are ItemList wrappers with no real events).
  }

  // Cloudflare-style block page → bail. Caller can flip to
  // forceBrowser on the next tick to bypass.
  if (isAntiBotInterstitial(body)) {
    return { items: [], notModified: false, etag: nextEtag, lastModified: nextLastModified, strategy: "blocked" }
  }

  // Default — strip HTML, send to Haiku.
  const items = await llmExtractFromHtml(body, input.url)
  return { items, notModified: false, etag: nextEtag, lastModified: nextLastModified, strategy: "llm" }
}

// ── Inline parsers ─────────────────────────────────────────────────────

function countJsonLdEventScripts(html: string): number {
  const matches = html.match(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?"@type"\s*:\s*"(?:Sport)?Event"/gi,
  )
  return matches ? matches.length : 0
}

const ANTIBOT_FINGERPRINTS: ReadonlyArray<RegExp> = [
  /<title>Attention Required! \| Cloudflare<\/title>/i,
  /\bcdn-cgi\/challenge-platform\b/i,
  /Cloudflare Ray ID/i,
  /Imperva Incapsula/i,
  /<title>Just a moment\.\.\.<\/title>/i,
  /Checking your browser before accessing/i,
]
function isAntiBotInterstitial(html: string): boolean {
  const head = html.slice(0, 16_000)
  return ANTIBOT_FINGERPRINTS.some((re) => re.test(head))
}

function htmlToText(html: string): string {
  const stripped = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, " ")
    .replace(/<[^>]+>/g, " ")
  return decodeEntities(stripped).replace(/\s+/g, " ").trim()
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
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
    .replace(/&#8216;|&#8217;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
}

async function llmExtractFromHtml(
  html: string,
  baseUrl: string,
): Promise<Array<RawItem>> {
  const pageText = htmlToText(html).slice(0, PAGE_TEXT_CAP)
  if (pageText.length < 100) return []
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: MIAMI_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
  const extracted = await generatePageEventExtraction({
    model: "claude-haiku-4-5-20251001",
    pageUrl: baseUrl,
    pageText,
    todayIso: today,
  })
  if (!extracted) return []
  const items: Array<RawItem> = []
  for (const e of extracted) {
    const startsAt = Date.parse(e.startsAtIso)
    if (!Number.isFinite(startsAt)) continue
    if (startsAt < Date.now() - 24 * 3_600_000) continue
    const endsAt = e.endsAtIso ? Date.parse(e.endsAtIso) : undefined
    const slug = e.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
    const dayKey = new Date(startsAt).toISOString().slice(0, 10)
    items.push({
      externalId: `llm_${dayKey}_${slug}`,
      url: e.url ?? baseUrl,
      title: e.title,
      snippet: e.description?.slice(0, 240),
      body: e.description,
      publishedAt: startsAt,
      startsAt,
      endsAt: endsAt && Number.isFinite(endsAt) ? endsAt : undefined,
      locationName: e.locationName,
      locationAddress: e.locationAddress,
      price: e.price,
    })
  }
  return items
}

// ── ICS parser (lifted from adapters/ics.ts; takes pre-fetched text) ─

type IcsConfig = { max?: number }
function parseIcs(
  text: string,
  baseUrl: string,
  config?: unknown,
): Array<RawItem> {
  const unfolded = text.replace(/\r?\n[ \t]/g, "")
  const cfg = (config as IcsConfig | undefined) ?? {}
  const max = Math.min(cfg.max ?? 30, 100)
  const cutoff = Date.now() - 24 * 3_600_000
  const events: Array<RawItem> = []
  const blocks = unfolded.split(/BEGIN:VEVENT/i).slice(1)
  for (const block of blocks) {
    const end = block.search(/END:VEVENT/i)
    if (end < 0) continue
    const body = block.slice(0, end)
    const uid = readIcsProp(body, "UID")
    const summary = readIcsProp(body, "SUMMARY")
    if (!uid || !summary) continue
    const description = readIcsProp(body, "DESCRIPTION")
    const location = readIcsProp(body, "LOCATION")
    const url = readIcsProp(body, "URL")
    const dtRaw = readIcsPropLine(body, "DTSTART")
    const startMs = dtRaw ? parseIcsDate(dtRaw) : undefined
    const dtEndRaw = readIcsPropLine(body, "DTEND")
    const endMs = dtEndRaw ? parseIcsDate(dtEndRaw) : undefined
    const allDay = dtRaw ? !dtRaw.includes("T") : undefined
    const rrule = readIcsProp(body, "RRULE")
    if (!rrule && startMs != null && startMs < cutoff) continue
    const image =
      readIcsProp(body, "IMAGE") ??
      readIcsProp(body, "X-IMAGE") ??
      readIcsProp(body, "X-WP-IMAGES-URL")
    const composedBody = [
      description,
      location ? `Location: ${location}` : null,
    ]
      .filter(Boolean)
      .join("\n\n")
    events.push({
      externalId: `ics_${uid}`,
      url: url ?? baseUrl,
      title: summary,
      snippet: description?.slice(0, 400),
      body: composedBody || undefined,
      mediaUrl: image,
      publishedAt: startMs,
      recurrenceRule: rrule,
      startsAt: startMs,
      endsAt: endMs,
      locationName: location,
      allDay,
      price: extractPriceFromText(description),
    })
  }
  events.sort((a, b) => (a.publishedAt ?? 0) - (b.publishedAt ?? 0))
  return events.slice(0, max)
}

function readIcsProp(block: string, name: string): string | undefined {
  const re = new RegExp(`(?:^|\\n)${name}(?:;[^:\\n]*)?:([^\\n]*)`, "i")
  const m = block.match(re)
  if (!m) return undefined
  return icsUnescape(m[1].trim())
}
function readIcsPropLine(block: string, name: string): string | undefined {
  const re = new RegExp(`(?:^|\\n)(${name}(?:;[^:\\n]*)?:[^\\n]*)`, "i")
  const m = block.match(re)
  return m?.[1]
}
function icsUnescape(v: string): string {
  return v
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
}
function parseIcsDate(line: string): number | undefined {
  const colon = line.indexOf(":")
  if (colon < 0) return undefined
  const params = line.slice(0, colon).toUpperCase()
  const value = line.slice(colon + 1).trim()
  if (params.includes("VALUE=DATE")) {
    const m = value.match(/^(\d{4})(\d{2})(\d{2})$/)
    if (!m) return undefined
    return Date.UTC(+m[1], +m[2] - 1, +m[3])
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/)
  if (!m) return undefined
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
}

// ── JSON-LD events parser (lifted from adapters/eventsHtml.ts) ────────

function parseEventsHtml(html: string, baseUrl: string): Array<RawItem> {
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
      // Yoast + The Events Calendar occasionally emit JSON with trailing
      // commas / single quotes; ignore the malformed island.
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
              : baseUrl
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
            const price =
              extractJsonLdPrice(obj.offers) ?? extractPriceFromText(description)
            const mediaUrl = extractJsonLdImage(obj.image)
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
              mediaUrl,
              publishedAt: startMs,
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
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") stack.push(v)
    }
  }
  events.sort((a, b) => (a.publishedAt ?? 0) - (b.publishedAt ?? 0))
  return events.slice(0, 50)
}

function extractJsonLdImage(raw: unknown): string | undefined {
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

function extractJsonLdPrice(raw: unknown): string | undefined {
  const candidates = Array.isArray(raw) ? raw : raw != null ? [raw] : []
  let best: { price?: number; raw?: string; currency?: string } | null = null
  for (const c of candidates) {
    if (!c || typeof c !== "object") continue
    const o = c as Record<string, unknown>
    const p = o.price
    const currency =
      typeof o.priceCurrency === "string" ? o.priceCurrency : undefined
    let priceNum: number | undefined
    let priceRaw: string | undefined
    if (typeof p === "number") {
      priceNum = p
      priceRaw = String(p)
    } else if (typeof p === "string") {
      priceRaw = p
      const m = p.match(/[\d.]+/)
      if (m) priceNum = Number(m[0])
    }
    if (priceNum === 0) return "Free"
    if (priceNum !== undefined && (best?.price === undefined || priceNum < best.price)) {
      best = { price: priceNum, raw: priceRaw, currency }
    }
  }
  if (!best || best.price === undefined) return undefined
  const sym = best.currency === "USD" || !best.currency ? "$" : `${best.currency} `
  return `${sym}${best.price}`
}

// ── Cloudflare Browser Rendering ──────────────────────────────────────

async function renderViaCloudflareBrowser(
  url: string,
): Promise<string | null> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_BROWSER_TOKEN
  if (!accountId || !token) return null
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/content`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ url, waitForTimeout: 2000 }),
      },
    )
    if (!res.ok) return null
    const json = (await res.json()) as {
      result?: string
      success?: boolean
    }
    if (!json.success || typeof json.result !== "string") return null
    return json.result
  } catch {
    return null
  }
}
