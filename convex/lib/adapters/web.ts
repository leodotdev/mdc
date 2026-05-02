import type { RawItem, SourceForAdapter } from "./types"

// Generic web-page adapter. Fetches the URL and returns a single RawItem
// with title from <title>/og:title and a snippet from og:description.
// The agent prompt does the rest of the extraction.

function metaContent(html: string, prop: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
    "i",
  )
  const m = html.match(re)
  return m?.[1]
}

function titleTag(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return m?.[1]?.trim()
}

export async function fetchWeb(source: SourceForAdapter): Promise<Array<RawItem>> {
  const res = await fetch(source.url, {
    headers: { "user-agent": "miami.community/1.0 (+https://miami.community)" },
  })
  if (!res.ok) throw new Error(`Web ${source.url} → ${res.status}`)
  const html = await res.text()
  const title =
    metaContent(html, "og:title") ??
    titleTag(html) ??
    source.url
  const desc =
    metaContent(html, "og:description") ?? metaContent(html, "description")
  const image = metaContent(html, "og:image")
  return [
    {
      externalId: source.url,
      url: source.url,
      title,
      snippet: desc?.slice(0, 400),
      body: desc,
      mediaUrl: image,
      publishedAt: Date.now(),
    },
  ]
}
