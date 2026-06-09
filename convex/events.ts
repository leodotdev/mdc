import { v } from "convex/values"

import { api, internal } from "./_generated/api"
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server"
import { cleanTags } from "./agents"
import { attachParentAccent } from "./lib/hydrationHelpers"
import { compareByImportance, compareByPopularity } from "./lib/scoring"
import { requireEditor } from "./lib/guard"
import { estimatedCallCents } from "./lib/budget"
import { cronsEnabled } from "./lib/cronGate"
import { requireEditorInAction } from "./lib/guard"
import {
  eventDedupeKey,
  eventSeriesKey,
  similarityScore,
} from "./lib/eventDedupe"
import { maybeTitleCase } from "./lib/titleCase"
import {
  generateEventBatchTranslation,
  generateEventEnrichment,
  generateEventTranslation,
} from "./lib/llm"
import { scoreEventQuality } from "./lib/quality"
import { findHeroCandidates } from "./lib/media"
import { filterNeighborhoodSlugs, neighborhoodCoords } from "./lib/neighborhoods"
import type { HeroCandidate, HeroFinderDiagnostics } from "./lib/media"
import type { Doc, Id } from "./_generated/dataModel"
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server"

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
  recurrenceRule: v.optional(v.string()),
  startsAt: v.number(),
  endsAt: v.optional(v.number()),
  allDay: v.boolean(),
  locationName: v.optional(v.string()),
  locationAddress: v.optional(v.string()),
  lat: v.optional(v.number()),
  lng: v.optional(v.number()),
  neighborhoods: v.optional(v.array(v.string())),
  url: v.optional(v.string()),
  heroImage: v.optional(v.string()),
  heroCaption: v.optional(v.string()),
  heroSource: v.optional(heroSourceValidator),
  price: v.optional(v.string()),
  sectionId: v.optional(v.id("sections")),
  tags: v.optional(v.array(v.string())),
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
  dek?: string
}): string {
  // Hashing on title + dek — `dek` is now the single translated text
  // body. `description` lingers in the schema but isn't shown or
  // translated; including it in the hash would force re-translations
  // every time a backfill clears it.
  const s = `${event.title}|${event.dek ?? ""}`
  let h = 5381
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}

async function hydrate(ctx: QueryCtx, event: Doc<"events">) {
  const rawSection = event.sectionId
    ? await ctx.db.get(event.sectionId)
    : null
  const section = await attachParentAccent(ctx, rawSection)
  // Public surface guarantees a non-empty slug. Legacy rows that pre-
  // date the slug column fall back to the document id so cards still
  // route somewhere predictable.
  const slug = event.slug ?? (event._id as string)
  // `article` field is kept as `null` for back-compat with the public
  // EventWithRelations shape consumers still expect.
  return { ...event, slug, section, article: null as null }
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
    // Direct hits — events whose canonical startsAt falls in window.
    const direct = await ctx.db
      .query("events")
      .withIndex("by_status_starts", (q) =>
        q
          .eq("status", "approved")
          .gte("startsAt", rangeStart)
          .lt("startsAt", rangeEnd),
      )
      .order("asc")
      .take(SCAN_CAP)
    // Recurring-event union — events with a past startsAt but a
    // future occurrence inside the window (populated by the nightly
    // recurrence cron). Without this, a weekly yoga class from Jan
    // never appears in May's range.
    const recurringPool = await ctx.db
      .query("events")
      .withIndex("by_status_starts", (q) =>
        q.eq("status", "approved").lt("startsAt", rangeStart),
      )
      .order("desc")
      .take(500)
    const recurringHits = recurringPool.filter(
      (e) =>
        e.recurrenceRule &&
        (e.recurrenceInstances ?? []).some(
          (t) => t >= rangeStart && t < rangeEnd,
        ),
    )
    const seen = new Set<string>(direct.map((e) => e._id as string))
    const merged = [...direct]
    for (const e of recurringHits) {
      if (seen.has(e._id as string)) continue
      seen.add(e._id as string)
      merged.push(e)
    }
    let filtered = merged
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

// Strict-scoped section slugs — these turn off the tag-enrichment
// path that normally lets a section pick up events filed under
// adjacent sections. Sports team subsections (Hurricanes, Heat,
// Marlins, etc.) need strict scoping because the "hurricanes" /
// "miami" / "um" tag families are noisy and pull in non-athletics
// content (a Frost School recital, a dissertation defense). Strict
// scoping = only events with `sectionId === this section's id` show.
async function isStrictScoped(
  ctx: QueryCtx,
  section: Doc<"sections">,
): Promise<boolean> {
  if (!section.parentId) return false
  const parent = await ctx.db.get(section.parentId)
  if (!parent) return false
  return parent.slug === "sports"
}

// `ImportanceScorable`-compatible adapter. The events table's
// `derivedFromItems` + `citations` are optional, but the scoring
// helper expects arrays — default to empty so the comparator works
// without throwing on legacy rows. Also carries `viewCount30d` so
// the popularity comparator can read it from the same object.
function asScorable(e: Doc<"events">): {
  derivedFromItems: ReadonlyArray<unknown>
  citations: ReadonlyArray<unknown>
  tags?: ReadonlyArray<string>
  title?: string
  publishedAt?: number
  createdAt: number
  viewCount30d?: number
} {
  return {
    derivedFromItems: e.derivedFromItems ?? [],
    citations: e.citations ?? [],
    tags: e.tags ?? [],
    title: e.title,
    publishedAt: e.publishedAt,
    createdAt: e.createdAt,
    viewCount30d: e.viewCount30d,
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
      .sort(rankEventsForHero(now))
      .slice(0, limit)
    return await Promise.all(ranked.map((e) => hydrate(ctx, e)))
  },
})

// Hero-rank comparator with a recurrence penalty: non-recurring events
// sort ahead of recurring ones before the article-style importance
// score breaks ties. A "Daily Guided Museum Tour" still has a high raw
// score (image, citations, soon-startsAt) but recurring=true bumps it
// out of the lead slot — one-off shows / openings / talks rise instead.
function rankEventsForHero(
  now: number,
): (a: Doc<"events">, b: Doc<"events">) => number {
  return (a, b) => {
    const aRec = a.recurrenceRule ? 1 : 0
    const bRec = b.recurrenceRule ? 1 : 0
    if (aRec !== bRec) return aRec - bRec
    return compareByImportance(asScorable(a), asScorable(b), now)
  }
}

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
    // Tag-driven enrichment: pull events tagged with any of this
    // section's associatedTags (or just the slug as a baseline) and
    // union them in. Lets /section/books surface "jazz at Books &
    // Books" — primary section music, also tagged "books". Scan is
    // bounded; we only consider recent published events. Strict-scoped
    // sections (sports team subsections) skip enrichment entirely.
    const strict = await isStrictScoped(ctx, section)
    const associatedTags = new Set(
      section.associatedTags && section.associatedTags.length > 0
        ? section.associatedTags
        : [section.slug],
    )
    if (!strict && associatedTags.size > 0) {
      const tagScan = await ctx.db
        .query("events")
        .withIndex("by_status_published", (q) => q.eq("status", "approved"))
        .order("desc")
        .take(TOP_EVENTS_SCAN * 2)
      for (const e of tagScan) {
        if (seen.has(e._id as string)) continue
        if ((e.publishedAt ?? e.createdAt) < since) continue
        const tags = e.tags ?? []
        if (!tags.some((t) => associatedTags.has(t))) continue
        seen.add(e._id as string)
        merged.push(e)
      }
    }
    merged.sort(rankEventsForHero(now))
    return await Promise.all(
      merged.slice(0, limit).map((e) => hydrate(ctx, e)),
    )
  },
})

