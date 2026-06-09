// Browser-rendered llm-extract. Identical contract to llmExtract.ts
// — fetch a page, strip to text, hand to Haiku — but pulls the HTML
// through a headless-Chromium service so Cloudflare / DataDome /
// Imperva-walled venues are reachable.
//
// Configured via env:
//   - CLOUDFLARE_ACCOUNT_ID  (Cloudflare account UUID)
//   - CLOUDFLARE_BROWSER_TOKEN  (API token with Browser Rendering:Edit)
//
// When either is missing, falls back to the regular `fetch()` path
// — the adapter still works, it just can't bypass anti-bot walls.
// Cost: ~$0.09 per 1k renders on Cloudflare Browser Rendering, plus
// the ~$0.005 Haiku call. Gated against the daily LLM budget in
// agents.ts upstream so a flood of browser-extract sources can't
// blow past the cap.

import { fetchLlmExtract } from "./llmExtract"
import type { RawItem, SourceForAdapter } from "./types"

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID
const CF_BROWSER_TOKEN = process.env.CLOUDFLARE_BROWSER_TOKEN

async function renderViaCloudflare(url: string): Promise<string | null> {
  if (!CF_ACCOUNT_ID || !CF_BROWSER_TOKEN) return null
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/browser-rendering/content`
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${CF_BROWSER_TOKEN}`,
      },
      body: JSON.stringify({
        url,
        // Pages with Cloudflare walls usually need a second to settle.
        waitForTimeout: 2000,
      }),
    })
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

export async function fetchBrowserExtract(
  source: SourceForAdapter,
): Promise<Array<RawItem>> {
  // Try the rendered path first; fall back to plain fetch if the
  // service isn't configured or the call fails. Plain-fetch fallback
  // means a misconfigured env doesn't break sources outright — they
  // just behave like regular llm-extract.
  const rendered = await renderViaCloudflare(source.url)
  if (rendered !== null) {
    // The llmExtract adapter does its own fetch. Re-use its pipeline
    // by passing the pre-rendered HTML through a synthetic Response.
    // Cheaper than re-implementing the same htmlToText + Haiku call.
    return await llmExtractFromHtml(source.url, rendered)
  }
  // Fallback path — same behavior as a plain llm-extract source.
  return await fetchLlmExtract(source)
}

// Minimal duplicate of llmExtract's body-handling so the rendered
// HTML doesn't have to round-trip through another fetch. Kept inline
// here rather than refactoring llmExtract because that adapter ships
// its own end-to-end test path.
async function llmExtractFromHtml(
  url: string,
  html: string,
): Promise<Array<RawItem>> {
  const { generatePageEventExtraction } = await import("../llm")
  const PAGE_TEXT_CAP = 8000
  const stripped = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, " ")
    .replace(/<[^>]+>/g, " ")
  const pageText = stripped.replace(/\s+/g, " ").trim().slice(0, PAGE_TEXT_CAP)
  if (pageText.length < 100) return []
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
  const extracted = await generatePageEventExtraction({
    model: "claude-haiku-4-5-20251001",
    pageUrl: url,
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
      externalId: `browser_${dayKey}_${slug}`,
      url: e.url ?? url,
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
