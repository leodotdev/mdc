import { v } from "convex/values"

import { api, internal } from "./_generated/api"
import {
  action,
  internalAction,
  internalMutation,
  mutation,
  query,
} from "./_generated/server"
import { cleanTags } from "./agents"
import { attachParentAccent } from "./articles"
import { compareByImportance } from "./lib/scoring"
import { requireEditor } from "./lib/guard"
import { estimatedCallCents } from "./lib/budget"
import { cronsEnabled } from "./lib/cronGate"
import { requireEditorInAction } from "./lib/guard"
import { generateEventTranslation } from "./lib/llm"
import { findHeroCandidates } from "./lib/media"
import { filterNeighborhoodSlugs } from "./lib/neighborhoods"
import type { HeroCandidate, HeroFinderDiagnostics } from "./lib/media"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"

const heroSourceValidator = v.union(
  v.literal("source"),
  v.literal("unsplash"),
  v.literal("wikimedia"),
  v.literal("none"),
)

const citationValidator = v.object({
  url: v.string(),
  title: v.string(),
  publisher: v.optional(v.string()),
  fetchedAt: v.number(),
  snippet: v.optional(v.string()),
})

// Hard ceiling on candidate scans for time-windowed queries — bounds query
// work even if the volume balloons.
const SCAN_CAP = 500

// Maximal write shape from `insertExtracted`. Mirrors articles in the
// fields it accepts. All fields except title/description/startsAt/allDay
// are optional so the LLM can omit pieces it didn't extract.
//
// Phase-1 additions (events-as-primary): `dek`, `body`, `kind`, and
// `videoEmbed` carry the newspaper-style editorial treatment that used
// to live on the articles table. `kind="reported"` events have full
// dek+body; `kind="scheduled"` events usually leave them empty.
const eventInputValidator = v.object({
  slug: v.optional(v.string()),
  title: v.string(),
  description: v.string(),
  dek: v.optional(v.string()),
  body: v.optional(v.string()),
  kind: v.optional(
    v.union(v.literal("scheduled"), v.literal("reported")),
  ),
  videoEmbed: v.optional(
    v.object({
      provider: v.union(v.literal("youtube"), v.literal("vimeo")),
      id: v.string(),
    }),
  ),
  startsAt: v.number(),
  endsAt: v.optional(v.number()),
  allDay: v.boolean(),
  locationName: v.optional(v.string()),
  locationAddress: v.optional(v.string()),
  neighborhoods: v.optional(v.array(v.string())),
  url: v.optional(v.string()),
  heroImage: v.optional(v.string()),
  heroCaption: v.optional(v.string()),
  heroSource: v.optional(heroSourceValidator),
  price: v.optional(v.string()),
  sectionId: v.optional(v.id("sections")),
  tags: v.optional(v.array(v.string())),
  relatedArticleIds: v.optional(v.array(v.id("articles"))),
  relatedEventIds: v.optional(v.array(v.id("events"))),
  citations: v.optional(v.array(citationValidator)),
})

// ───────── Helpers ─────────

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

// Day-stamped tail prevents same-titled events from colliding (e.g. weekly
// markets). Only added when needed — base slug wins when free.
async function uniqueSlug(
  ctx: { db: MutationCtx["db"] },
  base: string,
  startsAt: number,
  excludeId?: Id<"events">,
): Promise<string> {
  const root = slugify(base) || "event"
  const existing = await ctx.db
    .query("events")
    .withIndex("by_slug", (q) => q.eq("slug", root))
    .first()
  if (!existing || existing._id === excludeId) return root
  const day = new Date(startsAt).toISOString().slice(0, 10)
  const dated = `${root}-${day}`.slice(0, 80)
  const datedHit = await ctx.db
    .query("events")
    .withIndex("by_slug", (q) => q.eq("slug", dated))
    .first()
  if (!datedHit || datedHit._id === excludeId) return dated
  // Final tiebreaker: append a short random suffix.
  const suffix = Math.random().toString(36).slice(2, 6)
  return `${root}-${suffix}`.slice(0, 80)
}

function buildSearchableText(
  title: string,
  description: string,
  tags: ReadonlyArray<string> = [],
  dek?: string,
  body?: string,
): string {
  return [title, dek ?? "", description, body ?? "", tags.join(" ")]
    .filter(Boolean)
    .join(" ")
}

// Cheap djb2 hash of an event's EN copy. Stored as
// `translations.es.sourceHash` so we can detect EN drift and flag the
// row for re-translation. Mirrors articles.articleSourceHash.
function eventSourceHash(event: {
  title: string
  description: string
}): string {
  const s = `${event.title}|${event.description}`
  let h = 5381
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}

async function hydrate(ctx: QueryCtx, event: Doc<"events">) {
  const rawSection = event.sectionId
    ? await ctx.db.get(event.sectionId)
    : null
  const section = await attachParentAccent(ctx, rawSection)
  // Surface the first related article publicly when it's published — events
  // can link to multiple stories via relatedArticleIds[], but the public
  // shape exposes one (the canonical "related story") for convenience.
  // Older code using `event.article` keeps working.
  const firstRelatedId = event.relatedArticleIds?.[0]
  const article = firstRelatedId ? await ctx.db.get(firstRelatedId) : null
  const publishedArticle =
    article && article.status === "published"
      ? { _id: article._id, slug: article.slug, title: article.title }
      : null
  // Public surface guarantees a non-empty slug. Legacy rows that pre-
  // date the slug column fall back to the document id so cards still
  // route somewhere predictable.
  const slug = event.slug ?? (event._id as string)
  return { ...event, slug, section, article: publishedArticle }
}