// ───────── Popular rail queries ─────────
// `popularToday`, `popularInSection`, `popularByNeighborhood` feed the
// "Popular" right-rail block on the homepage, section pages, and
// neighborhood pages respectively. All three sort by `viewCount30d`
// (denormalized onto each event row by the nightly
// `popularity:cronTick`) and fall back to editorial importance via
// `compareByPopularity` when no row in the candidate set has views.
// That fallback is the empty-state guard: brand-new sections / a
// freshly-deployed site never show an empty rail.
//
// Time window: forward-only (`startsAt >= now`). Popularity of upcoming
// events is what readers want from a calendar; the by-publishedAt
// hero queries above stay unchanged.

// Upcoming events across the site, ranked by 30-day view count with
// editorial-importance fallback. Bounded by a `days` forward window
// so the candidate scan stays small.
export const popularToday = query({
  args: { limit: v.number(), days: v.optional(v.number()) },
  handler: async (ctx, { limit, days }) => {
    const now = Date.now()
    const windowEnd = now + (days ?? 30) * 24 * 3_600_000
    const candidates = await ctx.db
      .query("events")
      .withIndex("by_status_starts", (q) =>
        q.eq("status", "approved").gte("startsAt", now).lt("startsAt", windowEnd),
      )
      .take(SCAN_CAP)
    const sorted = candidates.sort((a, b) =>
      compareByPopularity(asScorable(a), asScorable(b), now),
    )
    return await Promise.all(
      sorted.slice(0, limit).map((e) => hydrate(ctx, e)),
    )
  },
})

// Upcoming events scoped to a section + its sub-sections +
// cross-listed sections + tag enrichment, ranked by popularity.
// Mirrors `topInSection`'s scoping so the same Business → tech /
// real-estate / commerce union applies, just with a different sort.
export const popularInSection = query({
  args: {
    sectionSlug: v.string(),
    limit: v.number(),
    days: v.optional(v.number()),
  },
  handler: async (ctx, { sectionSlug, limit, days }) => {
    const section = await ctx.db
      .query("sections")
      .withIndex("by_slug", (q) => q.eq("slug", sectionSlug))
      .unique()
    if (!section) return []
    const directChildren = await ctx.db
      .query("sections")
      .withIndex("by_parent", (q) => q.eq("parentId", section._id))
      .collect()
    const allSections = await ctx.db.query("sections").collect()
    const crossListed = allSections.filter((s) =>
      s.crossListedIn?.includes(section._id),
    )
    const childIds = [...directChildren, ...crossListed].map((c) => c._id)
    const scopedSectionIds = new Set<Id<"sections">>([
      section._id,
      ...childIds,
    ])
    const now = Date.now()
    const windowEnd = now + (days ?? 30) * 24 * 3_600_000
    // Forward-window scan per scoped section, then union.
    const buckets = await Promise.all(
      [...scopedSectionIds].map((sid) =>
        ctx.db
          .query("events")
          .withIndex("by_section_starts", (q) =>
            q.eq("sectionId", sid).eq("status", "approved").gte("startsAt", now),
          )
          .take(SCAN_CAP),
      ),
    )
    const seen = new Set<string>()
    const merged: Array<Doc<"events">> = []
    for (const bucket of buckets) {
      for (const e of bucket) {
        if (seen.has(e._id as string)) continue
        if (e.startsAt >= windowEnd) continue
        seen.add(e._id as string)
        merged.push(e)
      }
    }
    // Same tag enrichment as topInSection so /section/books picks up
    // "jazz at Books & Books" tagged with `books`. Strict-scoped
    // sub-sections (Sports teams) skip enrichment.
    const strict = await isStrictScoped(ctx, section)
    const associatedTags = new Set(
      section.associatedTags && section.associatedTags.length > 0
        ? section.associatedTags
        : [section.slug],
    )
    if (!strict && associatedTags.size > 0) {
      const tagScan = await ctx.db
        .query("events")
        .withIndex("by_status_starts", (q) =>
          q.eq("status", "approved").gte("startsAt", now).lt("startsAt", windowEnd),
        )
        .take(SCAN_CAP * 2)
      for (const e of tagScan) {
        if (seen.has(e._id as string)) continue
        const tags = e.tags ?? []
        if (!tags.some((t) => associatedTags.has(t))) continue
        seen.add(e._id as string)
        merged.push(e)
      }
    }
    merged.sort((a, b) =>
      compareByPopularity(asScorable(a), asScorable(b), now),
    )
    return await Promise.all(
      merged.slice(0, limit).map((e) => hydrate(ctx, e)),
    )
  },
})

// Upcoming events tied to a neighborhood, ranked by popularity.
// Same forward-window semantics as `byNeighborhood` (the
// chronological variant) but the sort is popularity + importance
// fallback instead of startsAt.
export const popularByNeighborhood = query({
  args: {
    slug: v.string(),
    limit: v.number(),
    days: v.optional(v.number()),
  },
  handler: async (ctx, { slug, limit, days }) => {
    const now = Date.now()
    const windowEnd = now + (days ?? 30) * 24 * 3_600_000
    const candidates = await ctx.db
      .query("events")
      .withIndex("by_status_starts", (q) =>
        q.eq("status", "approved").gte("startsAt", now).lt("startsAt", windowEnd),
      )
      .take(SCAN_CAP)
    const filtered = candidates.filter(
      (e) => e.neighborhoods?.includes(slug),
    )
    const sorted = filtered.sort((a, b) =>
      compareByPopularity(asScorable(a), asScorable(b), now),
    )
    return await Promise.all(
      sorted.slice(0, limit).map((e) => hydrate(ctx, e)),
    )
  },
})

