import { v } from "convex/values"

import { internal } from "./_generated/api"
import {
  internalAction,
  internalMutation,
  query,
} from "./_generated/server"
import { estimatedCallCents } from "./lib/budget"
import { generateWidgetBatch } from "./lib/llm"
import type { WidgetEntry } from "./lib/llm"

// =====================================================================
// Local stats — single query returning four data shapes the right-rail
// carousel renders as separate slides. Computed live each request from
// our own publication record:
//   - storiesPerDay: published-articles count per day, last 14 days
//   - topSources: publishers cited most this week (top 5)
//   - sectionMix: top sections by published count this week (top 6)
//   - upcomingEventsBySection: approved events this month by section
//
// Single query (one subscription) keeps the carousel cheap. Bounded by
// 200-row scans; for higher volumes we'd add a denormalized counter.
// =====================================================================
export const localStats = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    const fourteenDays = 14 * day
    const weekAgo = now - 7 * day
    const monthAhead = now + 30 * day

    // ─── stories per day, last 14 days ───
    const recentArticles = await ctx.db
      .query("articles")
      .withIndex("by_status_published", (q) => q.eq("status", "published"))
      .order("desc")
      .take(300)
    const dayBuckets = new Array<number>(14).fill(0)
    const since = now - fourteenDays
    for (const a of recentArticles) {
      const ts = a.publishedAt ?? a.createdAt
      if (ts < since) break
      const daysAgo = Math.floor((now - ts) / day)
      if (daysAgo < 0 || daysAgo > 13) continue
      dayBuckets[13 - daysAgo] += 1
    }
    const totalStories14d = dayBuckets.reduce((a, b) => a + b, 0)

    // ─── top sources cited this week ───
    const weekArticles = recentArticles.filter(
      (a) => (a.publishedAt ?? a.createdAt) >= weekAgo,
    )
    const sourceCount = new Map<string, number>()
    for (const a of weekArticles) {
      const seen = new Set<string>()
      for (const c of a.citations ?? []) {
        const name = (c.publisher ?? "")
          .replace(/\s*\((?:RSS|YouTube|podcast|ICS)\)\s*$/i, "")
          .trim()
        if (!name) continue
        const key = name.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        sourceCount.set(name, (sourceCount.get(name) ?? 0) + 1)
      }
    }
    const topSources = Array.from(sourceCount.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)

    // ─── coverage mix by section, this week ───
    const sectionCount = new Map<
      string,
      { name: string; accent: string; count: number }
    >()
    for (const a of weekArticles) {
      const section = await ctx.db.get(a.sectionId)
      if (!section) continue
      // Roll children up to the trunk so the slide reads as the news
      // taxonomy, not the leaf taxonomy.
      const trunk = section.parentId
        ? (await ctx.db.get(section.parentId)) ?? section
        : section
      const key = trunk.slug
      const existing = sectionCount.get(key)
      if (existing) {
        existing.count += 1
      } else {
        sectionCount.set(key, {
          name: trunk.name,
          accent: trunk.accentColor,
          count: 1,
        })
      }
    }
    const sectionMix = Array.from(sectionCount.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)

    // ─── upcoming events this month by section ───
    const upcomingEvents = await ctx.db
      .query("events")
      .withIndex("by_status_starts", (q) =>
        q.eq("status", "approved").gte("startsAt", now).lt("startsAt", monthAhead),
      )
      .take(200)
    const eventSectionCount = new Map<
      string,
      { name: string; accent: string; count: number }
    >()
    for (const e of upcomingEvents) {
      // events.sectionId is optional in the schema (legacy migration
      // tolerance) — skip if missing.
      if (!e.sectionId) continue
      const section = await ctx.db.get(e.sectionId)
      if (!section) continue
      const trunk = section.parentId
        ? (await ctx.db.get(section.parentId)) ?? section
        : section
      const key = trunk.slug
      const existing = eventSectionCount.get(key)
      if (existing) {
        existing.count += 1
      } else {
        eventSectionCount.set(key, {
          name: trunk.name,
          accent: trunk.accentColor,
          count: 1,
        })
      }
    }
    const upcomingEventsBySection = Array.from(eventSectionCount.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)

    return {
      storiesPerDay: dayBuckets,
      totalStories14d,
      topSources,
      sectionMix,
      upcomingEventsCount: upcomingEvents.length,
      upcomingEventsBySection,
      generatedAt: now,
    }
  },
})

