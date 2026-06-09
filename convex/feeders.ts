// Structured-API feeders. These pull Miami events from third-party
// APIs that already return well-formed JSON, bypassing the
// scrape-and-LLM-extract path. Each feeder:
//
//   1. Reads its env key (SEATGEEK_CLIENT_ID, TICKETMASTER_API_KEY)
//   2. Fetches today + the next 60 days of Miami events
//   3. Upserts a per-feeder source row so the queue + admin UI track
//      its health like any other source
//   4. Writes RawItems via `recordFetch` — the regular ingest drain
//      turns them into live events on its next tick
//
// Cost: free tier on both APIs. Daily rate limits are ample for our
// volume (SeatGeek: unlimited; Ticketmaster: 5k calls/day). Code
// no-ops cleanly when the env key isn't configured, so a fresh deploy
// without keys still ships.

import { v } from "convex/values"
import { internal } from "./_generated/api"
import { internalAction, internalMutation } from "./_generated/server"

const FEEDER_SOURCES = {
  seatgeek: {
    url: "feeder://seatgeek/miami",
    name: "SeatGeek — Miami (API feeder)",
  },
  ticketmaster: {
    url: "feeder://ticketmaster/miami",
    name: "Ticketmaster — Miami (API feeder)",
  },
  bluesky: {
    url: "feeder://bluesky/miami",
    name: "Bluesky — Miami posts (search feeder)",
  },
  reddit: {
    url: "feeder://reddit/miami",
    name: "Reddit — Miami subreddits (RSS feeder)",
  },
} as const

// Find-or-create the feeder's pseudo source row. The URL field is a
// `feeder://` scheme that won't collide with any real URL, so the
// adapter dispatch never tries to scrape it.
export const ensureFeederSource = internalMutation({
  args: {
    kind: v.union(
      v.literal("seatgeek"),
      v.literal("ticketmaster"),
      v.literal("bluesky"),
      v.literal("reddit"),
    ),
  },
  handler: async (ctx, { kind }) => {
    const meta = FEEDER_SOURCES[kind]
    const existing = await ctx.db
      .query("sources")
      .filter((q) => q.eq(q.field("url"), meta.url))
      .first()
    if (existing) return existing._id
    return await ctx.db.insert("sources", {
      name: meta.name,
      // Use llm-extract as a no-op type — the source's `url` starts
      // with `feeder://` so the cron's adapter dispatch will skip it.
      // Feeder actions write items directly via recordFetch.
      type: "llm-extract",
      url: meta.url,
      enabled: true,
    })
  },
})

// ── SeatGeek ───────────────────────────────────────────────────────────
// https://platform.seatgeek.com/  — venue.city=miami catches Marlins,
// Heat, Inter Miami, Hard Rock concerts, Kaseya shows, etc.
export const seatgeekTick = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    fetched: number
    inserted: number
    error?: string
  }> => {
    const clientId = process.env.SEATGEEK_CLIENT_ID
    if (!clientId) return { fetched: 0, inserted: 0, error: "no SEATGEEK_CLIENT_ID" }
    const sourceId = await ctx.runMutation(
      internal.feeders.ensureFeederSource,
      { kind: "seatgeek" },
    )
    try {
      const url = `https://api.seatgeek.com/2/events?venue.city=miami&per_page=100&sort=datetime_local.asc&client_id=${clientId}`
      const res = await fetch(url, { headers: { accept: "application/json" } })
      if (!res.ok) throw new Error(`seatgeek ${res.status}`)
      const json = (await res.json()) as {
        events?: Array<{
          id: number
          title?: string
          short_title?: string
          datetime_local?: string
          datetime_utc?: string
          url?: string
          venue?: {
            name?: string
            address?: string
            extended_address?: string
            city?: string
            state?: string
            location?: { lat: number; lon: number }
          }
          stats?: { lowest_price?: number; average_price?: number }
        }>
      }
      const items = (json.events ?? [])
        .map((e) => mapSeatgeekEvent(e))
        .filter((x): x is NonNullable<typeof x> => x !== null)
      const result = await ctx.runMutation(internal.feeders.recordItems, {
        sourceId,
        items,
      })
      return { fetched: items.length, inserted: result.inserted }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await ctx.runMutation(internal.feeders.recordItems, {
        sourceId,
        items: [],
        error: msg,
      })
      return { fetched: 0, inserted: 0, error: msg }
    }
  },
})

