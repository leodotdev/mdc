import type { RawItem, SourceForAdapter } from "./types"

type RedditConfig = { listing?: "hot" | "new" | "top" | "rising"; limit?: number }

export async function fetchReddit(
  source: SourceForAdapter,
): Promise<Array<RawItem>> {
  const cfg = (source.config as RedditConfig | undefined) ?? {}
  const listing = cfg.listing ?? "hot"
  const limit = cfg.limit ?? 25

  // source.url is the subreddit slug e.g. "Miami" or "r/Miami" or full URL
  const sub = source.url.replace(/^https?:\/\/(www\.)?reddit\.com\//, "").replace(/^r\//, "").replace(/\/$/, "")
  const url = `https://www.reddit.com/r/${sub}/${listing}.json?limit=${limit}`

  const res = await fetch(url, {
    headers: { "user-agent": "miami.community:v1.0 (by /u/miamicommunity)" },
  })
  if (!res.ok) throw new Error(`Reddit ${sub} → ${res.status}`)
  const json = (await res.json()) as {
    data?: { children?: Array<{ data?: Record<string, unknown> }> }
  }
  const children = json.data?.children ?? []
  return children
    .map((child): RawItem | null => {
      const d = child.data
      if (!d) return null
      const id = typeof d.id === "string" ? d.id : ""
      const permalink = typeof d.permalink === "string" ? d.permalink : ""
      const title = typeof d.title === "string" ? d.title : ""
      if (!id || !permalink || !title) return null
      const isSelf = d.is_self === true
      const url = isSelf
        ? `https://www.reddit.com${permalink}`
        : typeof d.url === "string"
          ? d.url
          : `https://www.reddit.com${permalink}`
      const selftext = typeof d.selftext === "string" ? d.selftext : undefined
      const created =
        typeof d.created_utc === "number"
          ? Math.round(d.created_utc * 1000)
          : undefined
      const thumb = typeof d.thumbnail === "string" ? d.thumbnail : undefined
      return {
        externalId: `reddit_${id}`,
        url,
        title,
        snippet: selftext?.slice(0, 400),
        body: selftext,
        mediaUrl:
          thumb && thumb.startsWith("http") ? thumb : undefined,
        publishedAt: created,
      }
    })
    .filter((x): x is RawItem => x !== null)
}