// ───────── Public queries ─────────

/**
 * Approved events between [startsAt, endsAt). Used by the public /events page
 * for week / list / month views. Optional `sectionSlug` narrows to one
 * section — the same axis section pages use.
 */
/**
 * Full-text search across approved events. Uses the `by_searchable`
 * index on `searchableText` (title + description + tags). Caller can
 * narrow to a single section via `sectionSlug`. Returns up to `limit`
 * hydrated events ordered by relevance.
 */
export const search = query({
  args: {
    query: v.string(),
    sectionSlug: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { query: q, sectionSlug, limit }) => {
    const trimmed = q.trim()
    if (trimmed.length < 2) return []
    const cap = Math.min(Math.max(limit ?? 20, 1), 60)
    let sectionId: Id<"sections"> | null = null
    if (sectionSlug) {
      const section = await ctx.db
        .query("sections")
        .withIndex("by_slug", (qx) => qx.eq("slug", sectionSlug))
        .first()
      if (!section) return []
      sectionId = section._id
    }
    const events = await ctx.db
      .query("events")
      .withSearchIndex("by_searchable", (qx) => {
        const base = qx.search("searchableText", trimmed).eq("status", "approved")
        return sectionId ? base.eq("sectionId", sectionId) : base
      })
      .take(cap)
    return await Promise.all(events.map((e) => hydrate(ctx, e)))
  },
})

export const inRange = query({
  args: {
    rangeStart: v.number(),
    rangeEnd: v.number(),
    sectionSlug: v.optional(v.string()),
  },
  handler: async (ctx, { rangeStart, rangeEnd, sectionSlug }) => {
    const events = await ctx.db
      .query("events")
      .withIndex("by_status_starts", (q) =>
        q
          .eq("status", "approved")
          .gte("startsAt", rangeStart)
          .lt("startsAt", rangeEnd),
      )
      .order("asc")
      .take(SCAN_CAP)
    let filtered = events
    if (sectionSlug) {
      const section = await ctx.db
        .query("sections")
        .withIndex("by_slug", (q) => q.eq("slug", sectionSlug))
        .first()
      if (!section) return []
      filtered = filtered.filter((e) => e.sectionId === section._id)
    }
    return await Promise.all(filtered.map((e) => hydrate(ctx, e)))
  },
})

// ───────── Newspaper-style queries ─────────
// Phase-1 events-only pivot: these queries mirror the article-side
// shape (articles.latest / topStories / topInSection / listBySection /
// listByNeighborhood / listByTag) so the homepage and section pages
// can swap article queries for event queries without reshaping their
// consumers. `recentVideos` briefly lived here to drive /watch — the
// route was retired in the section-restructure pass, and video embeds
// now render inline on event pages alongside the hero image.

// Scan ceiling for ranking queries — same shape as articles, large
// enough that a 7-day window of importance-ranked events isn't
// truncated even on a busy news day.
const TOP_EVENTS_SCAN = 200

// `ScorableArticle`-compatible adapter for events. The events table's
// `derivedFromItems` + `citations` are optional, but the scoring
// helper expects arrays — default to empty so the comparator works
// without throwing on legacy rows.
function asScorable(e: Doc<"events">): {
  derivedFromItems: ReadonlyArray<unknown>
  citations: ReadonlyArray<unknown>
  tags?: ReadonlyArray<string>
  title?: string
  publishedAt?: number
  createdAt: number
} {
  return {
    derivedFromItems: e.derivedFromItems ?? [],
    citations: e.citations ?? [],
    tags: e.tags ?? [],
    title: e.title,
    publishedAt: e.publishedAt,
    createdAt: e.createdAt,
  }
}

// Latest approved events sorted by publishedAt DESC — the newspaper's
// chronological feed. Mirrors `articles.latest`.
export const latestEditorial = query({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const events = await ctx.db
      .query("events")
      .withIndex("by_status_published", (q) => q.eq("status", "approved"))
      .order("desc")
      .take(limit)
    return await Promise.all(events.map((e) => hydrate(ctx, e)))
  },
})

// Importance-ranked recent events — the homepage hero. Same recency-
// decay × breadth × depth ranking as `articles.topStories`. Reported
// events with multiple cited sources naturally rise to the lead;
// scheduled events with strong cross-citation can too.
export const topToday = query({
  args: {
    limit: v.number(),
    lookbackHours: v.optional(v.number()),
  },
  handler: async (ctx, { limit, lookbackHours }) => {
    const now = Date.now()
    const since = now - (lookbackHours ?? 168) * 3_600_000
    const candidates = await ctx.db
      .query("events")
      .withIndex("by_status_published", (q) => q.eq("status", "approved"))
      .order("desc")
      .take(TOP_EVENTS_SCAN)
    const ranked = candidates
      .filter((e) => (e.publishedAt ?? e.createdAt) >= since)
      .sort((a, b) => compareByImportance(asScorable(a), asScorable(b), now))
      .slice(0, limit)
    return await Promise.all(ranked.map((e) => hydrate(ctx, e)))
  },
})