// Section listing — unions strict sectionId matches with cross-listed
// children and tag-relevant events, so /section/books picks up both
// "events filed under books" AND "events tagged books / book-fair /
// library / author" even when those events file under a different
// primary section (e.g. a jazz night at a bookstore is sectionId=music
// + tag=books). Returns the same `{ page, isDone, continueCursor }`
// shape paginated callers expect; with cross-section union the result
// is a single non-paginated page sliced to `numItems`. `isDone=true`
// always — pagination semantics don't compose cleanly with the union
// scan, and the section page only renders the first page anyway.
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
    // Scope: section + primary children + cross-listed sections.
    const directChildren = await ctx.db
      .query("sections")
      .withIndex("by_parent", (q) => q.eq("parentId", section._id))
      .collect()
    const allSections = await ctx.db.query("sections").collect()
    const crossListed = allSections.filter((s) =>
      s.crossListedIn?.includes(section._id),
    )
    const scopedIds = new Set<Id<"sections">>([
      section._id,
      ...directChildren.map((c) => c._id),
      ...crossListed.map((c) => c._id),
    ])
    // Strict-section buckets via the indexed query.
    const buckets = await Promise.all(
      [...scopedIds].map((sid) =>
        ctx.db
          .query("events")
          .withIndex("by_section_status_published", (q) =>
            q.eq("sectionId", sid).eq("status", "approved"),
          )
          .order("desc")
          .take(200),
      ),
    )
    const seen = new Set<string>()
    const merged: Array<Doc<"events">> = []
    for (const bucket of buckets) {
      for (const e of bucket) {
        if (seen.has(e._id as string)) continue
        seen.add(e._id as string)
        merged.push(e)
      }
    }
    // Tag-driven enrichment. Strict-scoped sections (sports team subs)
    // skip enrichment so e.g. Hurricanes only ever shows athletics —
    // never general UM events that happen to share a tag.
    const strict = await isStrictScoped(ctx, section)
    const associatedTags = new Set(
      section.associatedTags && section.associatedTags.length > 0
        ? section.associatedTags
        : [section.slug],
    )
    if (!strict && associatedTags.size > 0) {
      const tagScan = await ctx.db
        .query("events")
        .withIndex("by_status_published", (q) => q.eq("status", "approved"))
        .order("desc")
        .take(500)
      for (const e of tagScan) {
        if (seen.has(e._id as string)) continue
        const tags = e.tags ?? []
        if (!tags.some((t) => associatedTags.has(t))) continue
        seen.add(e._id as string)
        merged.push(e)
      }
    }
    merged.sort((a, b) => {
      const ta = a.publishedAt ?? a.createdAt
      const tb = b.publishedAt ?? b.createdAt
      return tb - ta
    })
    const page = merged.slice(0, paginationOpts.numItems)
    const hydrated = await Promise.all(page.map((e) => hydrate(ctx, e)))
    return { page: hydrated, isDone: true, continueCursor: "" }
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

// Events whose startsAt falls inside a specific UTC year+month.
// Scoped optionally to a section (with its primary + cross-listed
// children + associated-tag matches, matching listBySection's
// enrichment) or to a single tag / neighborhood. Drives the month-
// view calendar grid; the renderer expands recurring events
// client-side via lib/rrule.ts.
//
// `yearMonth` is "YYYY-MM" — string keeps the URL share param shape
// simple (`?month=2026-05`). Returns up to 500 events per month;
// busy months overflow into the "+N more" cell expansion in the UI.
export const inMonth = query({
  args: {
    yearMonth: v.string(),
    sectionSlug: v.optional(v.string()),
    tag: v.optional(v.string()),
    neighborhoodSlug: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { yearMonth, sectionSlug, tag, neighborhoodSlug },
  ) => {
    const match = /^(\d{4})-(\d{2})$/.exec(yearMonth)
    if (!match) return []
    const year = Number(match[1])
    const month = Number(match[2]) - 1 // JS months are 0-indexed
    // Wider than the visible month: a calendar grid shows the trailing
    // days of the previous month + the leading days of the next month,
    // so we pull a range that covers ~6 weeks centered on the month.
    const rangeStart = new Date(year, month, 1).getTime() - 7 * 86_400_000
    const rangeEnd = new Date(year, month + 1, 1).getTime() + 7 * 86_400_000
    // Index hit — same shape as `inRange`, just a wider window.
    const direct = await ctx.db
      .query("events")
      .withIndex("by_status_starts", (q) =>
        q
          .eq("status", "approved")
          .gte("startsAt", rangeStart)
          .lt("startsAt", rangeEnd),
      )
      .order("asc")
      .take(500)
    // Recurring-event union: events with past startsAt but a
    // precomputed `recurrenceInstances` entry in the visible window.
    const recurringPool = await ctx.db
      .query("events")
      .withIndex("by_status_starts", (q) =>
        q.eq("status", "approved").lt("startsAt", rangeStart),
      )
      .order("desc")
      .take(500)
    const recurringHits = recurringPool.filter(
      (e) =>
        e.recurrenceRule &&
        (e.recurrenceInstances ?? []).some(
          (t) => t >= rangeStart && t < rangeEnd,
        ),
    )
    const seenIds = new Set<string>(direct.map((e) => e._id as string))
    const candidates = [...direct]
    for (const e of recurringHits) {
      if (seenIds.has(e._id as string)) continue
      seenIds.add(e._id as string)
      candidates.push(e)
    }
    // Filter scope.
    let filtered = candidates
    if (sectionSlug) {
      const section = await ctx.db
        .query("sections")
        .withIndex("by_slug", (q) => q.eq("slug", sectionSlug))
        .unique()
      if (!section) return []
      // Same scope expansion as listBySection — direct children +
      // cross-listed + tag-relevant.
      const directChildren = await ctx.db
        .query("sections")
        .withIndex("by_parent", (q) => q.eq("parentId", section._id))
        .collect()
      const allSections = await ctx.db.query("sections").collect()
      const crossListed = allSections.filter((s) =>
        s.crossListedIn?.includes(section._id),
      )
      const scopedIds = new Set<Id<"sections">>([
        section._id,
        ...directChildren.map((c) => c._id),
        ...crossListed.map((c) => c._id),
      ])
      const strict = await isStrictScoped(ctx, section)
      const associatedTags = new Set(
        section.associatedTags && section.associatedTags.length > 0
          ? section.associatedTags
          : [section.slug],
      )
      filtered = candidates.filter((e) => {
        if (e.sectionId && scopedIds.has(e.sectionId)) return true
        if (strict) return false
        const eventTags = e.tags ?? []
        return eventTags.some((t) => associatedTags.has(t))
      })
    }
    if (tag) {
      filtered = filtered.filter((e) => (e.tags ?? []).includes(tag))
    }
    if (neighborhoodSlug) {
      filtered = filtered.filter((e) =>
        (e.neighborhoods ?? []).includes(neighborhoodSlug),
      )
    }
    return await Promise.all(filtered.map((e) => hydrate(ctx, e)))
  },
})

