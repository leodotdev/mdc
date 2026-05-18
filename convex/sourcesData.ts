import { v } from "convex/values"
import { internalQuery, mutation, query } from "./_generated/server"
import { requireEditor } from "./lib/guard"

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireEditor(ctx)
    return await ctx.db.query("sources").collect()
  },
})

// Internal-only — no editor gate. Called from `runMegaDeskInternal`
// when the run is triggered by cron (which has no auth identity).
// The editor-facing /admin/sources page uses `list` above.
export const listInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("sources").collect()
  },
})

export const get = query({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => {
    await requireEditor(ctx)
    return await ctx.db.get(sourceId)
  },
})

export const getForAdapter = query({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => {
    // Called from within `agents.runDesk` action context — that action
    // is itself editor-gated; the underlying query does not double-check
    // because actions don't have an authenticated identity for runQuery
    // calls invoked from within the action handler.
    const s = await ctx.db.get(sourceId)
    if (!s) return null
    return { type: s.type, url: s.url, config: s.config }
  },
})

// SSRF guard for editor-supplied source URLs. Blocks IP literals,
// localhost, link-local, and private RFC1918 ranges so a malicious
// URL can't probe internal infra. Special-cased schemes:
//   - http://, https://: must resolve to public DNS (we don't DNS
//     here; we just block raw-IP and known private hostnames).
//   - bluesky://, at://: the bluesky adapter's own URL convention.
//   - everything else: rejected.
function assertSafeSourceUrl(url: string, type: string): void {
  // Bluesky uses its own URL convention; the adapter constructs the
  // actual HTTPS endpoint internally. No SSRF surface.
  if (type === "bluesky") {
    if (!/^bluesky:\/\//i.test(url) && !/^at:\/\//i.test(url)) {
      throw new Error("Bluesky source URLs must start with bluesky:// or at://")
    }
    return
  }
  // YouTube source URLs are channel handles or playlist IDs handled
  // server-side, not arbitrary URLs.
  if (type === "youtube") return
  // Wikipedia-OTD / data adapters may use specific URL schemes.
  if (type === "wikipedia-otd") return

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Source URL is not a valid URL: ${url}`)
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Only http(s) source URLs allowed, got ${parsed.protocol}`)
  }
  const host = parsed.hostname.toLowerCase()
  // Block IP literals (v4 + v6) — we want named hosts only so
  // someone can't supply 127.0.0.1, 169.254.169.254, etc.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) {
    throw new Error(`IP-literal source URLs not allowed: ${host}`)
  }
  // Block obvious internal hostnames.
  const blocked = [
    "localhost",
    "localhost.localdomain",
    "metadata.google.internal",
  ]
  if (blocked.includes(host)) {
    throw new Error(`Internal hostname not allowed: ${host}`)
  }
  if (host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error(`Internal hostname not allowed: ${host}`)
  }
}

export const create = mutation({
  args: {
    name: v.string(),
    type: v.union(
      v.literal("rss"),
      v.literal("reddit"),
      v.literal("youtube"),
      v.literal("x"),
      v.literal("bluesky"),
      v.literal("web"),
      v.literal("wikipedia-otd"),
      v.literal("ics"),
      v.literal("data"),
    ),
    url: v.string(),
    sectionIds: v.array(v.id("sections")),
    enabled: v.boolean(),
    config: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await requireEditor(ctx)
    assertSafeSourceUrl(args.url, args.type)
    return await ctx.db.insert("sources", args)
  },
})

export const update = mutation({
  args: {
    sourceId: v.id("sources"),
    name: v.optional(v.string()),
    url: v.optional(v.string()),
    sectionIds: v.optional(v.array(v.id("sections"))),
    enabled: v.optional(v.boolean()),
    config: v.optional(v.any()),
  },
  handler: async (ctx, { sourceId, ...patch }) => {
    await requireEditor(ctx)
    if (patch.url !== undefined) {
      const existing = await ctx.db.get(sourceId)
      if (!existing) throw new Error("Source not found")
      assertSafeSourceUrl(patch.url, existing.type)
    }
    const cleaned: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) cleaned[key] = value
    }
    if (Object.keys(cleaned).length > 0) {
      await ctx.db.patch(sourceId, cleaned)
    }
  },
})

export const remove = mutation({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => {
    await requireEditor(ctx)
    await ctx.db.delete(sourceId)
  },
})

export const recordFetch = mutation({
  args: {
    sourceId: v.id("sources"),
    status: v.string(),
    error: v.optional(v.string()),
    items: v.array(
      v.object({
        externalId: v.string(),
        url: v.string(),
        title: v.string(),
        snippet: v.optional(v.string()),
        body: v.optional(v.string()),
        mediaUrl: v.optional(v.string()),
        publishedAt: v.optional(v.number()),
        recurrenceRule: v.optional(v.string()),
        startsAt: v.optional(v.number()),
        endsAt: v.optional(v.number()),
        locationName: v.optional(v.string()),
        locationAddress: v.optional(v.string()),
        allDay: v.optional(v.boolean()),
        price: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { sourceId, status, error, items }) => {
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
        recurrenceRule: item.recurrenceRule,
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
    // Track consecutive error count for auto-disable. Reset to 0 on
    // successful fetches so a temporary outage doesn't trip the cap.
    const existingSource = await ctx.db.get(sourceId)
    const prevErrors = existingSource?.consecutiveErrors ?? 0
    const consecutiveErrors = status === "ok" ? 0 : prevErrors + 1
    // Permanent-failure shortcut: 404 / 410 / 403 mean the URL is gone
    // or auth-walled — no point waiting for the consecutive-errors cap.
    // Disable on the first occurrence so the next fetch tick doesn't
    // burn time on a known-dead feed.
    const errStr = error ?? ""
    const permanentlyGone =
      status === "error" &&
      /(?:→|\b|: )(?:HTTP )?40[34]\b/.test(errStr) ||
      /\b410\b/.test(errStr)
    const patch: Record<string, unknown> = {
      lastFetchedAt: now,
      lastFetchStatus: status,
      lastFetchError: error,
      lastFetchItemCount: items.length,
      lastFetchNewCount: inserted,
      consecutiveErrors,
    }
    if (permanentlyGone) {
      patch.enabled = false
      patch.autoDisabledAt = now
      patch.autoDisabledReason = `permanent failure: ${errStr.slice(0, 120)}`
    }
    await ctx.db.patch(sourceId, patch)
    return { inserted, autoDisabled: !!permanentlyGone }
  },
})