// Section top: importance-ranked recent events scoped to a section
// (plus its child sub-sections). Mirrors `articles.topInSection`.
export const topInSection = query({
  args: {
    sectionSlug: v.string(),
    limit: v.number(),
    lookbackHours: v.optional(v.number()),
  },
  handler: async (ctx, { sectionSlug, limit, lookbackHours }) => {
    const section = await ctx.db
      .query("sections")
      .withIndex("by_slug", (q) => q.eq("slug", sectionSlug))
      .unique()
    if (!section) return []
    // Direct children (primary parent) + cross-listed sections (museums
    // cross-lists into arts even though its primary parent is science).
    // Pulling both ensures arts shows museum events alongside music /
    // film / theater.
    const directChildren = await ctx.db
      .query("sections")
      .withIndex("by_parent", (q) => q.eq("parentId", section._id))
      .collect()
    const allSections = await ctx.db.query("sections").collect()
    const crossListed = allSections.filter((s) =>
      s.crossListedIn?.includes(section._id),
    )
    const childIds = [...directChildren, ...crossListed].map((c) => c._id)
    const scopedSectionIds = new Set<Id<"sections">>([section._id, ...childIds])
    const now = Date.now()
    const since = now - (lookbackHours ?? 168) * 3_600_000
    // Pull each section's top slice via the indexed query, union, rank.
    // Cheap for the typical 1 parent + ≤5 children case.
    const buckets = await Promise.all(
      [...scopedSectionIds].map((sid) =>
        ctx.db
          .query("events")
          .withIndex("by_section_status_published", (q) =>
            q.eq("sectionId", sid).eq("status", "approved"),
          )
          .order("desc")
          .take(TOP_EVENTS_SCAN),
      ),
    )
    const seen = new Set<string>()
    const merged: Array<Doc<"events">> = []
    for (const bucket of buckets) {
      for (const e of bucket) {
        if (seen.has(e._id as string)) continue
        if ((e.publishedAt ?? e.createdAt) < since) continue
        seen.add(e._id as string)
        merged.push(e)
      }
    }
    merged.sort((a, b) => compareByImportance(asScorable(a), asScorable(b), now))
    return await Promise.all(
      merged.slice(0, limit).map((e) => hydrate(ctx, e)),
    )
  },
})

// Paginated events by section, ordered by publishedAt DESC. Mirrors
// `articles.listBySection`. Uses Convex pagination so the section
// page's long-tail grid can scroll.
export const listBySection = query({
  args: {
    sectionSlug: v.string(),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, { sectionSlug, paginationOpts }) => {
    const section = await ctx.db
      .query("sections")
      .withIndex("by_slug", (q) => q.eq("slug", sectionSlug))
      .unique()
    if (!section) return { page: [], isDone: true, continueCursor: "" }
    const result = await ctx.db
      .query("events")
      .withIndex("by_section_status_published", (q) =>
        q.eq("sectionId", section._id).eq("status", "approved"),
      )
      .order("desc")
      .paginate(paginationOpts)
    const hydrated = await Promise.all(
      result.page.map((e) => hydrate(ctx, e)),
    )
    return { ...result, page: hydrated }
  },
})

// Events with the given neighborhood slug — mirrors
// `articles.listByNeighborhood`. Neighborhoods is an array, so we
// scan a recent window and filter.
export const listByNeighborhood = query({
  args: { slug: v.string(), limit: v.number() },
  handler: async (ctx, { slug, limit }) => {
    const candidates = await ctx.db
      .query("events")
      .withIndex("by_status_published", (q) => q.eq("status", "approved"))
      .order("desc")
      .take(limit * 10)
    const matches = candidates.filter((e) =>
      (e.neighborhoods ?? []).includes(slug),
    )
    return await Promise.all(matches.slice(0, limit).map((e) => hydrate(ctx, e)))
  },
})

// Events with the given tag — mirrors `articles.listByTag`. Tags is an
// array, same scan-and-filter pattern.
export const listByTag = query({
  args: { tag: v.string(), limit: v.number() },
  handler: async (ctx, { tag, limit }) => {
    const candidates = await ctx.db
      .query("events")
      .withIndex("by_status_published", (q) => q.eq("status", "approved"))
      .order("desc")
      .take(limit * 10)
    const matches = candidates.filter((e) => (e.tags ?? []).includes(tag))
    return await Promise.all(matches.slice(0, limit).map((e) => hydrate(ctx, e)))
  },
})

/**
 * Approved upcoming events. Used by the homepage right column + event
 * widget previews. Default lookahead 14 days, cap 10 results.
 */
// Approved upcoming events tagged with a given neighborhood slug. Used
// by the per-neighborhood landing page's right rail. Same scan-then-
// filter as articles.listByNeighborhood since events.neighborhoods is an
// array (Convex doesn't index array fields).
export const byNeighborhood = query({
  args: { slug: v.string(), limit: v.number() },
  handler: async (ctx, { slug, limit }) => {
    const now = Date.now()
    const horizon = now + 60 * 24 * 3_600_000
    const upcoming = await ctx.db
      .query("events")
      .withIndex("by_status_starts", (q) =>
        q
          .eq("status", "approved")
          .gte("startsAt", now)
          .lt("startsAt", horizon),
      )
      .order("asc")
      .take(200)
    const matches = upcoming.filter((e) =>
      (e.neighborhoods ?? []).includes(slug),
    )
    return await Promise.all(matches.slice(0, limit).map((e) => hydrate(ctx, e)))
  },
})

