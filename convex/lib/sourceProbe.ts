// One-shot probe that fetches a URL and decides which adapter type
// should drive it. Replaces the old `inferAdapterType(url)` cascade
// which never returned `llm-extract` and silently broke any source
// edited away from a recognizable structured URL.
//
// Returns one of the adapter type literals, plus a few flags so the
// admin UI can give the editor an honest signal — including
// `blocked` when the page is fronted by Cloudflare's anti-bot
// interstitial (those return HTTP 200 with a wall page, so without
// content sniffing we'd otherwise count them as healthy fetches).
//
// Heuristics, in priority order:
//   1. URL pattern → ics / miami-new-times / sitemap-events.
//   2. Body sniff → events-html when JSON-LD Event blocks exist,
//      otherwise llm-extract.
//   3. Body sniff → "blocked" when Cloudflare / Imperva / DataDome
//      anti-bot interstitial markers are present.
//
// Pure data — UI / mutation code unwraps the result and decides what
// to do (set type, install, surface a warning, etc.).

import type { AdapterType } from "./adapters/types"

export type ProbeResult = {
  adapter: AdapterType
  blocked: boolean
  /** HTTP status from the fetch. -1 if network error. */
  status: number
  /** Where the probe heuristic landed — short token for logs/UI. */
  reason: string
  /** Title scraped from <title> or og:site_name, when present. Used by
   *  the smart-add form to auto-name a source. */
  suggestedName?: string
}

// URL-pattern fingerprints. Cheap; runs before the fetch.
function adapterFromUrlPattern(url: string): AdapterType | null {
  const u = url.toLowerCase()
  if (u.includes("miaminewtimes.com/eventsearch")) return "miami-new-times"
  if (
    u.includes("?ical=1") ||
    u.includes("&ical=1") ||
    u.endsWith(".ics") ||
    u.includes(".ics?") ||
    u.includes("icalendar.aspx") ||
    u.includes("feed=calendar")
  ) {
    return "ics"
  }
  if (u.endsWith("/sitemap.xml") || u.endsWith("/sitemap_index.xml")) {
    return "sitemap-events"
  }
  return null
}

// Cloudflare / Imperva / DataDome interstitial fingerprints. All three
// can return HTTP 200 with a JS-challenge page that has zero useful
// content — `lastFetchStatus: "ok"` on those is a lie.
const BLOCKED_FINGERPRINTS: ReadonlyArray<RegExp> = [
  /<title>Attention Required! \| Cloudflare<\/title>/i,
  /\bcdn-cgi\/challenge-platform\b/i,
  /\b__cf_chl\b/i,
  /Cloudflare Ray ID/i,
  /Imperva Incapsula/i,
  /Incapsula incident ID/i,
  /\b_Incapsula_Resource\b/i,
  /\bdatadome\b/i,
  /\bperimeterx\b/i,
  /<title>Just a moment\.\.\.<\/title>/i,
  /Checking your browser before accessing/i,
]

function isBlocked(html: string): boolean {
  // Only test the first 16KB — interstitials are small. Saves regex
  // cycles when the page is a normal 1MB document.
  const head = html.slice(0, 16_000)
  return BLOCKED_FINGERPRINTS.some((re) => re.test(head))
}

function countJsonLdEvents(html: string): number {
  // Quick regex count of `"@type":"Event"`. Doesn't validate the JSON
  // — adapters/eventsHtml.ts does the real parse — just enough to
  // know "this page exposes Event JSON-LD" vs not.
  const matches = html.match(/"@type"\s*:\s*"(?:Sport)?Event"/gi)
  return matches ? matches.length : 0
}

function hasIcalAlternate(html: string): boolean {
  return /<link[^>]+rel=["']alternate["'][^>]+type=["']text\/calendar["']/i.test(
    html,
  )
}

function suggestedNameFromHtml(html: string, url: string): string {
  const og = html.match(
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
  )
  if (og) return decodeEntities(og[1].trim())
  const tt = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  if (tt) {
    const t = decodeEntities(tt[1].trim())
    // Title often includes " | Sitename" — pick the shorter half.
    const parts = t.split(/[|·—]/).map((p) => p.trim()).filter(Boolean)
    if (parts.length > 1) return parts[parts.length - 1]
    return t
  }
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#38;/g, "&")
    .replace(/&#038;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
}

export async function probeUrl(url: string): Promise<ProbeResult> {
  // 1. URL pattern wins immediately — no need to fetch a .ics body to
  // know it's an iCal.
  const patternHit = adapterFromUrlPattern(url)
  if (patternHit) {
    return {
      adapter: patternHit,
      blocked: false,
      status: 0,
      reason: `pattern:${patternHit}`,
    }
  }

  // 2. Fetch the page once. Use a friendly UA so well-behaved sites
  // don't flag us; Cloudflare-walled ones will still 200 a challenge
  // page that the body sniffer catches.
  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; miami-community-bot/1.0; +https://miami.community)",
        accept: "text/html,application/xhtml+xml",
      },
    })
  } catch (e) {
    return {
      adapter: "llm-extract",
      blocked: false,
      status: -1,
      reason: `fetch-error:${e instanceof Error ? e.message.slice(0, 60) : "unknown"}`,
    }
  }

  if (!res.ok) {
    return {
      adapter: "llm-extract",
      blocked: false,
      status: res.status,
      reason: `http:${res.status}`,
    }
  }

  const html = await res.text()
  const suggestedName = suggestedNameFromHtml(html, url)

  // 3. Blocked? Surface that — caller can choose to flip the source
  // to browser-extract or disable it.
  if (isBlocked(html)) {
    return {
      adapter: "browser-extract",
      blocked: true,
      status: res.status,
      reason: "blocked:cloudflare-or-similar",
      suggestedName,
    }
  }

  // 4. Body fingerprints.
  if (hasIcalAlternate(html)) {
    return {
      adapter: "ics",
      blocked: false,
      status: res.status,
      reason: "body:ical-alternate",
      suggestedName,
    }
  }
  const eventBlocks = countJsonLdEvents(html)
  if (eventBlocks >= 3) {
    return {
      adapter: "events-html",
      blocked: false,
      status: res.status,
      reason: `body:jsonld-${eventBlocks}-events`,
      suggestedName,
    }
  }

  // 5. Fallback — text-only pages go to Haiku.
  return {
    adapter: "llm-extract",
    blocked: false,
    status: res.status,
    reason: "fallback:llm-extract",
    suggestedName,
  }
}