function mapSeatgeekEvent(e: {
  id: number
  title?: string
  short_title?: string
  datetime_local?: string
  datetime_utc?: string
  url?: string
  venue?: {
    name?: string
    address?: string
    extended_address?: string
    city?: string
    state?: string
  }
  stats?: { lowest_price?: number; average_price?: number }
}) {
  const title = e.short_title ?? e.title
  const startISO = e.datetime_utc ?? e.datetime_local
  if (!title || !startISO) return null
  const startsAt = Date.parse(startISO)
  if (!Number.isFinite(startsAt)) return null
  if (startsAt < Date.now() - 24 * 3_600_000) return null
  const venue = e.venue
  const locationAddress = venue
    ? [venue.address, venue.extended_address, venue.city, venue.state]
        .filter(Boolean)
        .join(", ") || undefined
    : undefined
  const price = (() => {
    const lo = e.stats?.lowest_price
    if (lo === 0) return "Free"
    if (typeof lo === "number") return `From $${lo}`
    return undefined
  })()
  return {
    externalId: `seatgeek_${e.id}`,
    url: e.url ?? `https://seatgeek.com/e/${e.id}`,
    title,
    snippet: undefined,
    body: undefined,
    publishedAt: startsAt,
    startsAt,
    endsAt: undefined,
    locationName: venue?.name,
    locationAddress,
    allDay: false,
    price,
  }
}

// ── Ticketmaster ──────────────────────────────────────────────────────
// Discovery API:  https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
// 5k requests/day on the free tier; our 3x/day cron uses 3.
export const ticketmasterTick = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    fetched: number
    inserted: number
    error?: string
  }> => {
    const apiKey = process.env.TICKETMASTER_API_KEY
    if (!apiKey) return { fetched: 0, inserted: 0, error: "no TICKETMASTER_API_KEY" }
    const sourceId = await ctx.runMutation(
      internal.feeders.ensureFeederSource,
      { kind: "ticketmaster" },
    )
    try {
      const startISO = new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
      const endISO = new Date(Date.now() + 60 * 24 * 3_600_000)
        .toISOString()
        .replace(/\.\d{3}Z$/, "Z")
      const params = new URLSearchParams({
        apikey: apiKey,
        city: "Miami",
        countryCode: "US",
        size: "100",
        sort: "date,asc",
        startDateTime: startISO,
        endDateTime: endISO,
      })
      const url = `https://app.ticketmaster.com/discovery/v2/events.json?${params.toString()}`
      const res = await fetch(url, { headers: { accept: "application/json" } })
      if (!res.ok) throw new Error(`ticketmaster ${res.status}`)
      const json = (await res.json()) as {
        _embedded?: {
          events?: Array<{
            id: string
            name?: string
            url?: string
            dates?: {
              start?: { dateTime?: string; localDate?: string }
            }
            priceRanges?: Array<{ min?: number; max?: number; currency?: string }>
            images?: Array<{ url?: string; ratio?: string; width?: number }>
            _embedded?: {
              venues?: Array<{
                name?: string
                address?: { line1?: string }
                city?: { name?: string }
                state?: { stateCode?: string }
                postalCode?: string
              }>
            }
          }>
        }
      }
      const events = json._embedded?.events ?? []
      const items = events
        .map((e) => mapTicketmasterEvent(e))
        .filter((x): x is NonNullable<typeof x> => x !== null)
      const result = await ctx.runMutation(internal.feeders.recordItems, {
        sourceId,
        items,
      })
      return { fetched: items.length, inserted: result.inserted }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await ctx.runMutation(internal.feeders.recordItems, {
        sourceId,
        items: [],
        error: msg,
      })
      return { fetched: 0, inserted: 0, error: msg }
    }
  },
})