export const upcoming = query({
  args: {
    limit: v.optional(v.number()),
    days: v.optional(v.number()),
  },
  handler: async (ctx, { limit, days }) => {
    const now = Date.now()
    const horizon = now + (days ?? 14) * 24 * 3_600_000
    const events = await ctx.db
      .query("events")
      .withIndex("by_status_starts", (q) =>
        q.eq("status", "approved").gte("startsAt", now).lt("startsAt", horizon),
      )
      .order("asc")
      .take(limit ?? 10)
    return await Promise.all(events.map((e) => hydrate(ctx, e)))
  },
})

/**
 * "More events from this section" — used by the public event detail page.
 * Returns upcoming approved events in the same section, excluding the
 * current event. Mirrors articles.moreFromSection but for events.
 */
export const moreInSection = query({
  args: {
    sectionSlug: v.string(),
    excludeId: v.id("events"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { sectionSlug, excludeId, limit }) => {
    const section = await ctx.db
      .query("sections")
      .withIndex("by_slug", (q) => q.eq("slug", sectionSlug))
      .first()
    if (!section) return { section: null, events: [] }
    const now = Date.now()
    const horizon = now + 60 * 24 * 3_600_000 // 60-day window
    const events = await ctx.db
      .query("events")
      .withIndex("by_section_starts", (q) =>
        q
          .eq("sectionId", section._id)
          .eq("status", "approved")
          .gte("startsAt", now)
          .lt("startsAt", horizon),
      )
      .order("asc")
      .take((limit ?? 5) + 1)
    const filtered = events
      .filter((e) => e._id !== excludeId)
      .slice(0, limit ?? 5)
    return {
      section: await attachParentAccent(ctx, section),
      events: await Promise.all(filtered.map((e) => hydrate(ctx, e))),
    }
  },
})

/**
 * Approved upcoming events filed under a section (resolved by slug). Used
 * by `section/$slug` to render an events strip alongside that section's
 * articles. `food` shows food events; `business` shows business events; etc.
 */
export const upcomingBySectionSlug = query({
  args: {
    sectionSlug: v.string(),
    limit: v.optional(v.number()),
    days: v.optional(v.number()),
  },
  handler: async (ctx, { sectionSlug, limit, days }) => {
    const section = await ctx.db
      .query("sections")
      .withIndex("by_slug", (q) => q.eq("slug", sectionSlug))
      .first()
    if (!section) return []
    const now = Date.now()
    const horizon = now + (days ?? 30) * 24 * 3_600_000
    const events = await ctx.db
      .query("events")
      .withIndex("by_section_starts", (q) =>
        q
          .eq("sectionId", section._id)
          .eq("status", "approved")
          .gte("startsAt", now)
          .lt("startsAt", horizon),
      )
      .order("asc")
      .take(limit ?? 8)
    return await Promise.all(events.map((e) => hydrate(ctx, e)))
  },
})

export const get = query({
  args: { id: v.id("events") },
  handler: async (ctx, { id }) => {
    const event = await ctx.db.get(id)
    if (!event || event.status !== "approved") return null
    return await hydrate(ctx, event)
  },
})

// Hourly creation volume for the last 24 hours — same shape as
// articles.publishedSparkline24h. Used by the dashboard's Output card.
// Buckets by `createdAt` (when the agent inserted the event) so the
// sparkline reads as "system throughput" rather than "event calendar".
//
// Events don't have a status+createdAt composite index (only
// status+startsAt), so we sort by Convex's automatic `_creationTime`
// (which equals `createdAt` for these rows) and filter status
// in-memory. The 200-row scan window is fine — the buckets only need
// the last 24h.
export const createdSparkline24h = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const since = now - 24 * 3_600_000
    const events = await ctx.db.query("events").order("desc").take(200)
    const buckets = new Array<number>(24).fill(0)
    let total = 0
    for (const e of events) {
      if (e.status !== "approved") continue
      const ts = e.createdAt
      if (ts < since) continue
      const hoursAgo = Math.floor((now - ts) / 3_600_000)
      if (hoursAgo < 0 || hoursAgo > 23) continue
      buckets[23 - hoursAgo] += 1
      total += 1
    }
    return { buckets, total }
  },
})

/**
 * Public lookup by slug — counterpart to articles.getBySlug. Powers the
 * `/event/$slug` detail page. Returns null for non-approved or missing.
 */
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const event = await ctx.db
      .query("events")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first()
    if (!event || event.status !== "approved") return null
    return await hydrate(ctx, event)
  },
})

// ───────── Translations (ES) ─────────

/**
 * Approved events whose ES translation is missing OR whose sourceHash no
 * longer matches the current EN copy. Used by the dashboard "Translate
 * events" button to drain stale rows. Mirrors articles.needingTranslation.
 */
