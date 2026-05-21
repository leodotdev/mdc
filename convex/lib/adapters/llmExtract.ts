import { generatePageEventExtraction } from "../llm"
import type { RawItem, SourceForAdapter } from "./types"

// LLM-extract adapter — for venue pages that describe events in text
// but expose no JSON-LD (or any structured markup). Fetches the page,
// strips it to a text snapshot, hands it to Haiku 4.5 with a tight
// "find events" tool schema, and ingests whatever concrete events the
// model finds.
//
// Cost: ~$0.005 per fetch. The ingest pipeline gates the call against
// the daily LLM budget before invoking this adapter, so a busy day
// won't blow past the cap.
//
// Failure modes the adapter handles cleanly:
//   - Page 4xx/5xx → throws (consumed by the per-source try/catch)
//   - Haiku returns no events → returns []
//   - Haiku invents an event with no usable startsAt → filtered out
//     by validation in lib/llm.ts before items reach the pipeline

const MIAMI_TZ = "America/New_York"
const PAGE_TEXT_CAP = 8000

// Lightweight HTML → text. Strips scripts/styles/SVG entirely, then
// collapses tags into whitespace and decodes a small set of named
// entities. Not perfect; we just need recognizable event copy for
// Haiku to read.
function htmlToText(html: string): string {
  const stripped = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, " ")
    .replace(/<[^>]+>/g, " ")
  return decode(stripped).replace(/\s+/g, " ").trim()
}

function decode(s: string): string {
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

function todayMiamiIso(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MIAMI_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .split("-")
  return `${parts[0]}-${parts[1]}-${parts[2]}`
}

export async function fetchLlmExtract(
  source: SourceForAdapter,
): Promise<Array<RawItem>> {
  const res = await fetch(source.url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (compatible; miami-community-bot/1.0; +https://miami.community)",
      accept: "text/html,application/xhtml+xml",
    },
  })
  if (!res.ok) throw new Error(`llm-extract ${source.url} → ${res.status}`)
  const html = await res.text()
  const pageText = htmlToText(html).slice(0, PAGE_TEXT_CAP)
  if (pageText.length < 100) return []

  const extracted = await generatePageEventExtraction({
    model: "claude-haiku-4-5-20251001",
    pageUrl: source.url,
    pageText,
    todayIso: todayMiamiIso(),
  })
  if (!extracted) return []

  const items: Array<RawItem> = []
  for (const e of extracted) {
    const startsAt = Date.parse(e.startsAtIso)
    if (!Number.isFinite(startsAt)) continue
    // Skip past events — Haiku occasionally re-extracts archived
    // listings. 24h grace so an event happening earlier today still
    // makes it through.
    if (startsAt < Date.now() - 24 * 3_600_000) continue
    const endsAt = e.endsAtIso ? Date.parse(e.endsAtIso) : undefined
    const eventUrl = e.url ?? source.url
    // Stable externalId so re-runs dedup against the same item.
    const slug = e.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
    const dayKey = new Date(startsAt).toISOString().slice(0, 10)
    items.push({
      externalId: `llm_${dayKey}_${slug}`,
      url: eventUrl,
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
