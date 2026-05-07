import type { RawItem, SourceForAdapter } from "./types"

// Bluesky author-feed adapter. Pulls the most recent posts from a single
// account using the public AppView XRPC endpoint — no auth required for
// public posts. Reposts are filtered out (they don't carry their own URL
// in a useful way for our pipeline).
//
// Source URL conventions:
//   bluesky://miamiherald.bsky.social
//   bluesky://localten.com (custom-domain handles work too)
// We normalize either form to the handle and call:
//   https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed
//     ?actor=<handle>&limit=30&filter=posts_no_replies

const ENDPOINT = "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed"
const DEFAULT_LIMIT = 30

type BskyEmbedImage = { thumb?: string; fullsize?: string }
type BskyEmbedExternal = {
  uri?: string
  thumb?: string
  title?: string
  description?: string
}
type BskyEmbed = {
  $type?: string
  images?: ReadonlyArray<BskyEmbedImage>
  external?: BskyEmbedExternal
  media?: { external?: BskyEmbedExternal; images?: ReadonlyArray<BskyEmbedImage> }
}

type BskyPost = {
  uri: string
  cid: string
  author?: { handle?: string; displayName?: string }
  record?: { text?: string; createdAt?: string }
  embed?: BskyEmbed
  indexedAt?: string
}

type BskyFeedItem = {
  post?: BskyPost
  reason?: { $type?: string }
}

type BskyResponse = {
  feed?: ReadonlyArray<BskyFeedItem>
}

function handleFromUrl(url: string): string {
  // bluesky://handle  →  handle
  // also accept https://bsky.app/profile/handle
  const stripped = url.replace(/^bluesky:\/\//i, "")
  const profileMatch = stripped.match(
    /https?:\/\/bsky\.app\/profile\/([^/?#]+)/i,
  )
  if (profileMatch) return profileMatch[1]
  return stripped.split(/[/?#]/)[0]
}

// Convert at:// URI to a clickable bsky.app permalink.
//   at://did:plc:abc/app.bsky.feed.post/123 → bsky.app/profile/<handle>/post/123
function permalinkFor(post: BskyPost): string {
  const handle = post.author?.handle ?? "unknown"
  const rkey = post.uri.split("/").pop() ?? ""
  return `https://bsky.app/profile/${handle}/post/${rkey}`
}

function thumbnailFor(post: BskyPost): string | undefined {
  const e = post.embed
  if (!e) return undefined
  if (e.images && e.images.length > 0) {
    return e.images[0].thumb ?? e.images[0].fullsize
  }
  if (e.media?.images && e.media.images.length > 0) {
    return e.media.images[0].thumb ?? e.media.images[0].fullsize
  }
  if (e.external?.thumb) return e.external.thumb
  return undefined
}

export async function fetchBluesky(
  source: SourceForAdapter,
): Promise<Array<RawItem>> {
  const handle = handleFromUrl(source.url)
  if (!handle) return []
  const params = new URLSearchParams({
    actor: handle,
    limit: String(DEFAULT_LIMIT),
    filter: "posts_no_replies",
  })
  const res = await fetch(`${ENDPOINT}?${params.toString()}`)
  if (!res.ok) {
    throw new Error(`Bluesky fetch ${handle}: HTTP ${res.status}`)
  }
  const json = (await res.json()) as BskyResponse
  const feed = json.feed ?? []

  const items: Array<RawItem> = []
  for (const entry of feed) {
    const post = entry.post
    if (!post || entry.reason?.$type === "app.bsky.feed.defs#reasonRepost") {
      continue
    }
    const text = post.record?.text?.trim()
    if (!text) continue
    const url = permalinkFor(post)
    const externalLink = post.embed?.external?.uri ?? post.embed?.media?.external?.uri
    // Use the post's permalink as our canonical URL; if the post links
    // out (e.g. quoting an article), surface the link target as the body
    // so the mega-desk can use it as a citation hint.
    const body = externalLink ? `${text}\n\nLinked: ${externalLink}` : text
    const publishedAt = post.record?.createdAt
      ? Date.parse(post.record.createdAt)
      : post.indexedAt
        ? Date.parse(post.indexedAt)
        : undefined
    items.push({
      externalId: post.uri,
      url,
      // Bluesky posts don't have headlines — synthesize one from the
      // first sentence so the dedupe + ranking layers have something
      // to compare. The mega-desk will rewrite during drafting.
      title: text.split(/(?<=[.!?])\s/)[0].slice(0, 140),
      snippet: text.slice(0, 280),
      body,
      mediaUrl: thumbnailFor(post),
      publishedAt: Number.isFinite(publishedAt) ? publishedAt : undefined,
    })
  }
  return items
}
