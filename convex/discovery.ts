// Source discovery — surfaces candidate publishers we haven't yet
// added to the sources table. Walks the last 14d of events, pulls
// every citation URL (and the event's own `url`), groups by hostname,
// and writes any host that isn't already a source as a row on
// `sourceSuggestions`.
//
// Editors approve or dismiss from /admin/sources. Approving runs
// `sources.probe` + `sourcesData.installSource` so the suggestion
// becomes a live source in one click.

import { v } from "convex/values"
import {
  internalAction,
  internalMutation,
  mutation,
  query,
} from "./_generated/server"
import { internal } from "./_generated/api"
import { requireEditor } from "./lib/guard"

const DISCOVERY_WINDOW_MS = 14 * 24 * 3_600_000
const MAX_SAMPLE_URLS = 5

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase()
  } catch {
    return null
  }
}

// One pass over recent events → fold every citation/event URL into a
// per-domain accumulator → upsert sourceSuggestions rows.
export const weeklyTick = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    candidates: number
    inserted: number
    updated: number
  }> => {
    return await ctx.runMutation(internal.discovery.runDiscovery, {})
  },
})

export const runDiscovery = internalMutation({
  args: {},
  handler: async (ctx) => {
    // We only consider events in the trailing 14d for "fresh"
    // discovery candidates. With the `by_status_published` index
    // ordered desc we just walk the head and break once we cross
    // the window — but at this scale (≤2k events) a full take()
    // is simpler.
    void DISCOVERY_WINDOW_MS
    const events = await ctx.db
      .query("events")
      .withIndex("by_status_published", (q) => q.eq("status", "approved"))
      .order("desc")
      .take(2000)
    // Existing source hostnames — skip these.
    const sources = await ctx.db.query("sources").collect()
    const sourceHosts = new Set<string>()
    for (const s of sources) {
      const h = hostnameOf(s.url)
      if (h) sourceHosts.add(h)
    }
    // Domains where suggesting them is noise (link shorteners,
    // ticket marketplaces aggregating other sources, social media).
    const SKIP_HOSTS = new Set<string>([
      "eventbrite.com",
      "facebook.com",
      "fb.com",
      "fb.me",
      "instagram.com",
      "twitter.com",
      "x.com",
      "t.co",
      "bit.ly",
      "tinyurl.com",
      "ow.ly",
      "linktr.ee",
      "linkedin.com",
      "google.com",
      "youtube.com",
      "youtu.be",
      "spotify.com",
      "apple.com",
      "tickets.com",
      "ticketmaster.com",
      "seatgeek.com",
      "stubhub.com",
      "vivid-seats.com",
      "axs.com",
      "evite.com",
    ])
    type Stat = {
      sampleUrls: Array<string>
      eventCount: number
      firstSeenAt: number
      lastSeenAt: number
    }
    const stats = new Map<string, Stat>()
    for (const e of events) {
      const urls: Array<string> = []
      if (e.url) urls.push(e.url)
      for (const c of e.citations ?? []) {
        if (c.url) urls.push(c.url)
      }
      const ts = e.publishedAt ?? e.createdAt
      const seenForEvent = new Set<string>()
      for (const u of urls) {
        const host = hostnameOf(u)
        if (!host) continue
        if (sourceHosts.has(host)) continue
        if (SKIP_HOSTS.has(host)) continue
        if (seenForEvent.has(host)) continue
        seenForEvent.add(host)
        const stat = stats.get(host) ?? {
          sampleUrls: [],
          eventCount: 0,
          firstSeenAt: ts,
          lastSeenAt: ts,
        }
        stat.eventCount += 1
        if (stat.sampleUrls.length < MAX_SAMPLE_URLS) {
          stat.sampleUrls.push(u)
        }
        stat.firstSeenAt = Math.min(stat.firstSeenAt, ts)
        stat.lastSeenAt = Math.max(stat.lastSeenAt, ts)
        stats.set(host, stat)
      }
    }
    let inserted = 0
    let updated = 0
    for (const [domain, stat] of stats) {
      const existing = await ctx.db
        .query("sourceSuggestions")
        .withIndex("by_domain", (q) => q.eq("domain", domain))
        .unique()
      if (existing) {
        // Don't reopen dismissed suggestions — the editor said no.
        if (existing.status === "dismissed") continue
        await ctx.db.patch(existing._id, {
          sampleUrls: stat.sampleUrls.slice(0, MAX_SAMPLE_URLS),
          eventCount: stat.eventCount,
          lastSeenAt: stat.lastSeenAt,
        })
        updated += 1
      } else {
        await ctx.db.insert("sourceSuggestions", {
          domain,
          sampleUrls: stat.sampleUrls,
          eventCount: stat.eventCount,
          firstSeenAt: stat.firstSeenAt,
          lastSeenAt: stat.lastSeenAt,
          status: "pending",
        })
        inserted += 1
      }
    }
    return { candidates: stats.size, inserted, updated }
  },
})

// Editor-facing list. Sorted by eventCount desc — the heaviest-hit
// domains rise to the top so the editor's time goes to the
// highest-yield candidates.
export const listSuggestions = query({
  args: { status: v.optional(v.string()) },
  handler: async (ctx, { status }) => {
    await requireEditor(ctx)
    const all = await ctx.db.query("sourceSuggestions").collect()
    const filtered = status
      ? all.filter((s) => s.status === status)
      : all.filter((s) => s.status === "pending")
    return filtered.sort((a, b) => b.eventCount - a.eventCount)
  },
})

export const dismissSuggestion = mutation({
  args: { suggestionId: v.id("sourceSuggestions") },
  handler: async (ctx, { suggestionId }) => {
    await requireEditor(ctx)
    await ctx.db.patch(suggestionId, { status: "dismissed" })
  },
})

export const approveSuggestion = mutation({
  args: { suggestionId: v.id("sourceSuggestions") },
  handler: async (ctx, { suggestionId }) => {
    await requireEditor(ctx)
    await ctx.db.patch(suggestionId, { status: "approved" })
  },
})