export const needingTranslation = query({
  args: { limit: v.optional(v.number()), scan: v.optional(v.number()) },
  handler: async (ctx, { limit, scan }) => {
    const cap = limit ?? 10
    const scanCap = scan ?? 200
    const all = await ctx.db
      .query("events")
      .withIndex("by_status_starts", (q) => q.eq("status", "approved"))
      .order("desc")
      .take(scanCap)
    const stale: Array<{ _id: Id<"events">; title: string }> = []
    for (const e of all) {
      const hash = eventSourceHash({
        title: e.title,
        description: e.description,
      })
      const tr = e.translations?.es
      if (!tr || tr.sourceHash !== hash) {
        stale.push({ _id: e._id, title: e.title })
      }
      if (stale.length >= cap) break
    }
    return stale
  },
})

/**
 * Persist a translation. Internal — only translateEventAction calls this.
 * Stamps `translatedAt` + `sourceHash` so future reads can tell whether
 * the ES copy is still current.
 */
export const setTranslation = internalMutation({
  args: {
    eventId: v.id("events"),
    lang: v.literal("es"),
    translation: v.object({
      title: v.string(),
      description: v.string(),
      heroCaption: v.optional(v.string()),
    }),
    sourceHash: v.string(),
  },
  handler: async (ctx, { eventId, lang, translation, sourceHash }) => {
    const event = await ctx.db.get(eventId)
    if (!event) return
    const next = {
      ...translation,
      translatedAt: Date.now(),
      sourceHash,
    }
    const translations = { ...(event.translations ?? {}), [lang]: next }
    await ctx.db.patch(eventId, { translations })
  },
})

/**
 * Run the LLM, write the result. Internal action — invoked by setStatus
 * via the scheduler when an event is approved, by translateEventNow for
 * one-off backfills, and by bulkTranslateEvents to drain the backlog.
 * Idempotent: short-circuits when the EN sourceHash already matches the
 * stored ES translation.
 */
export const translateEventAction = internalAction({
  args: { eventId: v.id("events"), lang: v.literal("es") },
  handler: async (ctx, { eventId, lang }) => {
    const event = await ctx.runQuery(api.events.getByIdAdmin, { id: eventId })
    if (!event) return { translated: false }
    if (event.status === "rejected" || event.status === "archived") {
      return { translated: false }
    }
    const sourceHash = eventSourceHash({
      title: event.title,
      description: event.description,
    })
    if (event.translations?.es?.sourceHash === sourceHash) {
      return { translated: false }
    }
    const reservation = await ctx.runMutation(internal.budget.reserve, {
      estimatedCents: estimatedCallCents("claude-sonnet-4-6"),
      label: "translateEvent",
    })
    if (!reservation.allowed) return { translated: false }
    const result = await generateEventTranslation({
      model: "claude-sonnet-4-6",
      event: {
        title: event.title,
        description: event.description,
        heroCaption: event.heroCaption,
        sectionSlug: event.section?.slug,
        tags: event.tags ?? [],
        locationName: event.locationName,
      },
    })
    if (!result) return { translated: false }
    await ctx.runMutation(internal.events.setTranslation, {
      eventId,
      lang,
      translation: {
        title: result.title,
        description: result.description,
        heroCaption: result.heroCaption,
      },
      sourceHash,
    })
    return { translated: true }
  },
})

/**
 * Cron-fired backlog drain for events. Same purpose as the article
 * counterpart: catches rows that slipped past the on-approve scheduler.
 * No editor UI — translation must always be automatic.
 */
export const bulkTranslateEventsInternal = internalAction({
  args: { maxEvents: v.optional(v.number()) },
  handler: async (
    ctx,
    { maxEvents },
  ): Promise<{
    processed: number
    translated: number
    errors: number
  }> => {
    if (!cronsEnabled()) {
      return { processed: 0, translated: 0, errors: 0 }
    }
    const cap = maxEvents ?? 10
    const stale = await ctx.runQuery(api.events.needingTranslation, {
      limit: cap,
    })
    let processed = 0
    let translated = 0
    let errors = 0
    for (const s of stale) {
      processed += 1
      try {
        const r = await ctx.runAction(
          internal.events.translateEventAction,
          { eventId: s._id, lang: "es" },
        )
        if (r.translated) translated += 1
      } catch {
        errors += 1
      }
    }
    return { processed, translated, errors }
  },
})

// Approved events in the last 24h that look weak. Same shape as the
// article anomaly query — surfaces "look at this, it auto-published but
// might be off" rows for the editor.
export const recentAnomalies = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const cap = limit ?? 12
    const since = Date.now() - 24 * 3_600_000
    const recent = await ctx.db
      .query("events")
      .withIndex("by_status_starts", (q) => q.eq("status", "approved"))
      .order("desc")
      .take(60)
    const flagged: Array<{
      _id: Doc<"events">["_id"]
      slug?: string
      title: string
      sectionAccent?: string
      sectionName?: string
      heroImage?: string
      reasons: Array<string>
    }> = []
    for (const e of recent) {
      if (!e.publishedAt || e.publishedAt < since) continue
      const reasons: Array<string> = []
      if (e.title.length > 60) reasons.push(`title ${e.title.length} chars`)
      if (e.description.length > 300) {
        reasons.push(`description ${e.description.length} chars`)
      }
      if (!e.heroImage || e.heroSource === "none") reasons.push("no hero")
      if ((e.citations ?? []).length < 1) reasons.push("uncited")
      if (!e.locationName && !e.url) reasons.push("no venue or URL")
      if (!e.sectionId) reasons.push("no section")
      if (reasons.length === 0) continue
      const section = e.sectionId ? await ctx.db.get(e.sectionId) : null
      flagged.push({
        _id: e._id,
        slug: e.slug,
        title: e.title,
        sectionAccent: section?.accentColor,
        sectionName: section?.name,
        heroImage: e.heroImage,
        reasons,
      })
      if (flagged.length >= cap) break
    }
    return flagged
  },
})