// Events with lat/lng populated — drives the Map view. Same scope
// filters as inMonth: optional section (with cross-section
// enrichment), tag, or neighborhood. Returns up to 500 plotted
// events. Skips events without coordinates entirely (no point
// showing them on a map).
export const placedOnMap = query({
  args: {
    sectionSlug: v.optional(v.string()),
    tag: v.optional(v.string()),
    neighborhoodSlug: v.optional(v.string()),
  },
  handler: async (ctx, { sectionSlug, tag, neighborhoodSlug }) => {
    // Pull recent approved events; we don't index lat/lng directly
    // because a coordinate-bounded query is overkill for the city-
    // scale dataset. Filter to placed events in-memory.
    const candidates = await ctx.db
      .query("events")
      .withIndex("by_status_published", (q) => q.eq("status", "approved"))
      .order("desc")
      .take(500)
    let filtered = candidates.filter(
      (e): e is typeof e & { lat: number; lng: number } =>
        typeof e.lat === "number" && typeof e.lng === "number",
    )
    if (sectionSlug) {
      const section = await ctx.db
        .query("sections")
        .withIndex("by_slug", (q) => q.eq("slug", sectionSlug))
        .unique()
      if (!section) return []
      const directChildren = await ctx.db
        .query("sections")
        .withIndex("by_parent", (q) => q.eq("parentId", section._id))
        .collect()
      const allSections = await ctx.db.query("sections").collect()
      const crossListed = allSections.filter((s) =>
        s.crossListedIn?.includes(section._id),
      )
      const scopedIds = new Set<Id<"sections">>([
        section._id,
        ...directChildren.map((c) => c._id),
        ...crossListed.map((c) => c._id),
      ])
      const strict = await isStrictScoped(ctx, section)
      const associatedTags = new Set(
        section.associatedTags && section.associatedTags.length > 0
          ? section.associatedTags
          : [section.slug],
      )
      filtered = filtered.filter((e) => {
        if (e.sectionId && scopedIds.has(e.sectionId)) return true
        if (strict) return false
        const eventTags = e.tags ?? []
        return eventTags.some((t) => associatedTags.has(t))
      })
    }
    if (tag) {
      filtered = filtered.filter((e) => (e.tags ?? []).includes(tag))
    }
    if (neighborhoodSlug) {
      filtered = filtered.filter((e) =>
        (e.neighborhoods ?? []).includes(neighborhoodSlug),
      )
    }
    return await Promise.all(filtered.map((e) => hydrate(ctx, e)))
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
    const cap = limit ?? 10
    // Direct hits — startsAt in window.
    const direct = await ctx.db
      .query("events")
      .withIndex("by_status_starts", (q) =>
        q.eq("status", "approved").gte("startsAt", now).lt("startsAt", horizon),
      )
      .order("asc")
      .take(cap * 4)
    // Recurring events whose startsAt is past but a precomputed
    // instance lands inside the window. Without this, every weekly
    // yoga / jazz night / market would vanish from `upcoming`.
    const recurringPool = await ctx.db
      .query("events")
      .withIndex("by_status_starts", (q) =>
        q.eq("status", "approved").lt("startsAt", now),
      )
      .order("desc")
      .take(500)
    type ScoredEvent = (typeof direct)[number] & { _sortKey: number }
    const scored: Array<ScoredEvent> = []
    const seen = new Set<string>()
    for (const e of direct) {
      seen.add(e._id as string)
      scored.push({ ...e, _sortKey: e.startsAt })
    }
    for (const e of recurringPool) {
      if (seen.has(e._id as string)) continue
      if (!e.recurrenceRule) continue
      const inst = (e.recurrenceInstances ?? []).find(
        (t) => t >= now && t < horizon,
      )
      if (inst === undefined) continue
      seen.add(e._id as string)
      scored.push({ ...e, _sortKey: inst })
    }
    scored.sort((a, b) => a._sortKey - b._sortKey)
    return await Promise.all(
      scored.slice(0, cap).map((e) => hydrate(ctx, e)),
    )
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
    const cap = limit ?? 8
    const direct = await ctx.db
      .query("events")
      .withIndex("by_section_starts", (q) =>
        q
          .eq("sectionId", section._id)
          .eq("status", "approved")
          .gte("startsAt", now)
          .lt("startsAt", horizon),
      )
      .order("asc")
      .take(cap * 4)
    // Recurring section events: same shape as `upcoming`, scoped to
    // this section.
    const recurringPool = await ctx.db
      .query("events")
      .withIndex("by_section_starts", (q) =>
        q
          .eq("sectionId", section._id)
          .eq("status", "approved")
          .lt("startsAt", now),
      )
      .order("desc")
      .take(200)
    type ScoredEvent = (typeof direct)[number] & { _sortKey: number }
    const scored: Array<ScoredEvent> = []
    const seen = new Set<string>()
    for (const e of direct) {
      seen.add(e._id as string)
      scored.push({ ...e, _sortKey: e.startsAt })
    }
    for (const e of recurringPool) {
      if (seen.has(e._id as string)) continue
      if (!e.recurrenceRule) continue
      const inst = (e.recurrenceInstances ?? []).find(
        (t) => t >= now && t < horizon,
      )
      if (inst === undefined) continue
      seen.add(e._id as string)
      scored.push({ ...e, _sortKey: inst })
    }
    scored.sort((a, b) => a._sortKey - b._sortKey)
    return await Promise.all(
      scored.slice(0, cap).map((e) => hydrate(ctx, e)),
    )
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

// Public view beacon — every drawer / detail-page open fires this from
// the client. Inserts one row into the `eventViews` log; the nightly
// `popularity:cronTick` rolls those rows into `events.viewCount30d`
// so the Popular rail re-ranks. The client dedupes per session in
// `useOpenEventDrawer`, so a refresh / re-open doesn't inflate the
// count. We silently no-op on bad eventIds + non-approved rows so
// drive-by callers can't pump dead rows into the leaderboard.
export const recordView = mutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId)
    if (!event || event.status !== "approved") return
    await ctx.db.insert("eventViews", {
      eventId,
      viewedAt: Date.now(),
    })
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
    const stale: Array<{
      _id: Id<"events">
      title: string
      dek?: string
      description?: string
      heroCaption?: string
      tags?: Array<string>
      locationName?: string
      sectionSlug?: string
    }> = []
    for (const e of all) {
      const hash = eventSourceHash({
        title: e.title,
        dek: e.dek,
      })
      const tr = e.translations?.es
      if (!tr || tr.sourceHash !== hash) {
        const sectionSlug = e.sectionId
          ? (await ctx.db.get(e.sectionId))?.slug
          : undefined
        stale.push({
          _id: e._id,
          title: e.title,
          dek: e.dek,
          description: e.description,
          heroCaption: e.heroCaption,
          tags: e.tags,
          locationName: e.locationName,
          sectionSlug,
        })
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
      dek: v.string(),
      // Legacy field kept on the validator only so older callers
      // that still pass it don't break. New translations write
      // empty string here — the frontend reads `dek`.
      description: v.optional(v.string()),
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
    // Use the public `get` (no auth gate) — the scheduler / cron fires
    // this without a user identity, so `getByIdAdmin` would 401. Only
    // approved events are returned, which matches what the translation
    // pipeline operates on (`needingTranslation` already filters by
    // status=approved).
    const event = await ctx.runQuery(api.events.get, { id: eventId })
    if (!event) return { translated: false }
    // Source for translation = title + dek. Legacy events written
    // before the dek-only switch may only have description text;
    // fall back to it so they translate cleanly before they get
    // backfilled.
    const sourceDek = event.dek ?? event.description ?? ""
    if (!sourceDek.trim()) return { translated: false }
    const sourceHash = eventSourceHash({ title: event.title, dek: sourceDek })
    if (event.translations?.es?.sourceHash === sourceHash) {
      return { translated: false }
    }
    const reservation = await ctx.runMutation(internal.budget.reserve, {
      estimatedCents: estimatedCallCents("claude-haiku-4-5-20251001"),
      label: "translateEvent",
    })
    if (!reservation.allowed) return { translated: false }
    const result = await generateEventTranslation({
      model: "claude-haiku-4-5-20251001",
      event: {
        title: event.title,
        dek: sourceDek,
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
        dek: result.dek,
        description: "",
        heroCaption: result.heroCaption,
      },
      sourceHash,
    })
    return { translated: true }
  },
})

// Cache lookup — returns the stored ES translation when a previous
// event with the same EN sourceHash has already been translated.
// Reused by `drainEventTranslationsBatched` to skip Haiku entirely
// on cache hits.
export const translationCacheLookup = internalQuery({
  args: { sourceHashes: v.array(v.string()) },
  handler: async (ctx, { sourceHashes }) => {
    const out: Array<{
      sourceHash: string
      title: string
      dek: string
      heroCaption?: string
    }> = []
    for (const hash of sourceHashes) {
      const row = await ctx.db
        .query("translationCache")
        .withIndex("by_hash", (q) => q.eq("sourceHash", hash))
        .unique()
      if (row) {
        out.push({
          sourceHash: hash,
          title: row.title,
          dek: row.dek,
          heroCaption: row.heroCaption,
        })
      }
    }
    return out
  },
})

// Cache write. Idempotent: re-running on a hit bumps `hits` instead
// of inserting a duplicate.
export const translationCachePut = internalMutation({
  args: {
    sourceHash: v.string(),
    title: v.string(),
    dek: v.string(),
    heroCaption: v.optional(v.string()),
  },
  handler: async (ctx, { sourceHash, title, dek, heroCaption }) => {
    const existing = await ctx.db
      .query("translationCache")
      .withIndex("by_hash", (q) => q.eq("sourceHash", sourceHash))
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, { hits: existing.hits + 1 })
      return
    }
    await ctx.db.insert("translationCache", {
      sourceHash,
      title,
      dek,
      heroCaption,
      createdAt: Date.now(),
      hits: 1,
    })
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
    return await drainEventTranslations(ctx, maxEvents ?? 10)
  },
})