function mapTicketmasterEvent(e: {
  id: string
  name?: string
  url?: string
  dates?: { start?: { dateTime?: string; localDate?: string } }
  priceRanges?: Array<{ min?: number; max?: number; currency?: string }>
  images?: Array<{ url?: string; ratio?: string; width?: number }>
  _embedded?: {
    venues?: Array<{
      name?: string
      address?: { line1?: string }
      city?: { name?: string }
      state?: { stateCode?: string }
      postalCode?: string
    }>
  }
}) {
  const title = e.name
  const startISO = e.dates?.start?.dateTime ?? e.dates?.start?.localDate
  if (!title || !startISO) return null
  const startsAt = Date.parse(startISO)
  if (!Number.isFinite(startsAt)) return null
  if (startsAt < Date.now() - 24 * 3_600_000) return null
  const venue = e._embedded?.venues?.[0]
  const locationAddress = venue
    ? [
        venue.address?.line1,
        venue.city?.name,
        venue.state?.stateCode,
        venue.postalCode,
      ]
        .filter(Boolean)
        .join(", ") || undefined
    : undefined
  const price = (() => {
    const r = e.priceRanges?.[0]
    if (!r) return undefined
    if (r.min === 0) return "Free"
    if (typeof r.min === "number") return `From $${r.min}`
    return undefined
  })()
  // Pick the widest 16:9 image as the hero, fall back to first one.
  const mediaUrl = (() => {
    const images = e.images ?? []
    const wide = images.find((i) => i.ratio === "16_9" && (i.width ?? 0) >= 640)
    return wide?.url ?? images[0]?.url
  })()
  return {
    externalId: `ticketmaster_${e.id}`,
    url: e.url ?? `https://www.ticketmaster.com/event/${e.id}`,
    title,
    snippet: undefined,
    body: undefined,
    mediaUrl,
    publishedAt: startsAt,
    startsAt,
    endsAt: undefined,
    locationName: venue?.name,
    locationAddress,
    allDay: false,
    price,
  }
}

// ── Shared write path ─────────────────────────────────────────────────
// Wraps recordFetch but keeps the bookkeeping similar so feeders show
// up as healthy sources in /admin/sources.
export const recordItems = internalMutation({
  args: {
    sourceId: v.id("sources"),
    items: v.array(
      v.object({
        externalId: v.string(),
        url: v.string(),
        title: v.string(),
        snippet: v.optional(v.string()),
        body: v.optional(v.string()),
        mediaUrl: v.optional(v.string()),
        publishedAt: v.optional(v.number()),
        startsAt: v.optional(v.number()),
        endsAt: v.optional(v.number()),
        locationName: v.optional(v.string()),
        locationAddress: v.optional(v.string()),
        allDay: v.optional(v.boolean()),
        price: v.optional(v.string()),
      }),
    ),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { sourceId, items, error }) => {
    const now = Date.now()
    let inserted = 0
    for (const item of items) {
      const existing = await ctx.db
        .query("ingestedItems")
        .withIndex("by_source_external", (q) =>
          q.eq("sourceId", sourceId).eq("externalId", item.externalId),
        )
        .unique()
      if (existing) continue
      await ctx.db.insert("ingestedItems", {
        sourceId,
        externalId: item.externalId,
        url: item.url,
        title: item.title,
        snippet: item.snippet,
        body: item.body,
        mediaUrl: item.mediaUrl,
        publishedAt: item.publishedAt,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        locationName: item.locationName,
        locationAddress: item.locationAddress,
        allDay: item.allDay,
        price: item.price,
        fetchedAt: now,
        consumed: false,
      })
      inserted += 1
    }
    const status = error ? "error" : "ok"
    const existingSource = await ctx.db.get(sourceId)
    const prevErrors = existingSource?.consecutiveErrors ?? 0
    const consecutiveErrors = status === "ok" ? 0 : prevErrors + 1
    await ctx.db.patch(sourceId, {
      lastFetchedAt: now,
      lastFetchStatus: status,
      lastFetchError: error,
      lastFetchItemCount: items.length,
      lastFetchNewCount: inserted,
      consecutiveErrors,
    })
    return { inserted }
  },
})