// ───────── Editorial / admin ─────────

/**
 * Editor-only fetch by id, returning the event regardless of status. Used
 * by the per-event admin editor (`/admin/events/$id`) so editors can view
 * pending / archived / rejected events that the public `get` query hides.
 */
export const getByIdAdmin = query({
  args: { id: v.id("events") },
  handler: async (ctx, { id }) => {
    await requireEditor(ctx)
    const event = await ctx.db.get(id)
    if (!event) return null
    return await hydrate(ctx, event)
  },
})

/**
 * Find candidate hero images for an event. Mirrors articles.findHeroOptions:
 * pulls every OG / twitter:image / inline image from each cited source page,
 * plus Unsplash + Wikimedia matches. Fallback query uses event tags +
 * section name (more searchable than the raw event title).
 */
export const findHeroOptions = action({
  args: { eventId: v.id("events") },
  handler: async (
    ctx,
    { eventId },
  ): Promise<{
    candidates: Array<HeroCandidate>
    diagnostics: HeroFinderDiagnostics
  }> => {
    await requireEditorInAction(ctx)
    const event = await ctx.runQuery(api.events.getByIdAdmin, { id: eventId })
    if (!event) {
      return {
        candidates: [],
        diagnostics: {
          sourcesScanned: 0,
          sourcesWithImage: 0,
          wikimediaCount: 0,
          totalCandidates: 0,
        },
      }
    }
    const sectionLabel = event.section?.name ?? "Miami"
    const tagsForQuery = (event.tags ?? [])
      .filter((t) => t.length > 2)
      .slice(0, 2)
      .map((t) => t.replace(/-/g, " "))
    const queryParts = [...tagsForQuery, sectionLabel].filter(Boolean)
    const fallbackQuery = queryParts.join(" ") || `Miami ${sectionLabel}`
    // Cited URLs first, then the event's own canonical URL as a final
    // fallback page to scrape for OG images.
    const citationUrls = [
      ...(event.citations ?? []).map((c) => c.url),
      ...(event.url ? [event.url] : []),
    ]
    return await findHeroCandidates({
      citationUrls,
      fallbackQuery,
      excludeUrl: event.heroImage,
    })
  },
})

/**
 * Apply an editor-picked hero image. Mirrors articles.setHero. Pass
 * heroImage undefined to clear the hero entirely.
 */
export const setHero = mutation({
  args: {
    eventId: v.id("events"),
    heroImage: v.optional(v.string()),
    heroCaption: v.optional(v.string()),
    heroSource: v.optional(heroSourceValidator),
  },
  handler: async (ctx, { eventId, heroImage, heroCaption, heroSource }) => {
    await requireEditor(ctx)
    const event = await ctx.db.get(eventId)
    if (!event) return { changed: false }
    const same =
      heroImage === event.heroImage &&
      heroCaption === event.heroCaption &&
      heroSource === event.heroSource
    if (same) return { changed: false }
    await ctx.db.patch(eventId, {
      heroImage,
      heroCaption,
      heroSource: heroSource ?? (heroImage ? "source" : "none"),
    })
    return { changed: true }
  },
})

/**
 * All events (any status) starting after a cutoff. Powers the admin events
 * table — combines approved + pending so editors see the full picture.
 * Past events older than `pastDays` are excluded to keep the table tight.
 */
export const adminList = query({
  args: { pastDays: v.optional(v.number()) },
  handler: async (ctx, { pastDays }) => {
    await requireEditor(ctx)
    const since = Date.now() - (pastDays ?? 7) * 24 * 3_600_000
    const events = await ctx.db
      .query("events")
      .withIndex("by_starts", (q) => q.gte("startsAt", since))
      .order("asc")
      .take(SCAN_CAP)
    return await Promise.all(events.map((e) => hydrate(ctx, e)))
  },
})

export const create = mutation({
  args: {
    event: eventInputValidator,
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("pending_review"),
        v.literal("approved"),
        v.literal("archived"),
        v.literal("rejected"),
      ),
    ),
  },
  handler: async (ctx, { event, status }) => {
    await requireEditor(ctx)
    const slug = await uniqueSlug(
      ctx,
      event.slug || event.title,
      event.startsAt,
    )
    const finalStatus = status ?? "approved"
    const tags = cleanTags(event.tags ?? [])
    const neighborhoods = filterNeighborhoodSlugs(event.neighborhoods ?? [])
    const id = await ctx.db.insert("events", {
      ...event,
      slug,
      tags,
      neighborhoods,
      searchableText: buildSearchableText(event.title, event.description, tags),
      status: finalStatus,
      publishedAt: finalStatus === "approved" ? Date.now() : undefined,
      createdAt: Date.now(),
    })
    // Schedule auto-translation (60s debounce) when the event is created
    // straight into approved status — same pattern as articles.publish.
    if (finalStatus === "approved") {
      await ctx.scheduler.runAfter(
        60_000,
        internal.events.translateEventAction,
        { eventId: id, lang: "es" },
      )
    }
    return id
  },
})