// Manual / non-gated drain — same loop as the cron-fired variant, but
// without the `cronsEnabled()` short-circuit. Useful for one-shot
// backfills after a big drain, on dev (where CRONS_ENABLED is unset),
// or when an editor explicitly wants the queue flushed now.
//
// Run: `npx convex run events:drainTranslationsNow '{"maxEvents": 100}'`
export const drainTranslationsNow = internalAction({
  args: { maxEvents: v.optional(v.number()) },
  handler: async (
    ctx,
    { maxEvents },
  ): Promise<{
    processed: number
    translated: number
    errors: number
  }> => drainEventTranslations(ctx, maxEvents ?? 50),
})

// Drain the backlog of events needing ES translation. Two-stage:
//   1. Cache lookup — events whose EN sourceHash matches a previously
//      translated row get their ES copy written for free (no Haiku
//      call). This is the dominant case for syndicated listings,
//      Eventbrite cross-posts and ICS clones.
//   2. Batched Haiku call — remaining cache misses are translated in
//      groups of up to BATCH_SIZE so we pay one shared prompt cost per
//      batch instead of one per event. Each batch is gated by
//      `budget.reserve` (returns `lights-out` when LLM is disabled).
async function drainEventTranslations(
  ctx: ActionCtx,
  cap: number,
): Promise<{ processed: number; translated: number; errors: number }> {
  const BATCH_SIZE = 20
  const stale = await ctx.runQuery(api.events.needingTranslation, {
    limit: cap,
  })
  if (stale.length === 0) return { processed: 0, translated: 0, errors: 0 }

  // Pre-compute each event's source text + hash. Skip rows that have
  // no usable dek source — same guard as `translateEventAction`.
  type Candidate = {
    eventId: Id<"events">
    title: string
    dek: string
    heroCaption?: string
    sectionSlug?: string
    tags: ReadonlyArray<string>
    locationName?: string
    sourceHash: string
  }
  const candidates: Array<Candidate> = []
  for (const s of stale) {
    const sourceDek = s.dek ?? s.description ?? ""
    if (!sourceDek.trim()) continue
    candidates.push({
      eventId: s._id,
      title: s.title,
      dek: sourceDek,
      heroCaption: s.heroCaption,
      sectionSlug: s.sectionSlug,
      tags: s.tags ?? [],
      locationName: s.locationName,
      sourceHash: eventSourceHash({ title: s.title, dek: sourceDek }),
    })
  }

  let processed = candidates.length
  let translated = 0
  let errors = 0

  // Stage 1 — cache hits.
  const hashes = Array.from(new Set(candidates.map((c) => c.sourceHash)))
  const cached = await ctx.runQuery(internal.events.translationCacheLookup, {
    sourceHashes: hashes,
  })
  const cacheByHash = new Map(cached.map((c) => [c.sourceHash, c]))
  const misses: Array<Candidate> = []
  for (const c of candidates) {
    const hit = cacheByHash.get(c.sourceHash)
    if (hit) {
      try {
        await ctx.runMutation(internal.events.setTranslation, {
          eventId: c.eventId,
          lang: "es",
          translation: {
            title: hit.title,
            dek: hit.dek,
            description: "",
            heroCaption: hit.heroCaption,
          },
          sourceHash: c.sourceHash,
        })
        // Bump the hit counter so we have a signal for future eviction.
        await ctx.runMutation(internal.events.translationCachePut, {
          sourceHash: c.sourceHash,
          title: hit.title,
          dek: hit.dek,
          heroCaption: hit.heroCaption,
        })
        translated += 1
      } catch {
        errors += 1
      }
    } else {
      misses.push(c)
    }
  }

  if (misses.length === 0) {
    return { processed, translated, errors }
  }

  // Stage 2 — batched Haiku calls for cache misses.
  for (let i = 0; i < misses.length; i += BATCH_SIZE) {
    const batch = misses.slice(i, i + BATCH_SIZE)
    const reservation = await ctx.runMutation(internal.budget.reserve, {
      // One shared prompt + N tool entries — ~1.5x a single-event call
      // for a 20-event batch. Budget on the high end.
      estimatedCents: Math.ceil(
        estimatedCallCents("claude-haiku-4-5-20251001") * 1.5,
      ),
      label: "translateEventBatch",
    })
    if (!reservation.allowed) break
    try {
      const results = await generateEventBatchTranslation({
        model: "claude-haiku-4-5-20251001",
        events: batch.map((b) => ({
          key: b.sourceHash,
          title: b.title,
          dek: b.dek,
          heroCaption: b.heroCaption,
          sectionSlug: b.sectionSlug,
          tags: b.tags,
          locationName: b.locationName,
        })),
      })
      for (const b of batch) {
        const t = results.get(b.sourceHash)
        if (!t) continue
        try {
          await ctx.runMutation(internal.events.setTranslation, {
            eventId: b.eventId,
            lang: "es",
            translation: {
              title: t.title,
              dek: t.dek,
              description: "",
              heroCaption: t.heroCaption,
            },
            sourceHash: b.sourceHash,
          })
          await ctx.runMutation(internal.events.translationCachePut, {
            sourceHash: b.sourceHash,
            title: t.title,
            dek: t.dek,
            heroCaption: t.heroCaption,
          })
          translated += 1
        } catch {
          errors += 1
        }
      }
    } catch {
      errors += batch.length
    }
  }
  return { processed, translated, errors }
}

