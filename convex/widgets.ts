import { v } from "convex/values"

import { internal } from "./_generated/api"
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server"
import { estimatedCallCents } from "./lib/budget"
import { cronsEnabled } from "./lib/cronGate"
import { generateWidgetBacklog, generateWidgetBatch } from "./lib/llm"
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

// Sonnet handles the daily 5-widget batch perfectly well; the previous
// Opus default added ~15¢/day for no quality gain.
const WIDGET_MODEL = "claude-sonnet-4-6"

// Public — most-recent entry per kind. Returns one map keyed by kind.
// Skipped kinds (the LLM omitted them on the latest run) fall back to
// the previous run's entry automatically because we sort desc and take
// the first match.
// Last N entries for a given widget kind, newest first. Lets the
// public widgets surface chevron buttons so a reader can cycle back
// through earlier days' fun-facts / landmarks / wildlife / quotes.
// Index 0 of the returned array = latest (today's entry); higher
// indices walk backward through the history.
export const recentByKind = query({
  args: {
    kind: v.union(
      v.literal("fun-fact"),
      v.literal("on-this-day"),
      v.literal("landmark"),
      v.literal("animal-fact"),
      v.literal("quote"),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { kind, limit }) => {
    const cap = Math.max(1, Math.min(limit ?? 30, 90))
    const rows = await ctx.db
      .query("widgetContent")
      .withIndex("by_kind_generated", (q) => q.eq("kind", kind))
      .order("desc")
      .take(cap)
    return rows.map((row) => ({
      _id: row._id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      attribution: row.attribution,
      imageHint: row.imageHint,
      imageUrl: row.imageUrl,
      generatedAt: row.generatedAt,
    }))
  },
})

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
    // Dedupe-on-insert. The fun-fact widget uses a generic title
    // ("Did you know") on every row, so we have to dedupe by body
    // for that kind; for the others (landmark, animal-fact,
    // on-this-day, quote), the title carries the unique identifier
    // and is more reliable than body — bodies can vary slightly even
    // when the underlying entity is the same. So: dedupe by title
    // first; if the kind's title is generic (fun-fact), fall back
    // to body. We also dedupe by body across all kinds as a second
    // line of defense — protects against the LLM rewording the same
    // fact under different titles.
    const now = Date.now()
    let inserted = 0
    let skipped = 0
    const norm = (s: string) =>
      s.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200)
    type Caches = { titles: Set<string>; bodies: Set<string> }
    const cacheByKind = new Map<string, Caches>()
    const usesGenericTitle = (kind: string) => kind === "fun-fact"
    for (const e of entries) {
      let cache = cacheByKind.get(e.kind)
      if (!cache) {
        const rows = await ctx.db
          .query("widgetContent")
          .withIndex("by_kind_generated", (q) => q.eq("kind", e.kind))
          .order("desc")
          .take(200)
        cache = {
          titles: new Set(rows.map((r) => norm(r.title))),
          bodies: new Set(rows.map((r) => norm(r.body))),
        }
        cacheByKind.set(e.kind, cache)
      }
      const titleKey = norm(e.title)
      const bodyKey = norm(e.body)
      const isDup = usesGenericTitle(e.kind)
        ? cache.bodies.has(bodyKey)
        : cache.titles.has(titleKey) || cache.bodies.has(bodyKey)
      if (isDup) {
        skipped += 1
        continue
      }
      cache.titles.add(titleKey)
      cache.bodies.add(bodyKey)
      await ctx.db.insert("widgetContent", {
        kind: e.kind,
        title: e.title,
        body: e.body,
        attribution: e.attribution,
        imageHint: e.imageHint,
        generatedAt: now,
      })
      inserted += 1
    }
    return { inserted, skipped }
  },
})

