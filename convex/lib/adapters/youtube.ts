import type { RawItem, SourceForAdapter } from "./types"

type YouTubeConfig = { kind?: "channel" | "playlist"; max?: number }

export async function fetchYouTube(
  source: SourceForAdapter,
): Promise<Array<RawItem>> {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) throw new Error("YOUTUBE_API_KEY is not set in Convex env")

  const cfg = (source.config as YouTubeConfig | undefined) ?? {}
  const max = Math.min(cfg.max ?? 15, 50)

  // source.url can be: a channel id (UC...), a handle (@something),
  // a playlist id (PL...), or a full youtube channel URL.
  let playlistId: string | null = null

  const raw = source.url.trim()
  if (raw.startsWith("PL") || raw.startsWith("UU")) {
    playlistId = raw
  } else if (raw.startsWith("UC")) {
    // Channel id → uploads playlist is "UU" + the rest
    playlistId = "UU" + raw.slice(2)
  } else {
    // Resolve handle / URL → channel id via search.list
    const handle = raw.replace(/^https?:\/\/(www\.)?youtube\.com\//, "").replace(/^@/, "")
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(
      handle,
    )}&maxResults=1&key=${apiKey}`
    const sr = await fetch(searchUrl)
    if (!sr.ok) throw new Error(`YouTube channel resolve → ${sr.status}`)
    const sj = (await sr.json()) as {
      items?: Array<{ id?: { channelId?: string } }>
    }
    const cid = sj.items?.[0]?.id?.channelId
    if (!cid) throw new Error(`Could not resolve YouTube channel "${raw}"`)
    playlistId = "UU" + cid.slice(2)
  }

  const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${playlistId}&maxResults=${max}&key=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`YouTube ${playlistId} → ${res.status}`)
  const json = (await res.json()) as {
    items?: Array<{
      id?: string
      snippet?: {
        title?: string
        description?: string
        publishedAt?: string
        thumbnails?: { high?: { url?: string }; default?: { url?: string } }
        resourceId?: { videoId?: string }
      }
      contentDetails?: { videoId?: string }
    }>
  }
  return (json.items ?? [])
    .map((item): RawItem | null => {
      const videoId =
        item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId
      const title = item.snippet?.title
      if (!videoId || !title) return null
      const publishedAt = item.snippet?.publishedAt
        ? Date.parse(item.snippet.publishedAt)
        : undefined
      return {
        externalId: `yt_${videoId}`,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title,
        snippet: item.snippet?.description?.slice(0, 400),
        body: item.snippet?.description,
        mediaUrl:
          item.snippet?.thumbnails?.high?.url ??
          item.snippet?.thumbnails?.default?.url,
        publishedAt: Number.isFinite(publishedAt) ? publishedAt : undefined,
      }
    })
    .filter((x): x is RawItem => x !== null)
}