// ───────── Haiku event enrichment (tags + neighborhood + section) ─────────

// reviewQueue + approveBatch removed — total automation, no human review.

// ── Geocoding (Mapbox) ───────────────────────────────────────────────
// Lookup cached coords for an address; returns null on miss. Used by
// the geocodeEventAction below so the mutation half of the
// query-write cycle stays cheap.
export const geocodeCacheLookup = internalQuery({
  args: { normalizedAddress: v.string() },
  handler: async (ctx, { normalizedAddress }) => {
    return await ctx.db
      .query("geocodeCache")
      .withIndex("by_normalized", (q) =>
        q.eq("normalizedAddress", normalizedAddress),
      )
      .unique()
  },
})

export const geocodeCacheUpsert = internalMutation({
  args: {
    normalizedAddress: v.string(),
    lat: v.number(),
    lng: v.number(),
    placeName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("geocodeCache")
      .withIndex("by_normalized", (q) =>
        q.eq("normalizedAddress", args.normalizedAddress),
      )
      .unique()
    const now = Date.now()
    if (existing) {
      await ctx.db.patch(existing._id, {
        lat: args.lat,
        lng: args.lng,
        placeName: args.placeName,
        fetchedAt: now,
      })
    } else {
      await ctx.db.insert("geocodeCache", { ...args, fetchedAt: now })
    }
  },
})

export const patchEventCoords = internalMutation({
  args: { eventId: v.id("events"), lat: v.number(), lng: v.number() },
  handler: async (ctx, { eventId, lat, lng }) => {
    await ctx.db.patch(eventId, { lat, lng })
  },
})

// Cache-first geocode pass. Reads `geocodeCache` for the event's
// normalized address; on miss, calls Mapbox (bbox-scoped to
// Miami-Dade), writes the cache, patches the event. No-ops when the
// event already has lat/lng OR when MAPBOX_TOKEN isn't configured.
export const geocodeEventAction = internalAction({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }): Promise<void> => {
    const event = await ctx.runQuery(api.events.get, { id: eventId })
    if (!event) return
    if (typeof event.lat === "number" && typeof event.lng === "number") return
    // Build the best query string we can from what the event carries.
    // Address wins (most specific), then "Venue, Miami, FL", then the
    // venue name alone. Anything shorter than ~4 chars is skipped to
    // avoid burning Mapbox calls on noise.
    const candidates: Array<string> = []
    if (event.locationAddress && event.locationAddress.length >= 5) {
      candidates.push(event.locationAddress)
    }
    if (event.locationName && event.locationName.length >= 3) {
      candidates.push(`${event.locationName}, Miami, FL`)
      candidates.push(event.locationName)
    }
    if (candidates.length === 0) return
    const { geocodeViaMapbox, normalizeAddress } = await import("./lib/geocode")
    for (const query of candidates) {
      const normalized = normalizeAddress(query)
      const cached = await ctx.runQuery(
        internal.events.geocodeCacheLookup,
        { normalizedAddress: normalized },
      )
      if (cached) {
        await ctx.runMutation(internal.events.patchEventCoords, {
          eventId,
          lat: cached.lat,
          lng: cached.lng,
        })
        return
      }
      const result = await geocodeViaMapbox(query)
      if (!result) continue
      await ctx.runMutation(internal.events.geocodeCacheUpsert, {
        normalizedAddress: normalized,
        lat: result.lat,
        lng: result.lng,
        placeName: result.placeName,
      })
      await ctx.runMutation(internal.events.patchEventCoords, {
        eventId,
        lat: result.lat,
        lng: result.lng,
      })
      return
    }
  },
})

// One-shot backfill: enqueue geocodeEventAction for every existing
// event missing lat/lng but with something a geocoder can use.
// Bounded by `limit` so a single tick doesn't try to schedule
// thousands of actions; safe to re-run.
export const backfillEventGeocoding = internalAction({
  args: { limit: v.optional(v.number()) },
  handler: async (
    ctx,
    { limit },
  ): Promise<{ scheduled: number; scanned: number }> => {
    return await ctx.runMutation(
      internal.events.backfillEventGeocodingMut,
      { limit: limit ?? 100 },
    )
  },
})

// Diagnostic — what events do we still have without coords?
export const ungeocodedEvents = internalQuery({
  args: {},
  handler: async (ctx) => {
    const events = await ctx.db
      .query("events")
      .withIndex("by_status_published", (q) => q.eq("status", "approved"))
      .order("desc")
      .take(1500)
    return events
      .filter((e) => typeof e.lat !== "number")
      .map((e) => ({
        title: e.title.slice(0, 80),
        locationName: e.locationName ?? null,
        locationAddress: e.locationAddress ?? null,
      }))
  },
})