// Daily-rotating right-rail widgets. The cron at 04:00 ET fires
// `dailyRefresh`, which calls Opus once and writes one row per kind
// produced. Public reads come through `current()` — the most-recent
// row per kind. Old rows stick around as history; nothing prunes
// them, but the table grows by ~5 rows/day = ~1825/year = trivial.

const KINDS = [
  "fun-fact",
  "on-this-day",
  "landmark",
  "animal-fact",
  "quote",
] as const

const WIDGET_MODEL = "claude-opus-4-7"

// Public — most-recent entry per kind. Returns one map keyed by kind.
// Skipped kinds (the LLM omitted them on the latest run) fall back to
// the previous run's entry automatically because we sort desc and take
// the first match.
export const current = query({
  args: {},
  handler: async (ctx) => {
    const result: Record<string, {
      _id: unknown
      kind: string
      title: string
      body: string
      attribution?: string
      imageHint?: string
      imageUrl?: string
      generatedAt: number
    }> = {}
    for (const kind of KINDS) {
      const row = await ctx.db
        .query("widgetContent")
        .withIndex("by_kind_generated", (q) => q.eq("kind", kind))
        .order("desc")
        .first()
      if (row) result[kind] = row
    }
    return result
  },
})

export const insertEntries = internalMutation({
  args: {
    entries: v.array(
      v.object({
        kind: v.union(
          v.literal("fun-fact"),
          v.literal("on-this-day"),
          v.literal("landmark"),
          v.literal("animal-fact"),
          v.literal("quote"),
        ),
        title: v.string(),
        body: v.string(),
        attribution: v.optional(v.string()),
        imageHint: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { entries }) => {
    const now = Date.now()
    for (const e of entries) {
      await ctx.db.insert("widgetContent", {
        kind: e.kind,
        title: e.title,
        body: e.body,
        attribution: e.attribution,
        imageHint: e.imageHint,
        generatedAt: now,
      })
    }
    return { inserted: entries.length }
  },
})

// Daily Opus call. Single batched request produces all five widget
// entries in one shot (~7-12¢). The model can omit a kind when it
// can't generate a verifiable entry — the omitted kind keeps showing
// the previous day's row.
export const dailyRefresh = internalAction({
  args: {},
  handler: async (ctx): Promise<{ inserted: number; skipped: Array<string> }> => {
    // Budget gate. Daily widget refresh is expected to be ~10¢ — well
    // under cap, but we still book it so the system's spend accounting
    // includes widget runs alongside mega-desk runs.
    const reservation = await ctx.runMutation(internal.budget.reserve, {
      estimatedCents: estimatedCallCents(WIDGET_MODEL),
      label: "widgetsDailyRefresh",
    })
    if (!reservation.allowed) {
      return { inserted: 0, skipped: ["budget-cap"] }
    }

    const now = new Date()
    const todayIso = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now)
    const monthName = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      month: "long",
    }).format(now)

    const entries: Array<WidgetEntry> = await generateWidgetBatch({
      model: WIDGET_MODEL,
      todayIso,
      monthName,
    })
    if (entries.length === 0) {
      return { inserted: 0, skipped: ["llm-empty"] }
    }
    await ctx.runMutation(internal.widgets.insertEntries, {
      entries: entries.map((e) => ({
        kind: e.kind,
        title: e.title,
        body: e.body,
        attribution: e.attribution ?? undefined,
        imageHint: e.imageHint ?? undefined,
      })),
    })
    const seen = new Set(entries.map((e) => e.kind))
    const skipped = KINDS.filter((k) => !seen.has(k))
    return { inserted: entries.length, skipped }
  },
})