export const update = mutation({
  args: {
    id: v.id("events"),
    patch: v.object({
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      startsAt: v.optional(v.number()),
      endsAt: v.optional(v.number()),
      allDay: v.optional(v.boolean()),
      locationName: v.optional(v.string()),
      locationAddress: v.optional(v.string()),
      neighborhoods: v.optional(v.array(v.string())),
      url: v.optional(v.string()),
      heroImage: v.optional(v.string()),
      heroCaption: v.optional(v.string()),
      heroSource: v.optional(heroSourceValidator),
      price: v.optional(v.string()),
      sectionId: v.optional(v.id("sections")),
      tags: v.optional(v.array(v.string())),
      relatedArticleIds: v.optional(v.array(v.id("articles"))),
      relatedEventIds: v.optional(v.array(v.id("events"))),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireEditor(ctx)
    const cleaned: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) cleaned[key] = value
    }
    if (cleaned.neighborhoods) {
      cleaned.neighborhoods = filterNeighborhoodSlugs(
        cleaned.neighborhoods as Array<string>,
      )
    }
    if (cleaned.tags !== undefined) {
      cleaned.tags = cleanTags(cleaned.tags as Array<string>)
    }
    if (Object.keys(cleaned).length === 0) return
    const existing = await ctx.db.get(id)
    if (!existing) return
    // Refresh searchableText whenever any of its inputs changed.
    const titleChanged = cleaned.title !== undefined
    const descriptionChanged = cleaned.description !== undefined
    const tagsChanged = cleaned.tags !== undefined
    if (titleChanged || descriptionChanged || tagsChanged) {
      cleaned.searchableText = buildSearchableText(
        (cleaned.title as string | undefined) ?? existing.title,
        (cleaned.description as string | undefined) ?? existing.description,
        (cleaned.tags as Array<string> | undefined) ?? existing.tags ?? [],
      )
    }
    await ctx.db.patch(id, cleaned)
  },
})

export const setStatus = mutation({
  args: {
    id: v.id("events"),
    status: v.union(
      v.literal("draft"),
      v.literal("pending_review"),
      v.literal("approved"),
      v.literal("archived"),
      v.literal("rejected"),
    ),
  },
  handler: async (ctx, { id, status }) => {
    await requireEditor(ctx)
    const existing = await ctx.db.get(id)
    if (!existing) return
    if (existing.status === status) return
    const patch: Record<string, unknown> = { status }
    // Stamp publishedAt the first time an event flips to approved, mirroring
    // how articles stamp publishedAt on first publish.
    if (status === "approved" && !existing.publishedAt) {
      patch.publishedAt = Date.now()
    }
    await ctx.db.patch(id, patch)
    // Schedule auto-translation when the event flips to approved, with the
    // same 60s debounce as articles.publish. The action itself short-
    // circuits via sourceHash when EN hasn't changed since the last run,
    // so re-approves of unchanged events cost nothing.
    if (status === "approved" && existing.status !== "approved") {
      await ctx.scheduler.runAfter(
        60_000,
        internal.events.translateEventAction,
        { eventId: id, lang: "es" },
      )
    }
  },
})

export const remove = mutation({
  args: { id: v.id("events") },
  handler: async (ctx, { id }) => {
    await requireEditor(ctx)
    await ctx.db.delete(id)
  },
})


// Insert events extracted by a desk's LLM. Internal — only callable from
// desk actions, never from the public client. Auto-approves on insert
// (mirrors articles.insertDraft). Quality issues are caught after the
// fact via `events.recentAnomalies` on the admin dashboard.
export const insertExtracted = internalMutation({
  args: {
    event: eventInputValidator,
    agentSlug: v.string(),
    agentRunId: v.id("agentRuns"),
    derivedFromItems: v.array(v.id("ingestedItems")),
  },
  handler: async (ctx, { event, agentSlug, agentRunId, derivedFromItems }) => {
    const slug = await uniqueSlug(
      ctx,
      event.slug || event.title,
      event.startsAt,
    )
    const tags = cleanTags(event.tags ?? [])
    const neighborhoods = filterNeighborhoodSlugs(event.neighborhoods ?? [])

    // Self-approve — every desk-extracted event goes live immediately.
    // Same trust-the-pipeline tradeoff as articles. Re-runs that
    // extract the same event fold via the dedup pass.
    const now = Date.now()
    const id = await ctx.db.insert("events", {
      ...event,
      slug,
      tags,
      neighborhoods,
      searchableText: buildSearchableText(
        event.title,
        event.description,
        tags,
        event.dek,
        event.body,
      ),
      status: "approved",
      publishedAt: now,
      agentSlug,
      agentRunId,
      derivedFromItems,
      createdAt: now,
    })
    await ctx.scheduler.runAfter(
      60_000,
      internal.events.translateEventAction,
      { eventId: id, lang: "es" },
    )
    return id
  },
})