export const backfillEventGeocodingMut = internalMutation({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const events = await ctx.db
      .query("events")
      .withIndex("by_status_published", (q) => q.eq("status", "approved"))
      .order("desc")
      .take(1500)
    let scheduled = 0
    let scanned = 0
    for (const e of events) {
      if (scheduled >= limit) break
      scanned += 1
      if (typeof e.lat === "number" && typeof e.lng === "number") continue
      const hasUsableLocation =
        (e.locationAddress && e.locationAddress.length >= 5) ||
        (e.locationName && e.locationName.length >= 3)
      if (!hasUsableLocation) continue
      // Stagger by 500ms so we don't burst the Mapbox endpoint when
      // the cache is cold.
      await ctx.scheduler.runAfter(
        scheduled * 500,
        internal.events.geocodeEventAction,
        { eventId: e._id },
      )
      scheduled += 1
    }
    return { scheduled, scanned }
  },
})

// empty tags; this query feeds the cron + the manual drain.
export const needingEnrichment = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const cap = limit ?? 20
    const events = await ctx.db
      .query("events")
      .withIndex("by_status_starts", (q) => q.eq("status", "approved"))
      .order("desc")
      .take(200)
    const stale: Array<{ _id: Id<"events">; title: string }> = []
    for (const e of events) {
      if (e.tags && e.tags.length > 0) continue
      stale.push({ _id: e._id, title: e.title })
      if (stale.length >= cap) break
    }
    return stale
  },
})

export const setEnrichment = internalMutation({
  args: {
    eventId: v.id("events"),
    tags: v.array(v.string()),
    neighborhoods: v.array(v.string()),
    sectionId: v.optional(v.id("sections")),
  },
  handler: async (ctx, { eventId, tags, neighborhoods, sectionId }) => {
    const cleaned = cleanTags(tags)
    const hoods = filterNeighborhoodSlugs(neighborhoods)
    const patch: Record<string, unknown> = {
      tags: cleaned,
      neighborhoods: hoods,
    }
    // Neighborhood-centroid coords if the event didn't have any yet
    // and Haiku gave us a slug we recognize.
    const existing = await ctx.db.get(eventId)
    if (
      existing &&
      existing.lat === undefined &&
      existing.lng === undefined &&
      hoods.length > 0
    ) {
      const coords = neighborhoodCoords(hoods[0])
      if (coords) {
        patch.lat = coords.lat
        patch.lng = coords.lng
      }
    }
    if (sectionId) patch.sectionId = sectionId
    await ctx.db.patch(eventId, patch)
  },
})

export const enrichEventAction = internalAction({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }): Promise<{ enriched: boolean }> => {
    const event = await ctx.runQuery(api.events.get, { id: eventId })
    if (!event) return { enriched: false }
    const reservation = await ctx.runMutation(internal.budget.reserve, {
      estimatedCents: estimatedCallCents("claude-haiku-4-5-20251001"),
      label: "enrichEvent",
    })
    if (!reservation.allowed) return { enriched: false }
    const sections = await ctx.runQuery(api.sections.list, {})
    const sectionSlugToId = new Map<string, Id<"sections">>()
    for (const s of sections) sectionSlugToId.set(s.slug, s._id)
    const result = await generateEventEnrichment({
      model: "claude-haiku-4-5-20251001",
      event: {
        title: event.title,
        description: event.description,
        locationName: event.locationName,
        locationAddress: event.locationAddress,
        currentSectionSlug: event.section?.slug,
      },
      sectionChoices: sections.map((s) => ({ slug: s.slug, name: s.name })),
    })
    if (!result) return { enriched: false }
    const overrideId = result.sectionSlug
      ? sectionSlugToId.get(result.sectionSlug)
      : undefined
    await ctx.runMutation(internal.events.setEnrichment, {
      eventId,
      tags: result.tags,
      neighborhoods: result.neighborhoodSlugs,
      sectionId: overrideId,
    })
    return { enriched: true }
  },
})

// Manual / non-gated drain for the enrichment backlog. Mirrors
// drainTranslationsNow — useful after a big ingest pass or on dev
// where CRONS_ENABLED is unset.
//
// Run: `npx convex run events:drainEnrichmentNow '{"maxEvents": 100}'`
export const drainEnrichmentNow = internalAction({
  args: { maxEvents: v.optional(v.number()) },
  handler: async (
    ctx,
    { maxEvents },
  ): Promise<{ processed: number; enriched: number; errors: number }> =>
    drainEventEnrichment(ctx, maxEvents ?? 50),
})

// Cron-fired version — gated on CRONS_ENABLED so dev doesn't double-bill.
export const bulkEnrichEventsInternal = internalAction({
  args: { maxEvents: v.optional(v.number()) },
  handler: async (
    ctx,
    { maxEvents },
  ): Promise<{ processed: number; enriched: number; errors: number }> => {
    if (!cronsEnabled()) {
      return { processed: 0, enriched: 0, errors: 0 }
    }
    return await drainEventEnrichment(ctx, maxEvents ?? 20)
  },
})