// ── Bluesky (free, no-auth getAuthorFeed) ────────────────────────────
// Bluesky's `searchPosts` endpoint requires authentication, but
// `getAuthorFeed` on the public.api.bsky.app proxy works without a
// token. So we pull recent posts from a curated list of Miami
// accounts (newsrooms, venues, BIDs), event-filter the text, and
// hand each candidate to Haiku for structured extraction.
//
// Editor maintains the handle list below. To add: drop the
// `handle.bsky.social` (or custom domain) into BLUESKY_HANDLES.
const BLUESKY_HANDLES: ReadonlyArray<string> = [
  "miamiherald.com",
  "wlrn.org",
]

export const blueskyTick = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    posts: number
    extracted: number
    inserted: number
    error?: string
  }> => {
    const sourceId = await ctx.runMutation(
      internal.feeders.ensureFeederSource,
      { kind: "bluesky" },
    )
    try {
      const allPosts: Array<{ text: string; uri: string; createdAt: string }> = []
      for (const handle of BLUESKY_HANDLES) {
        const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=25`
        const res = await fetch(url, {
          headers: { accept: "application/json" },
        })
        if (!res.ok) continue
        const json = (await res.json()) as {
          feed?: Array<{
            post?: {
              uri?: string
              record?: { text?: string; createdAt?: string }
            }
          }>
        }
        for (const entry of json.feed ?? []) {
          const post = entry.post
          const text = post?.record?.text
          const createdAt = post?.record?.createdAt
          if (!text || !post?.uri || !createdAt) continue
          if (!looksLikeEvent(text)) continue
          allPosts.push({ text, uri: post.uri, createdAt })
        }
      }
      // Dedupe by URI in case multiple handles repost the same item.
      const seen = new Set<string>()
      const unique = allPosts.filter((p) => {
        if (seen.has(p.uri)) return false
        seen.add(p.uri)
        return true
      })
      const { extracted, inserted } = await extractFromText(
        ctx,
        sourceId,
        unique.map((p) => ({
          text: p.text,
          contextUrl: bskyUriToWebUrl(p.uri),
          stableId: `bsky:${p.uri}`,
        })),
        "bluesky",
      )
      return { posts: unique.length, extracted, inserted }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await ctx.runMutation(internal.feeders.recordItems, {
        sourceId,
        items: [],
        error: msg,
      })
      return { posts: 0, extracted: 0, inserted: 0, error: msg }
    }
  },
})

function bskyUriToWebUrl(uri: string): string {
  // at://did:plc:.../app.bsky.feed.post/abc123 → https://bsky.app/profile/did/post/abc123
  const m = uri.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)/)
  if (!m) return "https://bsky.app/"
  return `https://bsky.app/profile/${m[1]}/post/${m[2]}`
}

// ── Reddit (free RSS per subreddit) ──────────────────────────────────
// Reddit's per-subreddit RSS is public — no key required. Pulls the
// latest posts, regex-filters to event-shaped titles, sends the post
// body through Haiku for structured event extraction. Same Haiku
// budget as llm-extract sources.
const REDDIT_SUBREDDITS = [
  "Miami",
  "MiamiBeach",
  "MiamiHurricanes",
  "MiamiHeat",
  "Marlins",
  "InterMiamiCF",
] as const

export const redditTick = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    posts: number
    extracted: number
    inserted: number
    error?: string
  }> => {
    const sourceId = await ctx.runMutation(
      internal.feeders.ensureFeederSource,
      { kind: "reddit" },
    )
    try {
      const allPosts: Array<{ text: string; url: string; stableId: string }> = []
      for (const sub of REDDIT_SUBREDDITS) {
        // .json instead of .rss because Reddit's JSON returns selftext
        // (the full body) which llm-extract needs. User-agent matters —
        // generic agents get 429'd. Public, no auth.
        const url = `https://www.reddit.com/r/${sub}/new.json?limit=25`
        const res = await fetch(url, {
          headers: {
            "user-agent":
              "miami.community-bot/1.0 (https://miami.community)",
            accept: "application/json",
          },
        })
        if (!res.ok) continue
        const json = (await res.json()) as {
          data?: {
            children?: Array<{
              data?: {
                title?: string
                selftext?: string
                permalink?: string
                id?: string
                stickied?: boolean
              }
            }>
          }
        }
        for (const c of json.data?.children ?? []) {
          const d = c.data
          if (!d?.title || !d.id) continue
          if (d.stickied) continue
          const text = `${d.title}\n\n${d.selftext ?? ""}`
          if (!looksLikeEvent(text)) continue
          allPosts.push({
            text,
            url: `https://www.reddit.com${d.permalink ?? ""}`,
            stableId: `reddit:${sub}:${d.id}`,
          })
        }
      }
      const { extracted, inserted } = await extractFromText(
        ctx,
        sourceId,
        allPosts.map((p) => ({
          text: p.text,
          contextUrl: p.url,
          stableId: p.stableId,
        })),
        "reddit",
      )
      return { posts: allPosts.length, extracted, inserted }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await ctx.runMutation(internal.feeders.recordItems, {
        sourceId,
        items: [],
        error: msg,
      })
      return { posts: 0, extracted: 0, inserted: 0, error: msg }
    }
  },
})