// Returns the most-recent N titles for one kind. Used by the backlog
// generator to tell the LLM which titles it must NOT repeat.
export const recentTitlesByKind = internalQuery({
  args: {
    kind: v.union(
      v.literal("fun-fact"),
      v.literal("on-this-day"),
      v.literal("landmark"),
      v.literal("animal-fact"),
      v.literal("quote"),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { kind, limit }) => {
    const cap = Math.max(1, Math.min(limit ?? 100, 200))
    const rows = await ctx.db
      .query("widgetContent")
      .withIndex("by_kind_generated", (q) => q.eq("kind", kind))
      .order("desc")
      .take(cap)
    return rows.map((r) => r.title)
  },
})

// Daily Opus call. Single batched request produces all five widget
// entries in one shot (~7-12¢). The model can omit a kind when it
// can't generate a verifiable entry — the omitted kind keeps showing
// the previous day's row.
export const dailyRefresh = internalAction({
  args: {},
  handler: async (ctx): Promise<{ inserted: number; skipped: Array<string> }> => {
    if (!cronsEnabled()) {
      return { inserted: 0, skipped: ["crons-disabled"] }
    }
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

// =====================================================================
// One-shot backlog seed. Pre-populates the right-rail history so the
// chevron navigation has 30 entries per kind from day one rather than
// waiting 30 days for the daily cron to accumulate. Skips kinds that
// already have ≥ targetCount entries; safe to re-run.
//
// Cost: 5 Sonnet calls (one per kind), ~10-15¢ each → ~50-75¢
// one-time. Each call passes the existing titles so the model knows
// what NOT to repeat, and the insertEntries mutation also dedupes by
// title as a belt-and-suspenders.
//
// Editor-triggered manually:
//   `npx convex run widgets:seedBacklog --prod`
// =====================================================================
const BACKLOG_MODEL = "claude-sonnet-4-6"
const BACKLOG_TARGET = 30

export const seedBacklog = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    perKind: Record<
      string,
      {
        existing: number
        generated: number
        inserted: number
        skipped: number
        sampleTitle?: string
        sampleBody?: string
      }
    >
    totalInserted: number
  }> => {
    const result: Record<
      string,
      {
        existing: number
        generated: number
        inserted: number
        skipped: number
        sampleTitle?: string
        sampleBody?: string
      }
    > = {}
    let totalInserted = 0
    for (const kind of KINDS) {
      const existingTitles = await ctx.runQuery(
        internal.widgets.recentTitlesByKind,
        { kind, limit: 100 },
      )
      const need = Math.max(0, BACKLOG_TARGET - existingTitles.length)
      if (need === 0) {
        result[kind] = {
          existing: existingTitles.length,
          generated: 0,
          inserted: 0,
          skipped: 0,
        }
        continue
      }
      // No budget gate — this is an editor-triggered one-shot
      // backlog seed. Cost is bounded (5 Sonnet calls, ~50-75¢ total)
      // and predictable; gating it behind the daily mega-desk cap
      // would block the seed for whole days at a time.
      const generated = await generateWidgetBacklog({
        model: BACKLOG_MODEL,
        kind,
        count: need,
        existingTitles,
      })
      console.log(
        `[seedBacklog] ${kind}: LLM returned ${generated.length} entries. First:`,
        generated[0]
          ? `title="${generated[0].title}" body="${generated[0].body.slice(0, 100)}"`
          : "(none)",
      )
      const insertResult = await ctx.runMutation(
        internal.widgets.insertEntries,
        {
          entries: generated.map((e) => ({
            kind: e.kind,
            title: e.title,
            body: e.body,
            attribution: e.attribution ?? undefined,
            imageHint: e.imageHint ?? undefined,
          })),
        },
      )
      result[kind] = {
        existing: existingTitles.length,
        generated: generated.length,
        inserted: insertResult.inserted,
        skipped: insertResult.skipped,
        sampleTitle: generated[0]?.title,
        sampleBody: generated[0]?.body?.slice(0, 120),
      }
      totalInserted += insertResult.inserted
    }
    return { perKind: result, totalInserted }
  },
})