async function drainEventEnrichment(
  ctx: ActionCtx,
  cap: number,
): Promise<{ processed: number; enriched: number; errors: number }> {
  const stale = await ctx.runQuery(api.events.needingEnrichment, { limit: cap })
  let processed = 0
  let enriched = 0
  let errors = 0
  for (const s of stale) {
    processed += 1
    try {
      const r = await ctx.runAction(internal.events.enrichEventAction, {
        eventId: s._id,
      })
      if (r.enriched) enriched += 1
    } catch {
      errors += 1
    }
  }
  return { processed, enriched, errors }
}

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
    /** Classifier confidence (0..1) forwarded from agents.ts.
     *  Defaults to 0.5 when omitted — matches the "no signal"
     *  midpoint so existing callers without classifier hookup get a
     *  neutral baseline. */
    classifierConfidence: v.optional(v.number()),
    classifierReason: v.optional(v.string()),
  },
  handler: async (
    ctx,
    {
      event,
      agentSlug,
      agentRunId,
      derivedFromItems,
      classifierConfidence,
      classifierReason,
    },
  ) => {
    // Normalize SHOUTING titles before dedup or insert. We only
    // rewrite when the title's letter content is fully uppercase —
    // intentionally-cased copy passes through untouched. Run before
    // dedup keys so the normalized title also drives the series /
    // dedupe matching, otherwise the same event in shouty vs proper
    // case would dedupe as two different rows.
    event = { ...event, title: maybeTitleCase(event.title) }

    // Dedup, three-pass:
    //   0. Series key: normalized-title + normalized-venue, no date.
    //      Catches recurring exhibits running across many days that
    //      pass 1 splits into N separate rows. On a hit we keep the
    //      earliest-upcoming row and roll the new showing into it.
    //   1. Primary key: normalized-title + same-day. Cheap, indexed.
    //   2. Fallback: same-day candidates scored on URL canon + venue
    //      + ±60min + title overlap. Catches near-duplicates whose
    //      titles diverge ("Heat vs. Bucks" / "Miami Heat — game day").
    // When any pass finds a match, the new source's citations +
    // derivedFromItems get folded into the existing row.
    const seriesKey = eventSeriesKey({
      title: event.title,
      locationName: event.locationName,
    })
    let existing: Doc<"events"> | null = null
    let seriesMatch = false
    if (seriesKey) {
      const candidates = await ctx.db
        .query("events")
        .withIndex("by_series_key", (q) => q.eq("seriesKey", seriesKey))
        .take(20)
      const nowMs = Date.now()
      // Prefer the earliest still-upcoming row in the series; that's the
      // "next showing" the homepage card should point at.
      const upcoming = candidates
        .filter((c) => c.startsAt >= nowMs - 24 * 3_600_000)
        .sort((a, b) => a.startsAt - b.startsAt)
      if (upcoming.length > 0) {
        existing = upcoming[0]
        seriesMatch = true
      }
    }
    const dedupeKey = eventDedupeKey({
      title: event.title,
      startsAt: event.startsAt,
    })
    if (!existing) {
      existing = await ctx.db
        .query("events")
        .withIndex("by_dedupe_key", (q) => q.eq("dedupeKey", dedupeKey))
        .first()
    }
    if (!existing) {
      // Pass 2 — same-day candidate scan. Bound the window to ±18h
      // so we don't load the whole table. Scans all statuses (not just
      // approved) so a pending_review row from one source still folds
      // an incoming approved row from another, matching Pass 0/1's
      // status-agnostic behavior.
      const dayStart = event.startsAt - 18 * 3_600_000
      const dayEnd = event.startsAt + 18 * 3_600_000
      const sameDay = await ctx.db
        .query("events")
        .withIndex("by_starts", (q) =>
          q.gte("startsAt", dayStart).lt("startsAt", dayEnd),
        )
        .take(80)
      for (const cand of sameDay) {
        const score = similarityScore(
          {
            title: event.title,
            startsAt: event.startsAt,
            locationName: event.locationName,
            url: event.url,
          },
          {
            title: cand.title,
            startsAt: cand.startsAt,
            locationName: cand.locationName,
            url: cand.url,
          },
        )
        if (score >= 0.7) {
          existing = cand
          break
        }
      }
    }
    if (existing) {
      const mergedCitations = [
        ...(existing.citations ?? []),
        ...(event.citations ?? []),
      ]
      // Drop dup citations by URL.
      const seen = new Set<string>()
      const dedupedCitations = mergedCitations.filter((c) => {
        if (seen.has(c.url)) return false
        seen.add(c.url)
        return true
      })
      const mergedItems = Array.from(
        new Set([
          ...((existing.derivedFromItems ?? []) as Array<string>),
          ...derivedFromItems.map((i) => i as unknown as string),
        ]),
      ) as unknown as Array<Id<"ingestedItems">>
      const patch: Partial<Doc<"events">> = {
        citations: dedupedCitations,
        derivedFromItems: mergedItems,
      }
      // Series merge: if the existing row's next showing is later than
      // the incoming one, advance the card to the earlier date so the
      // homepage points at the soonest upcoming showing. End time
      // tracks the new showing too. Backfill the seriesKey on the row
      // if it never had one (older inserts before this field existed).
      if (seriesMatch && event.startsAt < existing.startsAt) {
        patch.startsAt = event.startsAt
        patch.endsAt = event.endsAt
        patch.allDay = event.allDay
      }
      if (seriesKey && existing.seriesKey !== seriesKey) {
        patch.seriesKey = seriesKey
      }
      await ctx.db.patch(existing._id, patch)
      return existing._id
    }

    const slug = await uniqueSlug(
      ctx,
      event.slug || event.title,
      event.startsAt,
    )
    const tags = cleanTags(event.tags ?? [])
    const neighborhoods = filterNeighborhoodSlugs(event.neighborhoods ?? [])

    // Neighborhood-centroid geocoding — when the event carries a
    // neighborhood slug but no explicit lat/lng, plot it at the
    // centroid of the first matching neighborhood. Cheap, no API
    // call, lets the map view light up immediately. Per-address
    // Mapbox geocoding can layer on top later.
    let { lat, lng } = event
    if (lat === undefined && lng === undefined && neighborhoods.length > 0) {
      const coords = neighborhoodCoords(neighborhoods[0])
      if (coords) {
        lat = coords.lat
        lng = coords.lng
      }
    }

    // Total automation — every event auto-approves. Quality score
    // still computed and stored so ranking + a future low-confidence
    // filter can act on it, but no human review step.
    const quality = scoreEventQuality({
      title: event.title,
      dek: event.dek,
      description: event.description,
      body: event.body,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      allDay: event.allDay,
      locationName: event.locationName,
      locationAddress: event.locationAddress,
      price: event.price,
      url: event.url,
      hasCoords: typeof lat === "number" && typeof lng === "number",
      classifierConfidence: classifierConfidence ?? 0.5,
    })
    const status = "approved" as const
    void quality.autoApprove
    const now = Date.now()
    const id = await ctx.db.insert("events", {
      ...event,
      slug,
      tags,
      neighborhoods,
      lat,
      lng,
      searchableText: buildSearchableText(
        event.title,
        event.description,
        tags,
        event.dek,
        event.body,
      ),
      status,
      publishedAt: status === "approved" ? now : undefined,
      agentSlug,
      agentRunId,
      derivedFromItems,
      createdAt: now,
      dedupeKey,
      seriesKey: seriesKey ?? undefined,
      qualityScore: quality.score,
      classifierReason,
    })
    // Schedule auto-translation (ES), auto-enrichment (tags +
    // neighborhood), and geocoding. All three are budgeted; if the
    // daily cap is hit they silently no-op and the bulk drain crons
    // catch up next day. Geocoding only fires when the event has an
    // address AND no lat/lng yet (insertExtracted may have already
    // filled them in from the neighborhood centroid).
    await ctx.scheduler.runAfter(
      60_000,
      internal.events.translateEventAction,
      { eventId: id, lang: "es" },
    )
    await ctx.scheduler.runAfter(
      90_000,
      internal.events.enrichEventAction,
      { eventId: id },
    )
    if (event.locationAddress && event.locationAddress.length >= 5) {
      await ctx.scheduler.runAfter(
        30_000,
        internal.events.geocodeEventAction,
        { eventId: id },
      )
    }
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