// ── Shared text→event extraction ─────────────────────────────────────
// Cheap regex filter so we don't burn Haiku on "buying a car in Miami"
// posts. Requires at least one date / time / event-y verb to pass.
function looksLikeEvent(text: string): boolean {
  if (text.length < 40) return false
  const eventy =
    /\b(tonight|tomorrow|this\s+weekend|saturday|sunday|friday|thursday|monday|tuesday|wednesday|tickets?|RSVP|free\s+(?:event|show|admission)|opening|kickoff|doors\s+(?:open|at)|happy\s+hour|live\s+(?:music|band|dj)|pop[\s-]up|festival|concert|exhibit(?:ion)?|screening|matinee|premiere|\d{1,2}\s*(?::\d{2})?\s*(?:am|pm)|\d{1,2}\/\d{1,2})\b/i
  return eventy.test(text)
}

import type { ActionCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
async function extractFromText(
  ctx: ActionCtx,
  sourceId: Id<"sources">,
  posts: ReadonlyArray<{ text: string; contextUrl: string; stableId: string }>,
  prefix: string,
): Promise<{ extracted: number; inserted: number }> {
  if (posts.length === 0) {
    await ctx.runMutation(internal.feeders.recordItems, {
      sourceId,
      items: [],
    })
    return { extracted: 0, inserted: 0 }
  }
  const { generatePageEventExtraction } = await import("./lib/llm")
  const todayIso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
  // Budget check — one reservation per post.
  const { estimatedCallCents } = await import("./lib/budget")
  const cost = estimatedCallCents("claude-haiku-4-5-20251001")
  const items: Array<{
    externalId: string
    url: string
    title: string
    snippet?: string
    body?: string
    publishedAt?: number
    startsAt?: number
    endsAt?: number
    locationName?: string
    locationAddress?: string
    price?: string
  }> = []
  let extracted = 0
  for (const p of posts) {
    const reservation = await ctx.runMutation(internal.budget.reserve, {
      estimatedCents: cost,
      label: `feeder:${prefix}`,
    })
    if (!reservation.allowed) break
    const result = await generatePageEventExtraction({
      model: "claude-haiku-4-5-20251001",
      pageUrl: p.contextUrl,
      pageText: p.text.slice(0, 4000),
      todayIso,
    })
    if (!result) continue
    for (const e of result) {
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
        externalId: `${p.stableId}_${dayKey}_${slug}`,
        url: e.url ?? p.contextUrl,
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
      extracted += 1
    }
  }
  const result = await ctx.runMutation(internal.feeders.recordItems, {
    sourceId,
    items,
  })
  return { extracted, inserted: result.inserted }
}