// Candidates the mega-desk LLM picks from when populating an event's
// `relatedEventIndices` or `updateOfRelatedIndex`. Returns recent
// approved events with the same section boosted to the front. Capped
// tight to keep the LLM prompt small + prompt-cache friendly.
export const recentForLinking = query({
  args: {
    sectionId: v.optional(v.id("sections")),
    limit: v.optional(v.number()),
    lookbackHours: v.optional(v.number()),
  },
  handler: async (ctx, { sectionId, limit, lookbackHours }) => {
    const cap = limit ?? 25
    const since = Date.now() - (lookbackHours ?? 336) * 3_600_000
    const sameSection = sectionId
      ? await ctx.db
          .query("events")
          .withIndex("by_section_status_published", (q) =>
            q.eq("sectionId", sectionId).eq("status", "approved"),
          )
          .order("desc")
          .take(cap)
      : []
    const overall = await ctx.db
      .query("events")
      .withIndex("by_status_published", (q) => q.eq("status", "approved"))
      .order("desc")
      .take(cap)
    const seen = new Set<string>()
    const merged: Array<Doc<"events">> = []
    for (const e of [...sameSection, ...overall]) {
      const key = e._id as string
      if (seen.has(key)) continue
      const ts = e.publishedAt ?? e.createdAt
      if (ts < since) continue
      seen.add(key)
      merged.push(e)
      if (merged.length >= cap) break
    }
    return await Promise.all(
      merged.map(async (e) => {
        const section = e.sectionId ? await ctx.db.get(e.sectionId) : null
        return {
          _id: e._id,
          title: e.title,
          // Dek when present (kind=reported); fall back to description
          // so the LLM always has a one-liner to disambiguate by.
          dek: e.dek ?? e.description,
          publishedAt: e.publishedAt,
          startsAt: e.startsAt,
          section: section
            ? { name: section.name, slug: section.slug }
            : null,
          tags: e.tags ?? [],
          neighborhoods: e.neighborhoods ?? [],
        }
      }),
    )
  },
})

// Phase-1 helper: dedupe via merge into an existing event. Called when
// the LLM emits an event with `updateOfRelatedIndex` pointing at one of
// the related candidates — same dedupe shape as `articles.augmentArticle`,
// just over the events table. Citations + derivedFromItems are unioned
// (URL/id-set semantics, no dupes). When the target is still
// pending_review the editorial copy can be refreshed; published events
// keep editor-approved text and only accumulate citations.
export const augmentEvent = mutation({
  args: {
    eventId: v.id("events"),
    newCitations: v.array(citationValidator),
    newSourceItems: v.array(v.id("ingestedItems")),
    patch: v.optional(
      v.object({
        title: v.optional(v.string()),
        dek: v.optional(v.string()),
        body: v.optional(v.string()),
        description: v.optional(v.string()),
      }),
    ),
    agentSlug: v.string(),
    agentRunId: v.id("agentRuns"),
  },
  handler: async (
    ctx,
    { eventId, newCitations, newSourceItems, patch },
  ) => {
    const target = await ctx.db.get(eventId)
    if (!target) return { merged: false as const }
    if (target.status === "rejected" || target.status === "archived") {
      return { merged: false as const }
    }
    const existingCitations = target.citations ?? []
    const existingUrls = new Set(existingCitations.map((c) => c.url))
    const addedCitations = newCitations.filter(
      (c) => !existingUrls.has(c.url),
    )
    const existingItems = new Set(
      (target.derivedFromItems ?? []).map((id) => id as string),
    )
    const addedItems = newSourceItems.filter(
      (id) => !existingItems.has(id as string),
    )
    const updates: Record<string, unknown> = {
      citations: [...existingCitations, ...addedCitations],
      derivedFromItems: [...(target.derivedFromItems ?? []), ...addedItems],
    }
    const changedFields: Array<string> = []
    if (target.status === "pending_review" && patch) {
      const nextTitle =
        patch.title && patch.title !== target.title ? patch.title : target.title
      const nextDek =
        patch.dek !== undefined && patch.dek !== target.dek
          ? patch.dek
          : target.dek
      const nextBody =
        patch.body !== undefined && patch.body !== target.body
          ? patch.body
          : target.body
      const nextDescription =
        patch.description && patch.description !== target.description
          ? patch.description
          : target.description
      if (nextTitle !== target.title) {
        updates.title = nextTitle
        changedFields.push("title")
      }
      if (nextDek !== target.dek) {
        updates.dek = nextDek
        changedFields.push("dek")
      }
      if (nextBody !== target.body) {
        updates.body = nextBody
        changedFields.push("body")
      }
      if (nextDescription !== target.description) {
        updates.description = nextDescription
        changedFields.push("description")
      }
      if (changedFields.length > 0) {
        updates.searchableText = buildSearchableText(
          nextTitle,
          nextDescription,
          target.tags ?? [],
          nextDek,
          nextBody,
        )
      }
    }
    await ctx.db.patch(eventId, updates)
    return {
      merged: true as const,
      citationsAdded: addedCitations.length,
      sourceItemsAdded: addedItems.length,
      contentUpdated: changedFields.length > 0,
    }
  },
})
