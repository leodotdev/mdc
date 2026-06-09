import { v } from "convex/values"

import { internal } from "./_generated/api"
import { internalAction, internalMutation } from "./_generated/server"
import { classifyEvent } from "./lib/classify"
import {
  eventSeriesKey,
  normalizeTitle,
  normalizeVenue,
} from "./lib/eventDedupe"
import { isShouty, maybeTitleCase } from "./lib/titleCase"

// One-shot strip for redundant location tags. Every event on
// miami.community is local by definition, so tags like "miami-dade" carry
// no signal and clutter the tag list.
//
// Run with:
//   npx convex run migrations:stripTag '{"tag":"miami-dade"}'

// Backfill `searchableText` on every article from its current title + dek
// + tags so the search index covers legacy docs. Idempotent — re-running
// just refreshes the blob.
//
// Run with:
//   npx convex run migrations:backfillSearchable

// =====================================================================
// Article wipe — events-only pivot Phase 4 (narrow). Deletes every row
// from the articles table plus every article_authors join. Idempotent.
//
// Reason: the events-only pivot made articles dead content. The
// front-end no longer reads from the table; the LLM no longer writes
// to it. Keeping the rows around just bloats the schema search index
// and adds noise to the admin dashboard.
//
// Run dev:  npx convex run migrations:wipeArticles
// Run prod: npx convex run migrations:wipeArticles --prod
//
// Note: events.relatedArticleIds entries will be left dangling — the
// hydrate path already handles a null ctx.db.get() gracefully (see
// events.ts:hydrate). storyArcs with only event members are unaffected;
// arcs with only article members become empty but harmless. We don't
// touch the storyArcs table — a later cleanup pass can prune empties
// if it's worth the round trip.
// =====================================================================


// =====================================================================
// 2026-05 section restructure for the events-only world. The legacy
// "news" umbrella (politics/business/real-estate/opinion/investigations)
// made sense when articles were the primary content type. After the
// events pivot it doesn't — events file by topic, not by news/feature
// distinction. This migration:
//
//   1. Inserts new sections: `tech` (top-level), `history` (sub of
//      science). `museums` gets re-parented from arts → science to
//      gather all the museum/heritage/learning events in one umbrella.
//   2. Promotes politics/business/real-estate to top-level (parentId
//      cleared — they were children of "news").
//   3. Refreshes name/description/order on every surviving section so
//      the catalog matches the post-pivot copy.
//   4. Reparents events under deleted sections — news+opinion+
//      investigations → politics; miami-history → history.
//   5. Deletes news / opinion / investigations / miami-history.
//
// Run dev:  npx convex run migrations:migrate2026Sections
// Run prod: npx convex run migrations:migrate2026Sections --prod
// Idempotent — re-running is a no-op once the new shape exists.
// =====================================================================

// Canonical post-migration catalog. Mirrors the SECTIONS array in
// seed.ts; duplicated here so the migration can run independently of
// the seed and the seed file isn't loaded over the network just to
// read its constant.
const CANONICAL_SECTIONS_2026: Array<{
  slug: string
  name: string
  description: string
  accentColor: string
  order: number
  parentSlug?: string
}> = [
  {
    slug: "politics",
    name: "Politics",
    description:
      "Civic life in Miami-Dade — commission meetings, town halls, candidate forums, neighborhood-association meetups, public-comment nights.",
    accentColor: "oklch(0.586 0.253 17.585)",
    order: 10,
  },
  {
    slug: "business",
    name: "Business",
    description:
      "Business events across Miami — conferences, ribbon-cuttings, mixers, networking, port and trade.",
    accentColor: "oklch(0.596 0.145 163.225)",
    order: 20,
  },
  {
    slug: "tech",
    name: "Tech",
    description:
      "Tech meetups, hackathons, demo days, founder gatherings — Refresh Miami, eMerge, CIC, Endeavor.",
    accentColor: "oklch(0.546 0.245 262.881)",
    order: 25,
  },
  {
    slug: "real-estate",
    name: "Real Estate",
    description:
      "Open houses, developer briefings, broker meetups, real-estate panels and tours.",
    accentColor: "oklch(0.609 0.126 221.723)",
    order: 30,
  },
  {
    slug: "science",
    name: "Science",
    description:
      "Museum nights, lectures, history walks, climate panels, nature programs — Miami's research and learning beats. Sub-sections: museums, history, climate, nature.",
    accentColor: "oklch(0.627 0.194 149.214)",
    order: 80,
  },
  {
    slug: "museums",
    name: "Museums",
    description:
      "PAMM, Frost, Bass, Vizcaya, ICA, HistoryMiami — exhibition openings, members nights, lectures, family days.",
    accentColor: "oklch(0.588 0.158 241.966)",
    order: 82,
    parentSlug: "science",
  },
  {
    slug: "history",
    name: "History",
    description:
      "Historical events — heritage walks, archival exhibits, talks on Miami's past.",
    accentColor: "oklch(0.6 0.118 184.704)",
    order: 84,
    parentSlug: "science",
  },
  {
    slug: "climate",
    name: "Climate",
    description:
      "Climate-focused events — sea-level-rise talks, hurricane prep, sustainability panels, resilience workshops.",
    accentColor: "oklch(0.627 0.194 149.214)",
    order: 86,
    parentSlug: "science",
  },
  {
    slug: "nature",
    name: "Nature",
    description:
      "Everglades programs, wildlife events, beach cleanups, bird walks, reef and park talks.",
    accentColor: "oklch(0.596 0.145 163.225)",
    order: 88,
    parentSlug: "science",
  },
]

// Sections to delete after re-parenting events away from them. The
// values are the slugs new events should be assigned to.
const SECTIONS_TO_DELETE: Record<string, string> = {
  news: "politics",
  opinion: "politics",
  investigations: "politics",
  "miami-history": "history",
}

export const migrate2026Sections = internalMutation({
  args: {},
  handler: async (ctx) => {
    const log: Array<string> = []

    // Index existing sections by slug for lookups.
    const allSections = await ctx.db.query("sections").collect()
    const bySlug = new Map(allSections.map((s) => [s.slug, s]))

    // 1. Upsert / patch every section in the canonical list. New
    //    sections (tech, history) get inserted; existing ones get
    //    their name/description/order/accentColor refreshed AND their
    //    parentId set (or cleared) to match the new tree.
    let upserted = 0
    let patched = 0
    // First pass: ensure every entry exists (insert if missing). We
    // need IDs available before we can wire up parents.
    for (const s of CANONICAL_SECTIONS_2026) {
      if (!bySlug.has(s.slug)) {
        const id = await ctx.db.insert("sections", {
          slug: s.slug,
          name: s.name,
          description: s.description,
          accentColor: s.accentColor,
          order: s.order,
        })
        // Refresh local index so the parent-resolution pass sees it.
        bySlug.set(s.slug, {
          _id: id,
          _creationTime: Date.now(),
          slug: s.slug,
          name: s.name,
          description: s.description,
          accentColor: s.accentColor,
          order: s.order,
        })
        upserted += 1
        log.push(`inserted section ${s.slug}`)
      }
    }
    // Second pass: refresh fields + wire parents.
    for (const s of CANONICAL_SECTIONS_2026) {
      const cur = bySlug.get(s.slug)
      if (!cur) continue
      const parentId = s.parentSlug
        ? bySlug.get(s.parentSlug)?._id
        : undefined
      await ctx.db.patch(cur._id, {
        name: s.name,
        description: s.description,
        accentColor: s.accentColor,
        order: s.order,
        // Explicitly null when no parent so the field clears for the
        // promoted-to-top-level case (politics/business/real-estate).
        parentId,
      })
      patched += 1
    }

    // 2. Re-parent events filed under to-be-deleted sections.
    let eventsReparented = 0
    for (const [deadSlug, targetSlug] of Object.entries(SECTIONS_TO_DELETE)) {
      const dead = bySlug.get(deadSlug)
      if (!dead) continue
      const target = bySlug.get(targetSlug)
      if (!target) {
        log.push(
          `WARN: target section "${targetSlug}" missing while reparenting from "${deadSlug}"`,
        )
        continue
      }
      const events = await ctx.db
        .query("events")
        .withIndex("by_section_starts", (q) => q.eq("sectionId", dead._id))
        .collect()
      for (const e of events) {
        await ctx.db.patch(e._id, { sectionId: target._id })
        eventsReparented += 1
      }
      if (events.length > 0) {
        log.push(
          `reparented ${events.length} events from ${deadSlug} → ${targetSlug}`,
        )
      }
    }

    // 3. Delete the dead sections themselves.
    let sectionsDeleted = 0
    for (const deadSlug of Object.keys(SECTIONS_TO_DELETE)) {
      const dead = bySlug.get(deadSlug)
      if (!dead) continue
      await ctx.db.delete(dead._id)
      sectionsDeleted += 1
      log.push(`deleted section ${deadSlug}`)
    }

    return {
      upserted,
      patched,
      eventsReparented,
      sectionsDeleted,
      log,
    }
  },
})

// =====================================================================
// 2026-05 food-sub trim. Reviews / recipes / closings were
// article-shape categories that don't survive the events-only pivot —
// you can't have an "event" that is a single-restaurant review or a
// recipe. Openings stays (it IS an event type: opening night, ribbon-
// cutting, soft launch). The remaining three get folded back into the
// food parent so the section dropdown stops claiming categories the
// site no longer serves.
//
// Run dev:  npx convex run migrations:trimFoodSubsections
// Run prod: npx convex run migrations:trimFoodSubsections --prod
// Idempotent — re-running is a no-op once the slugs are gone.
// =====================================================================

const FOOD_SUBS_TO_DELETE: ReadonlyArray<string> = [
  "food-reviews",
  "miami-recipes",
  "food-closings",
]

const SCHOOL_SUBS_TO_DELETE: ReadonlyArray<string> = [
  "middle-schools",
  "elementary-schools",
]

// Drop the K-8 school subsections. Reparents anything tagged there
// onto the umbrella `education` section so we don't lose rows.
export const trimSchoolSubsections = internalMutation({
  args: {},
  handler: async (ctx) => {
    const log: Array<string> = []
    const all = await ctx.db.query("sections").collect()
    const bySlug = new Map(all.map((s) => [s.slug, s]))
    const parent = bySlug.get("education")
    if (!parent) {
      log.push("WARN: no `education` parent section; aborting before any change")
      return { eventsReparented: 0, articlesReparented: 0, sourcesUpdated: 0, sectionsDeleted: 0, log }
    }
    let eventsReparented = 0
    let articlesReparented = 0
    let sourcesUpdated = 0
    let sectionsDeleted = 0
    for (const slug of SCHOOL_SUBS_TO_DELETE) {
      const dead = bySlug.get(slug)
      if (!dead) continue
      const events = await ctx.db
        .query("events")
        .withIndex("by_section_starts", (q) => q.eq("sectionId", dead._id))
        .collect()
      for (const e of events) {
        await ctx.db.patch(e._id, { sectionId: parent._id })
        eventsReparented += 1
      }
      if (events.length > 0) {
        log.push(`reparented ${events.length} events from ${slug} → education`)
      }
      // Drop the dead section id from any sources that reference it.
      const sources = await ctx.db.query("sources").collect()
      for (const s of sources) {
        if (!s.sectionIds?.includes(dead._id)) continue
        const next = s.sectionIds.filter((id) => id !== dead._id)
        await ctx.db.patch(s._id, { sectionIds: next })
        sourcesUpdated += 1
      }
      await ctx.db.delete(dead._id)
      sectionsDeleted += 1
      log.push(`deleted section ${slug}`)
    }
    return { eventsReparented, articlesReparented, sourcesUpdated, sectionsDeleted, log }
  },
})

export const trimFoodSubsections = internalMutation({
  args: {},
  handler: async (ctx) => {
    const log: Array<string> = []
    const all = await ctx.db.query("sections").collect()
    const bySlug = new Map(all.map((s) => [s.slug, s]))
    const foodParent = bySlug.get("food")
    if (!foodParent) {
      log.push("WARN: no `food` parent section; aborting before any change")
      return { eventsReparented: 0, sectionsDeleted: 0, log }
    }
    let eventsReparented = 0
    let sectionsDeleted = 0
    for (const slug of FOOD_SUBS_TO_DELETE) {
      const dead = bySlug.get(slug)
      if (!dead) continue
      // Reparent events from the dead sub → food parent.
      const events = await ctx.db
        .query("events")
        .withIndex("by_section_starts", (q) => q.eq("sectionId", dead._id))
        .collect()
      for (const e of events) {
        await ctx.db.patch(e._id, { sectionId: foodParent._id })
        eventsReparented += 1
      }
      if (events.length > 0) {
        log.push(`reparented ${events.length} events from ${slug} → food`)
      }
      await ctx.db.delete(dead._id)
      sectionsDeleted += 1
      log.push(`deleted section ${slug}`)
    }
    return { eventsReparented, sectionsDeleted, log }
  },
})

// =====================================================================
// 2026-05 metrics wipe. The Miami in Numbers feature was retired in
// the events-only pivot — the homepage MetricsGrid, section-page
// metric rails, [[metric:slug]] inline embeds, and the daily Opus
// retroactive-extraction call all came out together. The `metrics`
// table is now dead weight; this migration empties it.
//
// The table itself stays in the schema for now so legacy rows that
// reference it can still validate. Drop the definition (and its
// indexes) in a follow-up push once the wipe is confirmed.
//
// Run dev:  npx convex run migrations:wipeMetrics
// Run prod: npx convex run migrations:wipeMetrics --prod
// =====================================================================

export const wipeMetricsBatch = internalMutation({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, { batchSize }) => {
    const cap = batchSize ?? 200
    const rows = await ctx.db.query("metrics").take(cap)
    for (const m of rows) await ctx.db.delete(m._id)
    return { deleted: rows.length, hasMore: rows.length === cap }
  },
})

export const wipeMetrics = internalAction({
  args: {},
  handler: async (ctx): Promise<{ totalDeleted: number; batches: number }> => {
    let totalDeleted = 0
    let batches = 0
    const MAX_BATCHES = 200
    for (let i = 0; i < MAX_BATCHES; i += 1) {
      const result: { deleted: number; hasMore: boolean } =
        await ctx.runMutation(internal.migrations.wipeMetricsBatch, {})
      totalDeleted += result.deleted
      batches += 1
      if (!result.hasMore) break
    }
    return { totalDeleted, batches }
  },
})

// =====================================================================
// 2026-05 cross-list museums under both science and arts. Museums sit
// at the intersection — Frost Science is science; PAMM/Bass/Vizcaya
// read as arts; HistoryMiami is heritage. Primary parent stays at
// science (where the Phase 4 section restructure moved it; that's the
// canonical breadcrumb), and `crossListedIn` adds arts as a secondary
// home so the section appears in arts's SubNav too and arts-level
// child-recursion picks up museum events.
//
// Idempotent.
// =====================================================================

export const crossListMuseums = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("sections").collect()
    const bySlug = new Map(all.map((s) => [s.slug, s]))
    const museums = bySlug.get("museums")
    const arts = bySlug.get("arts")
    if (!museums || !arts) {
      return {
        ok: false,
        reason: `missing section(s): museums=${!!museums} arts=${!!arts}`,
      }
    }
    const existing = museums.crossListedIn ?? []
    if (existing.includes(arts._id)) {
      return { ok: true, alreadySet: true }
    }
    await ctx.db.patch(museums._id, {
      crossListedIn: [...existing, arts._id],
    })
    return { ok: true, alreadySet: false }
  },
})

// =====================================================================
// 2026-05 associated-tags seed. Per-section tag synonyms drive the
// cross-section enrichment on /section/$slug pages — Books surfaces
// "jazz at Books & Books" (filed under music) because it's tagged
// "books", Museums surfaces talks tagged "lecture" or "exhibition",
// etc. Editors can adjust the lists later via /admin if a tag drifts.
// The LLM already tags events, so the lookup hits naturally.
//
// Run dev:  npx convex run migrations:seedAssociatedTags
// Run prod: npx convex run migrations:seedAssociatedTags --prod
// Idempotent — overwrites existing associatedTags with the curated
// set each run.
// =====================================================================

const ASSOCIATED_TAGS: Record<string, ReadonlyArray<string>> = {
  // Top-level — civic / business / tech / real estate.
  politics: [
    "politics",
    "commission",
    "town-hall",
    "public-comment",
    "candidate-forum",
    "council-meeting",
    "civic",
  ],
  business: [
    "business",
    "networking",
    "mixer",
    "ribbon-cutting",
    "chamber",
    "conference",
  ],
  tech: [
    "tech",
    "startup",
    "hackathon",
    "demo-day",
    "founders",
    "ai",
    "developer",
    "engineering",
  ],
  "real-estate": [
    "real-estate",
    "open-house",
    "broker",
    "developer",
    "real-estate-panel",
    "real-estate-tour",
  ],
  commerce: [
    "commerce",
    "retail",
    "store",
    "store-opening",
    "chamber-of-commerce",
    "pop-up-shop",
    "popup-shop",
    "market",
    "mall",
    "plaza",
    "boutique",
    "ribbon-cutting",
    "grand-opening",
    "small-business",
  ],

  // Sports — parent + each team sub gets its own lineage.
  sports: ["sports", "game", "tailgate", "match"],
  dolphins: ["dolphins", "nfl", "miami-dolphins"],
  heat: ["heat", "nba", "miami-heat"],
  marlins: ["marlins", "mlb", "miami-marlins"],
  panthers: ["panthers", "nhl", "florida-panthers"],
  "inter-miami": ["inter-miami", "mls", "soccer"],
  // Hurricanes = athletics ONLY. "um" / "university-of-miami" tags
  // belong to the academic UM section, so omit them here — otherwise
  // every general-UM event leaks into /sports/hurricanes.
  "the-u": ["the-u", "hurricanes", "miami-hurricanes"],
  "university-of-miami": ["um", "university-of-miami"],
  "miami-fc": ["miami-fc", "usl", "soccer"],
  "fiu-panthers": ["fiu", "fiu-panthers"],

  // Food family (now just food + food-openings).
  food: [
    "food",
    "restaurant",
    "tasting",
    "market",
    "food-truck",
    "pop-up",
    "chef-dinner",
    "wine",
    "cocktail",
  ],
  "food-openings": [
    "food-openings",
    "restaurant-opening",
    "opening-night",
    "soft-launch",
    "grand-opening",
  ],

  // Arts & Culture family.
  arts: ["arts", "art", "culture", "exhibition"],
  music: [
    "music",
    "concert",
    "live-music",
    "jazz",
    "dj",
    "festival",
    "show",
    "performance",
  ],
  film: ["film", "movie", "screening", "cinema", "film-festival"],
  theater: ["theater", "theatre", "play", "dance", "performing-arts"],
  galleries: [
    "galleries",
    "gallery",
    "art-fair",
    "opening-reception",
    "exhibition",
  ],
  books: [
    "books",
    "book-fair",
    "library",
    "bookstore",
    "author",
    "author-signing",
    "reading",
    "literature",
  ],
  "street-art": [
    "street-art",
    "mural",
    "wynwood-walls",
    "public-art",
    "graffiti",
  ],

  // Science family — museums + history are cross-relevant to arts
  // already via crossListedIn; tag synonyms reinforce the bridge.
  science: ["science", "lecture", "talk", "research", "stem"],
  museums: [
    "museums",
    "museum",
    "exhibition",
    "members-night",
    "family-day",
    "tour",
  ],
  history: [
    "history",
    "heritage",
    "archive",
    "historical",
    "walking-tour",
    "preservation",
  ],
  climate: [
    "climate",
    "sustainability",
    "sea-level-rise",
    "hurricane-prep",
    "resilience",
  ],
  nature: [
    "nature",
    "wildlife",
    "everglades",
    "beach",
    "bird-walk",
    "reef",
    "park",
    "cleanup",
  ],
}

export const seedAssociatedTags = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("sections").collect()
    let patched = 0
    for (const s of all) {
      const tags = ASSOCIATED_TAGS[s.slug]
      if (!tags) continue
      // Slug itself always belongs — guarantees a baseline match even
      // when an event is tagged purely with the section's own slug.
      const next = Array.from(new Set([s.slug, ...tags]))
      const prev = s.associatedTags ?? []
      // Idempotent: skip when the existing list is already the same.
      if (
        prev.length === next.length &&
        prev.every((t) => next.includes(t))
      ) {
        continue
      }
      await ctx.db.patch(s._id, { associatedTags: next })
      patched += 1
    }
    return { sections: all.length, patched }
  },
})

// =====================================================================
// 2026-05 hard prune of non-event sources. The events-only pivot
// shifted the editorial product to calendar-only — pure-news feeds
// now produce zero events per fetch in 90% of cases, they just
// consume input tokens. This migration flips enabled=false on every
// source that isn't in the event-rich allowlist below.
//
// Reversible: rows stay in place, only `enabled` flips. Re-enable in
// /admin/sources by URL when needed.
//
// Run dev:  npx convex run migrations:pruneNonEventSources
// Run prod: npx convex run migrations:pruneNonEventSources --prod
// Idempotent — re-running is a no-op for sources already disabled.
// =====================================================================

// URL is event-rich when ANY predicate hits:
//   - URL contains `?ical=1`, `.ics`, or `&feed=calendar` (iCal feed)
//   - URL contains `/events/` or `/calendar/` in the path
//   - URL exactly matches one of EVENT_RICH_URLS (events-html scrapers,
//     curated event RSS feeds)
//
// Bluesky accounts of venues / event-promoters are kept by exact URL.
// Reddit + YouTube are blanket-disabled (no calendar shape, mostly
// discussion or news clips).
// Tightened 2026-05-12: lifestyle magazines (Coral Gables / Brickell /
// Key Biscayne / Doral Family Journal / Miami Geographic), Miami Today
// News, Eater RSS, and civic-news Blueskys leaked through the original
// pass — they're ~5% events / 95% news copy. Stripped down to the curated
// set where events are the primary feed shape. Anything still wanted
// can be re-enabled in /admin/sources by URL.
const EVENT_RICH_URLS: ReadonlyArray<string> = [
  // events-html JSON-LD scrapers
  "https://vizcaya.org/calendar/",
  "https://deeringestate.org/events/",

  // Curated event-rich RSS — must be ≥80% calendar listings or
  // venue-event posts to earn a spot here.
  "https://miamionthecheap.com/feed/",
  "https://www.miaminewtimes.com/miami/Rss.xml",
  "https://www.miaminewtimes.com/music.rss",
  "https://www.miaminewtimes.com/arts.rss",
  "https://www.timeout.com/miami/feed",
  "https://www.timeout.com/miami/feed.rss",
  "https://refreshmiami.com/feed/",
  "https://artburstmiami.com/feed",
  "https://artburstmiami.com/feed/",
  "https://www.miamijazzsociety.com/feed/",
  "https://miami.aiga.org/feed/",
  "https://miamibookfair.com/feed/",
  "https://www.miamibookfair.com/feed/",
  "https://www.miamibookfaironline.com/feed/",
  "https://youngarts.org/feed/",
  "https://www.miamiopen.com/feed/",
  "https://www.universemiami.com/?feed=rss2",
  "https://www.coconutgrovespotlight.com/feed",
  "https://www.cgaf.com/feed/",
  "https://www.miamibeachchamber.com/feed/",
  "https://miamifoundation.org/feed/",
  "https://endeavormiami.org/feed/",
  "https://www.cic.com/feed/?location=miami",
  "https://thebass.org/feed/",
  "https://www.frostscience.org/feed/",
  "https://miamilightproject.com/feed/",
  "https://www.miamilightproject.com/feed/",
  "https://www.soulofmiami.org/feed/",
  "https://www.calleochonews.com/feed/",
  // V6 venue RSS (Coral Gables venues, North Beach Bandshell, Fundarte).
  "https://coralgablesmuseum.org/feed/",
  "https://www.actorsplayhouse.org/feed/",
  "https://www.booksandbooks.com/feed/",
  "https://gablescinema.com/calendar/feed/",
  "https://gablestage.org/feed/",
  "https://www.fundarte.us/feed/",
]

const EVENT_RICH_URL_SET = new Set(EVENT_RICH_URLS)

function isEventRichUrl(url: string): boolean {
  if (EVENT_RICH_URL_SET.has(url)) return true
  // iCal pattern variants — iCalendar.aspx (CivicEngage), `?ical=1`
  // (Yoast / WP plugins), `.ics` file extension.
  if (url.includes("?ical=1") || url.includes("&ical=1")) return true
  if (url.includes(".ics")) return true
  if (url.includes("/iCalendar.aspx")) return true
  if (url.includes("&feed=calendar")) return true
  // Path-based heuristics — venues that expose `/events/` or
  // `/calendar/` URLs typically have JSON-LD or RSS event content
  // even when we haven't curated them individually.
  if (/\/events\/?($|\?|#)/i.test(url)) return true
  if (/\/calendar\/?($|\?|#)/i.test(url)) return true
  // Specific UM / FIU events host names.
  if (url.startsWith("https://events.miami.edu/")) return true
  if (url.startsWith("https://calendar.fiu.edu/")) return true
  return false
}

export const pruneNonEventSources = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("sources").collect()
    const now = Date.now()
    let disabled = 0
    let kept = 0
    let alreadyDisabled = 0
    const disabledByType: Record<string, number> = {}
    const keptSample: Array<string> = []
    for (const s of all) {
      const eventRich = isEventRichUrl(s.url)
      if (eventRich) {
        kept += 1
        if (keptSample.length < 10) keptSample.push(s.name)
        continue
      }
      if (!s.enabled) {
        alreadyDisabled += 1
        continue
      }
      await ctx.db.patch(s._id, {
        enabled: false,
        autoDisabledAt: now,
        autoDisabledReason:
          "non-event source (events-only pivot prune)",
      })
      disabled += 1
      disabledByType[s.type] = (disabledByType[s.type] ?? 0) + 1
    }
    return {
      totalSources: all.length,
      kept,
      disabled,
      alreadyDisabled,
      disabledByType,
      keptSample,
    }
  },
})

// =====================================================================
// 2026-05 hard-delete of disabled sources. Pruning only flipped
// enabled=false; the admin/sources page still listed every row with
// a red dot. This migration finishes the job: delete every disabled
// source AND its ingestedItems (cascading clean-up so no orphans).
//
// Batched via an action since some sources have thousands of
// ingestedItems and a single mutation would blow the write limit.
//
// Run dev:  npx convex run migrations:deleteDisabledSources
// Run prod: npx convex run migrations:deleteDisabledSources --prod
// =====================================================================

export const deleteOneDisabledSource = internalMutation({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => {
    const src = await ctx.db.get(sourceId)
    if (!src) return { deletedItems: 0, deletedSource: false }
    if (src.enabled) {
      // Safety guard: an editor may have re-enabled mid-pass. Don't
      // delete enabled rows.
      return { deletedItems: 0, deletedSource: false }
    }
    // Delete this source's ingestedItems in a single transaction
    // (capped at 1000 — that's already a lot per source; anything
    // larger means we revisit on the next batched call).
    const items = await ctx.db
      .query("ingestedItems")
      .withIndex("by_source_external", (q) => q.eq("sourceId", sourceId))
      .take(1000)
    for (const it of items) await ctx.db.delete(it._id)
    // If we hit the cap, leave the source row for the next pass.
    if (items.length === 1000) {
      return { deletedItems: items.length, deletedSource: false }
    }
    await ctx.db.delete(sourceId)
    return { deletedItems: items.length, deletedSource: true }
  },
})

export const deleteDisabledSources = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    deletedSources: number
    deletedItems: number
    sourcesScanned: number
  }> => {
    const all = await ctx.runQuery(internal.sourcesData.listInternal, {})
    const disabled = all.filter((s) => !s.enabled)
    let deletedSources = 0
    let deletedItems = 0
    // Keep looping until each disabled source is fully drained — a
    // source with >1000 ingested items needs multiple per-source
    // calls before its row can be removed.
    for (const src of disabled) {
      // Loop until this source is gone (or the inner mutation gives
      // up because the source row was re-enabled).
      for (let pass = 0; pass < 50; pass += 1) {
        const result: {
          deletedItems: number
          deletedSource: boolean
        } = await ctx.runMutation(
          internal.migrations.deleteOneDisabledSource,
          { sourceId: src._id },
        )
        deletedItems += result.deletedItems
        if (result.deletedSource) {
          deletedSources += 1
          break
        }
        if (result.deletedItems === 0) break // nothing more to do
      }
    }
    return {
      deletedSources,
      deletedItems,
      sourcesScanned: disabled.length,
    }
  },
})

// =====================================================================
// 2026-05 backfill of lat/lng on existing events from their first
// neighborhood centroid. Run once after schema widening so the Map
// view has data immediately; new events get coords at insertExtracted
// time going forward. Idempotent — skips events that already have
// coordinates set.
//
// Run dev:  npx convex run migrations:backfillEventCoords
// Run prod: npx convex run migrations:backfillEventCoords --prod
// =====================================================================

import { neighborhoodCoords as _ncoords } from "./lib/neighborhoods"

export const backfillEventCoordsBatch = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, _args) => {
    // Pull a batch of events; rely on the natural _id ordering to make
    // progress. We don't need cursor stability because the migration
    // is idempotent — re-running picks up anything missed.
    const batch = await ctx.db
      .query("events")
      .filter((q) => q.eq(q.field("lat"), undefined))
      .take(200)
    let patched = 0
    for (const e of batch) {
      const slug = e.neighborhoods?.[0]
      if (!slug) continue
      const coords = _ncoords(slug)
      if (!coords) continue
      await ctx.db.patch(e._id, { lat: coords.lat, lng: coords.lng })
      patched += 1
    }
    return { scanned: batch.length, patched, hasMore: batch.length === 200 }
  },
})

export const backfillEventCoords = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    totalScanned: number
    totalPatched: number
    batches: number
  }> => {
    let totalScanned = 0
    let totalPatched = 0
    let batches = 0
    const MAX_BATCHES = 100
    for (let i = 0; i < MAX_BATCHES; i += 1) {
      const result: {
        scanned: number
        patched: number
        hasMore: boolean
      } = await ctx.runMutation(
        internal.migrations.backfillEventCoordsBatch,
        {},
      )
      totalScanned += result.scanned
      totalPatched += result.patched
      batches += 1
      // Stop when nothing was patched in a pass — either we caught
      // every neighborhood-tagged event or none of the remaining ones
      // have neighborhoods to geocode against.
      if (result.patched === 0 && !result.hasMore) break
      if (result.patched === 0) {
        // Defensive: if a batch was full but nothing patched, we're
        // looping over events with no neighborhoods. Stop.
        break
      }
    }
    return { totalScanned, totalPatched, batches }
  },
})

// =====================================================================
// 2026-05 add Education + Health sections + reparent obvious misfiles.
//
// Symptoms surfaced in /admin/published:
//   - UM academic events (law-school tours, MBA dissertations, "Wow
//     Experience" webinars) were filing under sports/the-u because
//     there was no academic UM section.
//   - Biltmore Hotel fitness classes (indoor cycling, yoga, pilates,
//     aqua fitness) were filing under business because the source
//     was a hotel iCal feed.
//
// Fix:
//   - New top-level `education` with subs: university-of-miami, mdc,
//     fiu, high-schools, middle-schools, elementary-schools.
//   - New top-level `health` with subs: fitness, medical, wellness.
//   - Reparent existing events whose titles clearly match each new
//     bucket (heuristic — see ACADEMIC_RE / FITNESS_RE below).
//   - Going forward, the mega-desk picks the right section from its
//     allowed-sections prompt automatically.
//
// Run dev:  npx convex run migrations:addEducationAndHealth
// Run prod: npx convex run migrations:addEducationAndHealth --prod
// Idempotent — re-running skips already-inserted sections and only
// reparents rows that haven't moved yet.
// =====================================================================

const EDU_HEALTH_SECTIONS: Array<{
  slug: string
  name: string
  description: string
  accentColor: string
  order: number
  parentSlug?: string
}> = [
  // ─── Education tree ───
  {
    slug: "education",
    name: "Education",
    description:
      "Schools and universities — academic events, open houses, lectures, dissertations, alumni nights. NOT athletics; see Sports for game schedules.",
    accentColor: "oklch(0.541 0.281 293.009)", // violet-600
    order: 35,
  },
  {
    slug: "university-of-miami",
    name: "University of Miami",
    description:
      "UM academic events — Herbert Business School, Frost School of Music, Law School, dissertations, webinars, open houses. For Hurricanes athletics see Sports.",
    accentColor: "oklch(0.795 0.184 86.047)", // yellow-600 (UM color)
    order: 36,
    parentSlug: "education",
  },
  {
    slug: "mdc",
    name: "Miami Dade College",
    description:
      "Miami Dade College academic and community events — campus lectures, gallery openings, the Book Fair, Cultura del Lobo.",
    accentColor: "oklch(0.586 0.253 17.585)", // rose-600
    order: 37,
    parentSlug: "education",
  },
  {
    slug: "fiu",
    name: "FIU",
    description:
      "Florida International University academic events. For FIU Panthers athletics see Sports.",
    accentColor: "oklch(0.546 0.245 262.881)", // blue-600
    order: 38,
    parentSlug: "education",
  },
  {
    slug: "middle-schools",
    name: "Middle Schools",
    description:
      "Miami-Dade middle school events — open houses, parent nights, fairs.",
    accentColor: "oklch(0.609 0.126 221.723)",
    order: 40,
    parentSlug: "education",
  },
  {
    slug: "elementary-schools",
    name: "Elementary Schools",
    description:
      "Miami-Dade elementary school events — open houses, family nights, school carnivals.",
    accentColor: "oklch(0.609 0.126 221.723)",
    order: 41,
    parentSlug: "education",
  },

  // ─── Health tree ───
  {
    slug: "health",
    name: "Health",
    description:
      "Fitness, wellness, and medical events across Miami — yoga, pilates, cycling, hospital lectures, public-health programs.",
    accentColor: "oklch(0.596 0.145 163.225)", // emerald-600
    order: 90,
  },
  {
    slug: "fitness",
    name: "Fitness",
    description:
      "Group exercise classes, gym programs, yoga, pilates, cycling, running clubs, swim, barre, HIIT, dance fitness.",
    accentColor: "oklch(0.596 0.145 163.225)",
    order: 91,
    parentSlug: "health",
  },
  {
    slug: "medical",
    name: "Medical",
    description:
      "Hospital events, medical conferences, public-health programs, health-screening days, CME, blood drives.",
    accentColor: "oklch(0.586 0.253 17.585)",
    order: 92,
    parentSlug: "health",
  },
  {
    slug: "wellness",
    name: "Wellness",
    description:
      "Meditation, mindfulness, mental-health programs, holistic retreats, self-care workshops.",
    accentColor: "oklch(0.541 0.281 293.009)",
    order: 93,
    parentSlug: "health",
  },
]

// Heuristics — applied to event titles for the one-shot reparent.
// Word-boundary regexes so "fitness" doesn't match "businessmen" etc.
const ACADEMIC_RE =
  /\b(law school|mba|dissertation|webinar|open house|tour|lecture|seminar|symposium|colloquium|faculty|professor|scholarship|graduation|commencement|orientation|alumni|college fair|herbert business|frost school|miller school|rosenstiel|engineering)\b/i
const FITNESS_RE =
  /\b(yoga|pilates|cycling|fitness|aqua|spin|barre|hiit|crossfit|gym|workout|training|run\b|running|marathon|5k|10k|swim|dance fitness|zumba|bootcamp|cardio|wellness|meditation|mindfulness)\b/i
const MEDICAL_RE =
  /\b(hospital|medical|surgery|surgeon|cme|public health|blood drive|health screening|medicine|clinical)\b/i

export const addEducationAndHealth = internalMutation({
  args: {},
  handler: async (ctx) => {
    const log: Array<string> = []
    const all = await ctx.db.query("sections").collect()
    const bySlug = new Map(all.map((s) => [s.slug, s]))

    // First pass — insert any new section that doesn't already exist.
    let inserted = 0
    for (const s of EDU_HEALTH_SECTIONS) {
      if (bySlug.has(s.slug)) continue
      const id = await ctx.db.insert("sections", {
        slug: s.slug,
        name: s.name,
        description: s.description,
        accentColor: s.accentColor,
        order: s.order,
      })
      bySlug.set(s.slug, {
        _id: id,
        _creationTime: Date.now(),
        slug: s.slug,
        name: s.name,
        description: s.description,
        accentColor: s.accentColor,
        order: s.order,
      })
      inserted += 1
      log.push(`inserted ${s.slug}`)
    }

    // Second pass — wire parents on the new sections (need both
    // parent + child IDs available, hence two passes).
    for (const s of EDU_HEALTH_SECTIONS) {
      const cur = bySlug.get(s.slug)
      if (!cur) continue
      const parentId = s.parentSlug ? bySlug.get(s.parentSlug)?._id : undefined
      await ctx.db.patch(cur._id, {
        name: s.name,
        description: s.description,
        accentColor: s.accentColor,
        order: s.order,
        parentId,
      })
    }

    // Reparent helpers — fetch sections we want to target.
    const theU = bySlug.get("the-u")
    const fiuPanthers = bySlug.get("fiu-panthers")
    const business = bySlug.get("business")
    const um = bySlug.get("university-of-miami")
    const fiu = bySlug.get("fiu")
    const fitness = bySlug.get("fitness")
    const medical = bySlug.get("medical")
    const wellness = bySlug.get("wellness")

    let reparented = 0

    // UM academic events misfiled under the-u (sports / Hurricanes).
    if (theU && um) {
      const events = await ctx.db
        .query("events")
        .withIndex("by_section_starts", (q) => q.eq("sectionId", theU._id))
        .collect()
      for (const e of events) {
        if (ACADEMIC_RE.test(e.title)) {
          await ctx.db.patch(e._id, { sectionId: um._id })
          reparented += 1
        }
      }
    }
    // FIU academic events misfiled under fiu-panthers.
    if (fiuPanthers && fiu) {
      const events = await ctx.db
        .query("events")
        .withIndex("by_section_starts", (q) =>
          q.eq("sectionId", fiuPanthers._id),
        )
        .collect()
      for (const e of events) {
        if (ACADEMIC_RE.test(e.title)) {
          await ctx.db.patch(e._id, { sectionId: fiu._id })
          reparented += 1
        }
      }
    }
    // Fitness / wellness / medical events misfiled under business.
    if (business) {
      const events = await ctx.db
        .query("events")
        .withIndex("by_section_starts", (q) => q.eq("sectionId", business._id))
        .collect()
      for (const e of events) {
        let target:
          | typeof fitness
          | typeof medical
          | typeof wellness
          | undefined
        if (FITNESS_RE.test(e.title)) target = fitness
        else if (MEDICAL_RE.test(e.title)) target = medical
        else if (/\b(meditation|mindfulness|retreat)\b/i.test(e.title))
          target = wellness
        if (target) {
          await ctx.db.patch(e._id, { sectionId: target._id })
          reparented += 1
        }
      }
    }

    if (reparented > 0) log.push(`reparented ${reparented} events`)

    return { inserted, reparented, log }
  },
})

// =====================================================================
// 2026-06 add Commerce sub-section under Business.
//
// Business previously had two sub-sections — Tech (order 22) and Real
// Estate (order 24). Commerce slots in at order 26 to cover retail
// openings, store launches, chamber of commerce events, pop-up shops,
// markets, plazas, and small-business happenings — events that were
// previously filing under Business (catch-all) or Food when they had
// a market angle.
//
// One-shot reparent: walks events under Business / Food whose title
// matches COMMERCE_RE and patches sectionId. Modeled on
// addEducationAndHealth's regex reparent pass.
//
// Idempotent — re-running skips the insert (commerce already exists)
// and the regex pass only patches rows not already under commerce.
//
// Run dev:  npx convex run migrations:addCommerceSection
// Run prod: npx convex run migrations:addCommerceSection --prod
// =====================================================================

const COMMERCE_SECTION = {
  slug: "commerce",
  name: "Commerce",
  description:
    "Retail openings, store launches, chamber of commerce events, pop-up shops, markets, plazas, and small-business happenings across Miami.",
  accentColor: "oklch(0.595 0.13 200)", // teal-ish sibling of business blue
  order: 26,
  parentSlug: "business",
}

const COMMERCE_RE =
  /\b(retail|store\s+opening|chamber\s+of\s+commerce|pop[\s-]?up\s+shop|grand\s+opening|ribbon[\s-]?cutting|small[\s-]?business|boutique\s+launch|new\s+store|\bmall\b|plaza\s+opening|market\s+(?:opening|launch))\b/i

export const addCommerceSection = internalMutation({
  args: {},
  handler: async (ctx) => {
    const log: Array<string> = []
    const all = await ctx.db.query("sections").collect()
    const bySlug = new Map(all.map((s) => [s.slug, s]))
    const business = bySlug.get("business")
    if (!business) {
      return { inserted: 0, reparented: 0, log: ["aborted: no business section"] }
    }

    let inserted = 0
    let commerce = bySlug.get("commerce")
    if (!commerce) {
      const id = await ctx.db.insert("sections", {
        slug: COMMERCE_SECTION.slug,
        name: COMMERCE_SECTION.name,
        description: COMMERCE_SECTION.description,
        accentColor: COMMERCE_SECTION.accentColor,
        order: COMMERCE_SECTION.order,
        parentId: business._id,
      })
      commerce = (await ctx.db.get(id)) ?? undefined
      inserted = 1
      log.push("inserted commerce")
    } else {
      // Refresh metadata so a re-run picks up any seed-file edits and
      // re-anchors the parent in case it ever drifted.
      await ctx.db.patch(commerce._id, {
        name: COMMERCE_SECTION.name,
        description: COMMERCE_SECTION.description,
        accentColor: COMMERCE_SECTION.accentColor,
        order: COMMERCE_SECTION.order,
        parentId: business._id,
      })
    }
    if (!commerce) return { inserted, reparented: 0, log }

    // Reparent matching events under business + food (food because
    // many small-market / pop-up events file under food today).
    let reparented = 0
    const reparentFrom = [business, bySlug.get("food")].filter(
      (s): s is NonNullable<typeof business> => Boolean(s),
    )
    for (const src of reparentFrom) {
      const events = await ctx.db
        .query("events")
        .withIndex("by_section_starts", (q) => q.eq("sectionId", src._id))
        .collect()
      for (const e of events) {
        if (e.sectionId === commerce._id) continue
        if (!COMMERCE_RE.test(e.title)) continue
        await ctx.db.patch(e._id, { sectionId: commerce._id })
        reparented += 1
      }
      if (reparented > 0) log.push(`scanned ${src.slug}: ${events.length} rows`)
    }
    if (reparented > 0) log.push(`reparented ${reparented} events`)

    return { inserted, reparented, log }
  },
})

// =====================================================================
// 2026-05 demote tech + real-estate to business sub-sections. They
// were top-level when business was thin; now they read as natural
// business sub-beats (tech meetups, real-estate panels). Order:
// business / education / sports / food / arts / science / health.
//
// Run dev:  npx convex run migrations:nestTechAndRealEstate
// Run prod: npx convex run migrations:nestTechAndRealEstate --prod
// Idempotent.
// =====================================================================
export const nestTechAndRealEstate = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("sections").collect()
    const bySlug = new Map(all.map((s) => [s.slug, s]))
    const business = bySlug.get("business")
    const tech = bySlug.get("tech")
    const realEstate = bySlug.get("real-estate")
    if (!business) return { ok: false, reason: "no business section" }
    let patched = 0
    if (tech && tech.parentId !== business._id) {
      await ctx.db.patch(tech._id, { parentId: business._id, order: 22 })
      patched += 1
    }
    if (realEstate && realEstate.parentId !== business._id) {
      await ctx.db.patch(realEstate._id, {
        parentId: business._id,
        order: 24,
      })
      patched += 1
    }
    return { ok: true, patched }
  },
})

// =====================================================================
// Event hygiene — every published event must have a where, what, when.
//
// `deleteUnlocatedEvents`: hard-deletes events with no `locationName`
// AND no `locationAddress`. These are usually news headlines the LLM
// mis-extracted as events (e.g. "Florida Legislature Budget Special
// Session" with no venue). Without a place, they're not actionable.
//
// `disableNewsSources`: flips `enabled: false` on every source whose
// `type` isn't calendar-shaped — keeps `ics`, `events-html`,
// `sitemap-events`, `data`; disables `rss`, `bluesky`, `reddit`,
// `youtube`. Reversible via /admin/sources.
//
// Run dev:  npx convex run migrations:deleteUnlocatedEvents
//           npx convex run migrations:disableNewsSources
// Run prod: same with --prod
// =====================================================================

export const deleteUnlocatedEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const events = await ctx.db.query("events").take(2000)
    let deleted = 0
    for (const e of events) {
      const hasLocation =
        (e.locationName && e.locationName.trim().length > 0) ||
        (e.locationAddress && e.locationAddress.trim().length > 0)
      if (hasLocation) continue
      await ctx.db.delete(e._id)
      deleted += 1
    }
    return { scanned: events.length, deleted }
  },
})

export const disableNewsSources = internalMutation({
  args: {},
  handler: async (ctx) => {
    const sources = await ctx.db.query("sources").collect()
    const CALENDAR_TYPES = new Set([
      "ics",
      "events-html",
      "sitemap-events",
      "data",
    ])
    let disabled = 0
    for (const s of sources) {
      if (!s.enabled) continue
      if (CALENDAR_TYPES.has(s.type)) continue
      await ctx.db.patch(s._id, { enabled: false })
      disabled += 1
    }
    return { scanned: sources.length, disabled }
  },
})

// Derives `dek` for events that don't have one by taking the first
// sentence of their existing description / body. Idempotent — events
// that already have a non-empty dek are left alone. Run once after
// the dek-only switch lands.
//
// Run: `npx convex run migrations:backfillEventDeks`
import { firstSentence as _firstSentence } from "./lib/firstSentence"

export const backfillEventDeks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const events = await ctx.db.query("events").take(2000)
    let patched = 0
    for (const e of events) {
      if (e.dek && e.dek.trim().length > 0) continue
      const next = _firstSentence(e.description) ?? _firstSentence(e.body)
      if (!next) continue
      await ctx.db.patch(e._id, { dek: next })
      patched += 1
    }
    return { scanned: events.length, patched }
  },
})

// Backfills `price` on existing events using the same deterministic
// rules adapters / ingest now apply at write time:
//   1. Regex pull from event.description / event.body
//   2. defaultFreeForSourceUrl on the first cited URL
// Events that already have a non-empty price are left alone.
//
// Run: `npx convex run migrations:backfillEventPrices`
import {
  extractPriceFromText as _extractPriceFromText,
  defaultFreeForSourceUrl as _defaultFreeForSourceUrl,
} from "./lib/priceExtract"

export const backfillEventPrices = internalMutation({
  args: {},
  handler: async (ctx) => {
    const events = await ctx.db.query("events").take(2000)
    let patched = 0
    for (const e of events) {
      if (e.price && e.price.trim().length > 0) continue
      const fromText =
        _extractPriceFromText(e.description) ??
        _extractPriceFromText(e.body)
      const firstCite = e.citations?.[0]?.url
      const fromSource = _defaultFreeForSourceUrl(firstCite)
      const next = fromText ?? fromSource
      if (!next) continue
      await ctx.db.patch(e._id, { price: next })
      patched += 1
    }
    return { scanned: events.length, patched }
  },
})

// Tags existing source rows with `neighborhoodSlugs` derived from
// the source's URL + name. Conservative: only fires on patterns we
// know correspond to a specific neighborhood. Sources without an
// obvious hit are left untagged (they show up under "Citywide" in
// the admin grouping).
//
// Run: `npx convex run migrations:tagSourceNeighborhoods`
export const tagSourceNeighborhoods = internalMutation({
  args: {},
  handler: async (ctx) => {
    const RULES: ReadonlyArray<{
      slug: string
      patterns: ReadonlyArray<RegExp>
    }> = [
      { slug: "coral-gables", patterns: [/coral[\s-]?gables|coralgables|gablestage|bookleggers|booksandbooks|biltmore|cgaf|the\s?frost|fairchild/i] },
      { slug: "wynwood-design-district", patterns: [/wynwood|design[\s-]?district|locustprojects|bacfl|bakehouse|spinello|gramps|thelabmiami|the[-\s]anderson/i] },
      { slug: "miami-beach", patterns: [/miamibeach|miami[\s-]?beach|thebass|bass[\s-]?museum|nws\.edu|new\s?world\s?symphony|sweat[-\s]?records|wolfsonian|colony\s?theatre|miaminewdrama|holocaust|townofsurfsidefl|balharbourgov/i] },
      { slug: "downtown", patterns: [/miamigov|miamidda|downtown[\s-]?miami|olympiatheater|pamm|frostscience|miamidadeauditorium/i] },
      { slug: "brickell", patterns: [/brickell/i] },
      { slug: "coconut-grove", patterns: [/coconut[\s-]?grove|coconutgrove|vizcaya|deeringestate/i] },
      { slug: "key-biscayne", patterns: [/keybiscayne|key[\s-]?biscayne/i] },
      { slug: "little-haiti", patterns: [/little[\s-]?haiti|haitian/i] },
      { slug: "little-havana", patterns: [/little[\s-]?havana|ballandchain|calleocho|cubanmuseum/i] },
      { slug: "doral", patterns: [/cityofdoral|\bdoral\b/i] },
      { slug: "aventura", patterns: [/cityofaventura|\baventura\b/i] },
      { slug: "north-miami", patterns: [/northmiamifl|northmiami(?!beach)/i] },
      { slug: "north-miami-beach", patterns: [/citynmb|north\s?miami\s?beach/i] },
      { slug: "south-miami", patterns: [/southmiami|\bsouth[\s-]?miami\b/i] },
      { slug: "miami-shores", patterns: [/miamishoresvillage|miami[\s-]?shores/i] },
      { slug: "miami-springs", patterns: [/miamisprings|miami[\s-]?springs/i] },
      { slug: "pinecrest", patterns: [/pinecrest/i] },
      { slug: "sunny-isles-beach", patterns: [/sibfl|sunny[\s-]?isles/i] },
      { slug: "bal-harbour", patterns: [/balharbour|bal[\s-]?harbour/i] },
      { slug: "surfside", patterns: [/townofsurfsidefl|\bsurfside\b/i] },
      { slug: "hialeah", patterns: [/hialeah/i] },
      { slug: "homestead", patterns: [/homestead/i] },
    ]
    const sources = await ctx.db.query("sources").collect()
    let patched = 0
    for (const s of sources) {
      if (s.neighborhoodSlugs && s.neighborhoodSlugs.length > 0) continue
      const haystack = `${s.name} ${s.url}`
      const hits: Array<string> = []
      for (const rule of RULES) {
        if (rule.patterns.some((re) => re.test(haystack))) {
          hits.push(rule.slug)
        }
      }
      if (hits.length === 0) continue
      await ctx.db.patch(s._id, { neighborhoodSlugs: hits })
      patched += 1
    }
    return { scanned: sources.length, patched }
  },
})

// Backfills `dedupeKey` on every event and folds duplicates into the
// oldest existing row. After the dedup logic was added to
// insertExtracted, run this once to clean up the existing pile.
//
// Run: `npx convex run migrations:dedupeEvents`
import { eventDedupeKey as _eventDedupeKey } from "./lib/eventDedupe"

export const dedupeEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const events = await ctx.db.query("events").take(2000)
    const groups = new Map<string, Array<typeof events[number]>>()
    for (const e of events) {
      const key = _eventDedupeKey({ title: e.title, startsAt: e.startsAt })
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(e)
    }
    let merged = 0
    let stamped = 0
    for (const [key, rows] of groups.entries()) {
      // Sort oldest-first so the canonical row is the original insert.
      rows.sort((a, b) => a.createdAt - b.createdAt)
      const winner = rows[0]
      // Stamp the canonical row's dedupeKey if missing.
      if (winner.dedupeKey !== key) {
        await ctx.db.patch(winner._id, { dedupeKey: key })
        stamped += 1
      }
      if (rows.length === 1) continue
      // Merge dup rows into the winner, then delete them.
      let nextCitations = winner.citations ?? []
      let nextItems = (winner.derivedFromItems ?? []) as Array<string>
      for (let i = 1; i < rows.length; i += 1) {
        const loser = rows[i]
        nextCitations = [...nextCitations, ...(loser.citations ?? [])]
        nextItems = [
          ...nextItems,
          ...((loser.derivedFromItems ?? []) as Array<string>),
        ]
        await ctx.db.delete(loser._id)
        merged += 1
      }
      const seenUrls = new Set<string>()
      const dedupedCitations = nextCitations.filter((c) => {
        if (seenUrls.has(c.url)) return false
        seenUrls.add(c.url)
        return true
      })
      const dedupedItems = Array.from(new Set(nextItems))
      await ctx.db.patch(winner._id, {
        citations: dedupedCitations,
        derivedFromItems:
          dedupedItems as unknown as typeof winner.derivedFromItems,
      })
    }
    return { scanned: events.length, dedupeMerged: merged, stamped }
  },
})

// Sweeps already-published events that match the audience-filter
// patterns (faculty meeting, dissertation defense, course code in
// title, members-only, students-only, etc.). The new ingest pipeline
// drops these going forward; this catches the backlog.
//
// Run: `npx convex run migrations:purgePrivateAudienceEvents`
import { isPrivateAudience as _isPrivateAudience } from "./lib/audienceFilter"

export const purgePrivateAudienceEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const events = await ctx.db.query("events").take(2000)
    let deleted = 0
    for (const e of events) {
      if (
        _isPrivateAudience({
          title: e.title,
          description: e.description,
          body: e.body,
        })
      ) {
        await ctx.db.delete(e._id)
        deleted += 1
      }
    }
    return { scanned: events.length, deleted }
  },
})

// Force-categorizes every source by its implied neighborhood, using
// hardcoded venue-by-venue knowledge instead of regex matching. Run
// AFTER the schema is widened with neighborhoodSlugs. Overrides
// whatever the auto-tagger did — manual knowledge wins.
//
// Sources not in the table below get cleared (treated as citywide,
// neighborhoodSlugs left undefined) so the page-wide aggregators
// (Soul of Miami, Time Out, etc.) don't bias the per-neighborhood
// view.
//
// Run: `npx convex run migrations:forceCategorizeSources`
export const forceCategorizeSources = internalMutation({
  args: {},
  handler: async (ctx) => {
    // URL substring → neighborhoodSlugs[]. Order doesn't matter for
    // the lookup (longest match isn't needed); each source row matches
    // at most one entry because URLs are distinct domains.
    const URL_RULES: ReadonlyArray<{
      match: string
      slugs: ReadonlyArray<string>
    }> = [
      // ─── Downtown / Park West / Brickell ───
      { match: "miamifoundation.org", slugs: ["downtown"] },
      { match: "miamibookfair.com", slugs: ["downtown"] },
      { match: "arshtcenter.org", slugs: ["downtown"] },
      { match: "olympiatheater.org", slugs: ["downtown"] },
      { match: "bayfrontparkmiami.com", slugs: ["downtown"] },
      { match: "jlkc.com", slugs: ["downtown"] },
      { match: "frostscience.org", slugs: ["downtown"] },
      { match: "miamidda.com", slugs: ["downtown"] },
      { match: "miamigov.com", slugs: ["downtown"] },
      { match: "theunderline.org", slugs: ["brickell", "downtown"] },
      { match: "brickellhomeownersassociation.com", slugs: ["brickell"] },

      // ─── Wynwood + Design District ───
      { match: "icamiami.org", slugs: ["wynwood-design-district"] },
      { match: "ocinema.org", slugs: ["wynwood-design-district"] },
      { match: "thecitadelmiami.com", slugs: ["wynwood-design-district"] },
      { match: "manawynwood.com", slugs: ["wynwood-design-district"] },
      { match: "thewynwoodwalls.com", slugs: ["wynwood-design-district"] },
      { match: "wynwoodmiami.com", slugs: ["wynwood-design-district"] },
      { match: "gramps.com", slugs: ["wynwood-design-district"] },
      { match: "thelabmiami.com", slugs: ["wynwood-design-district"] },
      { match: "bacfl.org", slugs: ["wynwood-design-district"] },
      { match: "lagniappemia.com", slugs: ["wynwood-design-district"] },
      { match: "endeavormiami.org", slugs: ["wynwood-design-district"] },

      // ─── Allapattah ───
      { match: "rubellmuseum.org", slugs: ["allapattah"] },
      { match: "elespacio23.com", slugs: ["allapattah"] },

      // ─── Edgewater ───
      { match: "youngarts.org", slugs: ["edgewater"] },

      // ─── Little Havana ───
      { match: "towertheatermiami.org", slugs: ["little-havana"] },
      { match: "carnavalmiami.com", slugs: ["little-havana"] },
      { match: "cubaocho.com", slugs: ["little-havana"] },
      { match: "ballandchainmiami.com", slugs: ["little-havana"] },

      // ─── Overtown ───
      { match: "lyrictheatermiami.com", slugs: ["overtown"] },

      // ─── Miami Beach (incl. North Beach, Mid-Beach) ───
      { match: "thebass.org", slugs: ["miami-beach"] },
      { match: "nws.edu", slugs: ["miami-beach"] },
      { match: "miaminewdrama.org", slugs: ["miami-beach"] },
      { match: "northbeachbandshell.com", slugs: ["miami-beach"] },
      { match: "wolfsonian.org", slugs: ["miami-beach"] },
      { match: "miamibeachfl.gov", slugs: ["miami-beach"] },
      { match: "emergeamericas.com", slugs: ["miami-beach"] },
      { match: "timeoutmarket.com", slugs: ["miami-beach"] },
      { match: "balharbourgov.com", slugs: ["bal-harbour"] },
      { match: "townofsurfsidefl.gov", slugs: ["surfside"] },
      { match: "sibfl.net", slugs: ["sunny-isles-beach"] },

      // ─── Coral Gables ───
      { match: "biltmorehotel.com", slugs: ["coral-gables"] },
      { match: "coralgablesmuseum.org", slugs: ["coral-gables"] },
      { match: "gablestage.org", slugs: ["coral-gables"] },
      { match: "actorsplayhouse.org", slugs: ["coral-gables"] },
      { match: "booksandbooks.com", slugs: ["coral-gables"] },
      { match: "gablescinema.com", slugs: ["coral-gables"] },
      { match: "fairchildgarden.org", slugs: ["coral-gables"] },
      { match: "lowe.miami.edu", slugs: ["coral-gables"] },
      { match: "miamihurricanes.com", slugs: ["coral-gables"] },
      { match: "events.miami.edu", slugs: ["coral-gables"] },
      { match: "coralgables.com", slugs: ["coral-gables"] },

      // ─── Coconut Grove ───
      { match: "vizcaya.org", slugs: ["coconut-grove"] },
      { match: "deeringestate.org", slugs: ["coconut-grove"] },
      { match: "cgsc.org", slugs: ["coconut-grove"] },
      { match: "coconutgrove.com", slugs: ["coconut-grove"] },

      // ─── Key Biscayne ───
      { match: "keybiscayne.fl.gov", slugs: ["key-biscayne"] },

      // ─── South Miami / Pinecrest / Palmetto / Kendall ───
      { match: "smdcac.org", slugs: ["south-miami"] },
      { match: "southmiamifl.gov", slugs: ["south-miami"] },
      { match: "pinecrestgardens.org", slugs: ["pinecrest"] },
      { match: "pinecrest-fl.gov", slugs: ["pinecrest"] },

      // ─── Little Haiti ───
      { match: "mocanomi.org", slugs: ["little-haiti"] },

      // ─── Miami Shores ───
      { match: "miamishoresvillage.com", slugs: ["miami-shores"] },
      { match: "barry.edu", slugs: ["miami-shores"] },
      { match: "mtcmiami.org", slugs: ["miami-shores"] },

      // ─── Outlying municipalities ───
      { match: "cityofaventura.com", slugs: ["aventura"] },
      { match: "cityofhomestead.com", slugs: ["homestead"] },
      { match: "cityplacedoral.com", slugs: ["doral"] },
      { match: "doralbotanicalpark.com", slugs: ["doral"] },
      { match: "cityofdoral.com", slugs: ["doral"] },
      { match: "hialeahparkracing.com", slugs: ["hialeah"] },
      { match: "northmiamifl.gov", slugs: ["north-miami"] },
      { match: "citynmb.com", slugs: ["north-miami-beach"] },
      { match: "miamisprings-fl.gov", slugs: ["miami-springs"] },

      // Citywide aggregators — explicitly clear any prior tag so they
      // don't bias the per-neighborhood view.
      { match: "soulofmiami.org", slugs: [] },
      { match: "miaminewtimes.com", slugs: [] },
      { match: "timeout.com", slugs: [] },
      { match: "bandsintown.com", slugs: [] },
      { match: "omiami.org", slugs: [] },
      { match: "dadeschools.net", slugs: [] },
      { match: "miamidade.gov", slugs: [] },
      { match: "miamidadecountyauditorium.org", slugs: [] },
      { match: "thefrost.fiu.edu", slugs: [] },
      { match: "calendar.fiu.edu", slugs: [] },
      { match: "fiusports.com", slugs: [] },
    ]

    const sources = await ctx.db.query("sources").collect()
    let patched = 0
    let cleared = 0
    for (const s of sources) {
      const url = s.url.toLowerCase()
      const rule = URL_RULES.find((r) => url.includes(r.match))
      if (!rule) continue
      if (rule.slugs.length === 0) {
        if (s.neighborhoodSlugs && s.neighborhoodSlugs.length > 0) {
          await ctx.db.patch(s._id, { neighborhoodSlugs: undefined })
          cleared += 1
        }
      } else {
        const next = Array.from(rule.slugs)
        const prev = s.neighborhoodSlugs ?? []
        const sameLen = prev.length === next.length
        const sameAll = sameLen && prev.every((p, i) => p === next[i])
        if (!sameAll) {
          await ctx.db.patch(s._id, { neighborhoodSlugs: next })
          patched += 1
        }
      }
    }
    return { scanned: sources.length, patched, cleared }
  },
})

// Hard-deletes sources whose `type` isn't calendar-shaped — RSS,
// Bluesky, Reddit, YouTube, X, wikipedia-otd, web. The deterministic
// ingest pipeline drops items without startsAt + locationName, and
// these source types don't carry those fields. Keeping them around
// just wastes fetch cycles + clutters the admin page.
//
// Also drains each source's ingestedItems before deleting the row.
//
// Run: `npx convex run migrations:deleteNonCalendarSources`
export const deleteNonCalendarSources = internalMutation({
  args: {},
  handler: async (ctx) => {
    const CALENDAR_TYPES = new Set([
      "ics",
      "events-html",
      "sitemap-events",
      "data",
    ])
    const sources = await ctx.db.query("sources").collect()
    let deletedSources = 0
    let deletedItems = 0
    for (const s of sources) {
      if (CALENDAR_TYPES.has(s.type)) continue
      // Drain ingestedItems first (capped per pass so a busy source
      // doesn't blow the transaction). Re-run the migration to keep
      // draining if a source has > 500 items.
      const items = await ctx.db
        .query("ingestedItems")
        .withIndex("by_source_external", (q) => q.eq("sourceId", s._id))
        .take(500)
      for (const it of items) await ctx.db.delete(it._id)
      deletedItems += items.length
      if (items.length < 500) {
        await ctx.db.delete(s._id)
        deletedSources += 1
      }
    }
    return { deletedSources, deletedItems }
  },
})

// Hard-deletes sources whose last fetch hit a permanent-failure
// pattern: 404 / 410 / connection refused / SSL cert mismatch. These
// URLs will never come back; keeping them around just clutters the
// admin page and wastes fetch ticks. Also nukes the source's
// ingestedItems so the table doesn't carry dead links forever.
//
// Run: `npx convex run migrations:deleteDeadSources`
export const deleteDeadSources = internalMutation({
  args: {},
  handler: async (ctx) => {
    const PERMANENT_PATTERNS = [
      /→ 40[34]\b/,
      /\b410\b/,
      /\b520\b/,
      /SSL routines:OPENSSL_internal:CERTIFICATE_VERIFY_FAILED/i,
      /Hostname mismatch/i,
      /name resolution|dns error|getaddrinfo/i,
      /connection refused|ECONNREFUSED/i,
    ]
    const sources = await ctx.db.query("sources").collect()
    let deletedSources = 0
    let deletedItems = 0
    for (const s of sources) {
      const err = s.lastFetchError ?? ""
      const isDead = PERMANENT_PATTERNS.some((re) => re.test(err))
      if (!isDead) continue
      // Drain ingestedItems first — capped per pass so a huge source
      // doesn't blow the transaction. The migration can be re-run if it
      // truncates here; the source row stays in place until empty.
      const items = await ctx.db
        .query("ingestedItems")
        .withIndex("by_source_external", (q) => q.eq("sourceId", s._id))
        .take(500)
      for (const it of items) await ctx.db.delete(it._id)
      deletedItems += items.length
      if (items.length < 500) {
        await ctx.db.delete(s._id)
        deletedSources += 1
      }
    }
    return { deletedSources, deletedItems }
  },
})

// Re-points source rows by URL when seed.ts sectionSlugs change.
// installExpansionSources is URL-idempotent (skips inserts when the
// URL already exists), so the only way to fix a wrong sectionIds[]
// on a long-lived source is to patch it directly. This migration is
// safe to re-run; it's a no-op when the source already matches the
// desired section set.
//
// Also re-routes already-published events tied to the patched source
// when their current sectionId is the wrong one. New events going
// forward pick up the corrected sectionIds via the deterministic
// ingest pipeline.
//
// Run dev:  npx convex run migrations:fixUniversityEventSources
// Run prod: npx convex run migrations:fixUniversityEventSources --prod
export const fixUniversityEventSources = internalMutation({
  args: {},
  handler: async (ctx) => {
    const TARGETS: Array<{ url: string; sectionSlugs: ReadonlyArray<string> }> = [
      {
        url: "https://events.miami.edu/calendar.ics",
        sectionSlugs: ["university-of-miami", "education"],
      },
      {
        url: "https://events.miami.edu/calendar.xml",
        sectionSlugs: ["university-of-miami", "education"],
      },
      {
        url: "https://calendar.fiu.edu/calendar.xml",
        sectionSlugs: ["fiu", "education"],
      },
    ]
    const sectionBySlug = new Map(
      (await ctx.db.query("sections").collect()).map((s) => [s.slug, s]),
    )
    let sourcesPatched = 0
    let eventsRehomed = 0
    for (const t of TARGETS) {
      const src = await ctx.db
        .query("sources")
        .filter((q) => q.eq(q.field("url"), t.url))
        .first()
      if (!src) continue
      const newIds = t.sectionSlugs
        .map((slug) => sectionBySlug.get(slug)?._id)
        .filter((id): id is NonNullable<typeof id> => id !== undefined)
      if (newIds.length === 0) continue
      await ctx.db.patch(src._id, { sectionIds: newIds })
      sourcesPatched += 1

      // Re-route every event whose derivedFromItems trace back to this
      // source AND whose current sectionId is one of the old IDs that
      // shouldn't have been the primary. We use the new primary as
      // the corrected home.
      const newPrimary = newIds[0]
      const sourceItems = await ctx.db
        .query("ingestedItems")
        .withIndex("by_source_external", (q) => q.eq("sourceId", src._id))
        .collect()
      const sourceItemIds = new Set(sourceItems.map((i) => i._id as string))
      const events = await ctx.db.query("events").take(2000)
      for (const e of events) {
        if (e.sectionId === newPrimary) continue
        const fromThisSource = (e.derivedFromItems ?? []).some((id) =>
          sourceItemIds.has(id as string),
        )
        if (!fromThisSource) continue
        await ctx.db.patch(e._id, { sectionId: newPrimary })
        eventsRehomed += 1
      }
    }
    return { sourcesPatched, eventsRehomed }
  },
})

// Deletes events in politics / city / local whose title doesn't look
// civic. The LLM occasionally tags concerts, screenings, and bike
// rides as "politics" when the news article happens to mention a
// neighborhood; this filter drops anything not matching the civic
// vocabulary (commission, council, hearing, agenda, etc.).
//
// Run dev:  npx convex run migrations:purgeMissectionedPolitics
// Run prod: npx convex run migrations:purgeMissectionedPolitics --prod
export const purgeMissectionedPolitics = internalMutation({
  args: {},
  handler: async (ctx) => {
    const POLITICS_SLUGS = new Set(["politics", "city", "local"])
    const CIVIC =
      /\b(commission|council|hearing|agenda|town[\s-]?hall|public[\s-]?comment|board\s+meeting|zoning|elect(?:ion|oral)|candidate\s+forum|inauguration|legislature|special\s+session|budget\s+hearing|workshop|caucus|forum|civic|ballot|vote|advocacy|protest|rally|mayor|commissioner)\b/i
    const sections = await ctx.db.query("sections").collect()
    const politicsIds = new Set(
      sections
        .filter((s) => POLITICS_SLUGS.has(s.slug))
        .map((s) => s._id as string),
    )
    const events = await ctx.db.query("events").take(2000)
    let deleted = 0
    for (const e of events) {
      if (!politicsIds.has(e.sectionId as string)) continue
      if (CIVIC.test(e.title)) continue
      await ctx.db.delete(e._id)
      deleted += 1
    }
    return { scanned: events.length, deleted }
  },
})

// One-shot re-classification of every approved event using the new
// content-driven classifier (`convex/lib/classify.ts`). Replaces the
// old "section comes from source.sectionIds[0]" assumption with
// venue / source-URL / keyword rules. Idempotent: events already on
// the correct section get patched no-op.
//
// Run prod: npx convex run migrations:reclassifyAllEvents
// Seed reasonable coverage floors for the section taxonomy. Run once
// after deploying the coverage SLA cron. Leaf sections get small
// numbers (3–5); catch-all city / local stays unbounded.
export const seedCoverageFloors = internalMutation({
  args: {},
  handler: async (ctx) => {
    const FLOORS: Record<string, number> = {
      // Arts & culture
      music: 8,
      film: 4,
      theater: 4,
      galleries: 4,
      museums: 6,
      books: 3,
      // Food
      food: 6,
      "food-openings": 2,
      // Sports — teams keep their own floors
      sports: 4,
      heat: 2,
      marlins: 2,
      dolphins: 2,
      panthers: 2,
      "inter-miami": 2,
      "the-u": 2,
      // Health
      fitness: 4,
      wellness: 3,
      // Family / community
      family: 3,
      education: 3,
      "university-of-miami": 3,
      mdc: 2,
      fiu: 2,
      // Civic
      politics: 2,
      // Tech / business
      tech: 2,
      business: 2,
      "real-estate": 1,
      // Science / nature
      science: 2,
      nature: 2,
      climate: 2,
    }
    const sections = await ctx.db.query("sections").collect()
    let patched = 0
    for (const s of sections) {
      const floor = FLOORS[s.slug]
      if (floor === undefined) continue
      if (s.minEventsLast14d === floor) continue
      await ctx.db.patch(s._id, { minEventsLast14d: floor })
      patched += 1
    }
    return { sections: sections.length, patched }
  },
})

// Promote every legacy `pending_review` event to `approved` with the
// purge of the review queue. Total-automation mode means no event
// ever needs human approval again; this clears the historical queue.
export const promotePendingReview = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    let promoted = 0
    const stuck = await ctx.db
      .query("events")
      .withIndex("by_status_starts", (q) => q.eq("status", "pending_review"))
      .take(2000)
    for (const e of stuck) {
      await ctx.db.patch(e._id, {
        status: "approved",
        publishedAt: e.publishedAt ?? now,
      })
      promoted += 1
    }
    return { promoted }
  },
})

// purgeArticleTables ran once successfully — the articles, storyArcs,
// and article_authors tables are now dropped from the schema, so the
// mutation can't reference them. Left as a stub returning zeros so
// any lingering bookmark to the CLI command doesn't 404.
export const purgeArticleTables = internalMutation({
  args: {},
  handler: async () => ({ articles: 0, storyArcs: 0 }),
})

// Mark long-running agentRuns as failed. The OOM-era runs (2026-05-20
// → 23) wrote a `startRun` row but the action OOMed before reaching
// `finishRun`, leaving the dashboard's "Last run / Next run" math
// stuck on a row that never resolved. Bounded to runs >2h old so an
// in-flight tick isn't accidentally torpedoed.
export const failStuckRuns = internalMutation({
  args: {},
  handler: async (ctx) => {
    const STUCK_MS = 2 * 60 * 60 * 1000
    const now = Date.now()
    const runs = await ctx.db
      .query("agentRuns")
      .withIndex("by_started")
      .order("desc")
      .take(200)
    let failed = 0
    for (const r of runs) {
      if (r.status !== "running") continue
      if (now - r.startedAt < STUCK_MS) continue
      await ctx.db.patch(r._id, {
        status: "failed",
        finishedAt: now,
        errorMessage: "OOM / stuck — auto-marked failed by cleanup",
      })
      failed += 1
    }
    return { scanned: runs.length, failed }
  },
})

export const reclassifyAllEvents = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }) => {
    const sections = await ctx.db.query("sections").collect()
    const idBySlug = new Map<string, (typeof sections)[number]["_id"]>()
    for (const s of sections) idBySlug.set(s.slug, s._id)
    const fallback = idBySlug.get("local") ?? sections[0]?._id
    if (!fallback) throw new Error("no sections")
    // Static import — Convex doesn't allow dynamic imports inside
    // mutations.
    const events = await ctx.db.query("events").collect()
    let moved = 0
    let unchanged = 0
    const moves: Array<{ from: string; to: string; title: string }> = []
    for (const e of events) {
      // Pull the first derivedFromItem's source URL for context.
      let sourceUrl: string | undefined
      const itemId = e.derivedFromItems?.[0]
      if (itemId) {
        const item = await ctx.db.get(itemId)
        if (item) {
          const src = await ctx.db.get(item.sourceId)
          sourceUrl = src?.url
        }
      }
      const result = classifyEvent({
        title: e.title,
        snippet: e.dek,
        body: e.body,
        locationName: e.locationName,
        locationAddress: e.locationAddress,
        sourceUrl: sourceUrl ?? e.url,
        itemTags: e.tags,
      })
      // Only move when the classifier has real signal (confidence >=
      // 0.5). Fallback-to-local matches don't override an existing
      // hand-set or LLM-enrichment-picked section.
      if (result.confidence < 0.5) {
        unchanged += 1
        continue
      }
      const newId = idBySlug.get(result.sectionSlug) ?? fallback
      if (newId === e.sectionId) {
        unchanged += 1
        continue
      }
      const fromSlug =
        sections.find((s) => s._id === e.sectionId)?.slug ?? "?"
      moves.push({
        from: fromSlug,
        to: result.sectionSlug,
        title: e.title.slice(0, 60),
      })
      moved += 1
      if (!dryRun) {
        await ctx.db.patch(e._id, { sectionId: newId })
      }
    }
    return {
      scanned: events.length,
      moved,
      unchanged,
      dryRun: !!dryRun,
      sample: moves.slice(0, 20),
    }
  },
})

// Reassign UM academic events that were mis-filed under the Hurricanes
// section (`the-u`). Anything filed there whose title/body lacks a
// hard athletics keyword (game/vs/baseball/football/etc.) gets moved
// to the academic `university-of-miami` section — the proper home for
// dissertation defenses, school of music recitals, Frost concerts,
// etc. Sport-tagged events stay put.
export const repatriateNonAthleticHurricanes = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("sections").collect()
    const bySlug = new Map(all.map((s) => [s.slug, s]))
    const hurricanes = bySlug.get("the-u")
    const um = bySlug.get("university-of-miami")
    if (!hurricanes || !um) {
      return { error: "missing sections", scanned: 0, moved: 0, log: [] }
    }
    // Hard athletics signals. We're permissive on the front-side
    // (anything that hints at sport stays) to avoid catching a
    // legitimate Hurricanes football tailgate in the dragnet.
    const ATHLETICS =
      /\b(canes|hurricanes|football|baseball|basketball|volleyball|softball|soccer|tennis|track|cross[- ]country|swimming|diving|rowing|lacrosse|golf|game|gameday|tailgate|kickoff|vs\.?|matchup|tournament|championship|ncaa|acc|bowl|playoff|coach|athletic|sport|stadium|arena|opener|home\s+(?:game|opener)|away\s+(?:game)|recruit|signing\s+day|spring\s+practice|spring\s+game|hardrock|watsco|alex\s+rodriguez\s+park|cobb\s+stadium|knight\s+sports)\b/i
    const SPORT_TAGS = new Set([
      "sports",
      "the-u",
      "hurricanes",
      "miami-hurricanes",
      "college-sports",
      "football",
      "basketball",
      "baseball",
      "softball",
      "volleyball",
      "soccer",
      "tennis",
      "track-field",
      "rowing",
      "swimming",
      "lacrosse",
      "golf",
      "athletics",
    ])
    const log: Array<string> = []
    const events = await ctx.db
      .query("events")
      .withIndex("by_section_status_published", (q) =>
        q.eq("sectionId", hurricanes._id).eq("status", "approved"),
      )
      .collect()
    let moved = 0
    for (const e of events) {
      const tags = e.tags ?? []
      const hasSportTag = tags.some((t) => SPORT_TAGS.has(t))
      const haystack = [e.title, e.dek ?? "", e.description ?? "", e.body ?? ""]
        .join(" ")
      const looksAthletic = ATHLETICS.test(haystack)
      if (hasSportTag || looksAthletic) continue
      await ctx.db.patch(e._id, { sectionId: um._id })
      log.push(`moved → UM: ${e.title}`)
      moved += 1
    }
    return { scanned: events.length, moved, log }
  },
})

// =====================================================================
// Backfill `seriesKey` on every event row, then collapse pre-existing
// recurring-exhibit duplicates into a single row each.
//
// Step 1 walks every event and stamps `seriesKey = normTitle|normVenue`
// (when both are present). After this, future inserts on the same
// series collapse via the new `by_series_key` lookup in
// `insertExtracted`.
//
// Step 2 fixes the duplicates that were already in the table before
// the dedup change: for every seriesKey with N>1 rows, keeps the
// earliest-upcoming row, copies any unique citations + derivedFromItems
// into it, advances its startsAt to the soonest among the group, and
// hard-deletes the rest. Idempotent — re-running on a deduped table is
// a no-op.
//
// Run dev:  npx convex run migrations:backfillSeriesKey
// Run prod: npx convex run migrations:backfillSeriesKey --prod
// =====================================================================

export const backfillSeriesKey = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }) => {
    const all = await ctx.db.query("events").collect()
    let stamped = 0
    const bySeries = new Map<string, Array<typeof all[number]>>()
    for (const e of all) {
      const key = eventSeriesKey({
        title: e.title,
        locationName: e.locationName,
      })
      if (!key) continue
      if (!dryRun && e.seriesKey !== key) {
        await ctx.db.patch(e._id, { seriesKey: key })
        stamped += 1
      }
      const bucket = bySeries.get(key) ?? []
      bucket.push(e)
      bySeries.set(key, bucket)
    }

    const nowMs = Date.now()
    let collapsed = 0
    let deleted = 0
    for (const [, rows] of bySeries) {
      if (rows.length < 2) continue
      // Keep the earliest still-upcoming row; everything older or
      // duplicated rolls into it. If every row is in the past, keep
      // the most recent past one and delete the rest.
      const upcoming = rows
        .filter((r) => r.startsAt >= nowMs - 24 * 3_600_000)
        .sort((a, b) => a.startsAt - b.startsAt)
      const keeper =
        upcoming[0] ??
        rows.slice().sort((a, b) => b.startsAt - a.startsAt)[0]
      const losers = rows.filter((r) => r._id !== keeper._id)
      if (losers.length === 0) continue
      collapsed += 1
      if (dryRun) {
        deleted += losers.length
        continue
      }
      // Merge citations + derivedFromItems from every loser into the
      // keeper. Dedupe citations by URL, items by id.
      const mergedCitations = [
        ...(keeper.citations ?? []),
        ...losers.flatMap((l) => l.citations ?? []),
      ]
      const seenUrls = new Set<string>()
      const dedupedCitations = mergedCitations.filter((c) => {
        if (seenUrls.has(c.url)) return false
        seenUrls.add(c.url)
        return true
      })
      const mergedItems = Array.from(
        new Set(
          [
            ...(keeper.derivedFromItems ?? []),
            ...losers.flatMap((l) => l.derivedFromItems ?? []),
          ].map((i) => i as unknown as string),
        ),
      ) as unknown as Array<typeof keeper.derivedFromItems extends
        | Array<infer U>
        | undefined
        ? U
        : never>
      await ctx.db.patch(keeper._id, {
        citations: dedupedCitations,
        derivedFromItems: mergedItems,
      })
      for (const l of losers) {
        await ctx.db.delete(l._id)
        deleted += 1
      }
    }
    void normalizeTitle
    void normalizeVenue
    return { scanned: all.length, stamped, collapsed, deleted, dryRun: !!dryRun }
  },
})

// =====================================================================
// Targeted re-classification — only events currently in the `local`
// fallback section. Re-runs `classifyEvent` and moves them when the
// classifier returns a non-fallback section with confidence ≥ 0.5.
// Use after editing KEYWORD_RULES so newly-matched events promote out
// of the fallback bucket without disturbing rows that already have a
// hand-set or LLM-enrichment-picked section.
//
// Run dev:  npx convex run migrations:reclassifyLocalFallback
// Run prod: npx convex run migrations:reclassifyLocalFallback --prod
// =====================================================================
export const reclassifyLocalFallback = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }) => {
    const sections = await ctx.db.query("sections").collect()
    const localSection = sections.find((s) => s.slug === "local")
    if (!localSection) return { moved: 0, unchanged: 0, scanned: 0 }
    const idBySlug = new Map(sections.map((s) => [s.slug, s._id]))
    const events = await ctx.db
      .query("events")
      .withIndex("by_section_starts", (q) =>
        q.eq("sectionId", localSection._id),
      )
      .collect()
    let moved = 0
    let unchanged = 0
    const moves: Array<{ from: string; to: string; title: string }> = []
    for (const e of events) {
      let sourceUrl: string | undefined
      const itemId = e.derivedFromItems?.[0]
      if (itemId) {
        const item = await ctx.db.get(itemId)
        if (item) {
          const src = await ctx.db.get(item.sourceId)
          sourceUrl = src?.url
        }
      }
      const result = classifyEvent({
        title: e.title,
        snippet: e.dek,
        body: e.body,
        locationName: e.locationName,
        locationAddress: e.locationAddress,
        sourceUrl: sourceUrl ?? e.url,
        itemTags: e.tags,
      })
      if (result.sectionSlug === "local" || result.confidence < 0.5) {
        unchanged += 1
        continue
      }
      const newId = idBySlug.get(result.sectionSlug)
      if (!newId || newId === e.sectionId) {
        unchanged += 1
        continue
      }
      moves.push({
        from: "local",
        to: result.sectionSlug,
        title: e.title.slice(0, 60),
      })
      moved += 1
      if (!dryRun) {
        await ctx.db.patch(e._id, { sectionId: newId })
      }
    }
    return {
      scanned: events.length,
      moved,
      unchanged,
      dryRun: !!dryRun,
      sample: moves.slice(0, 30),
    }
  },
})

// =====================================================================
// Backfill — rewrite any all-caps event titles into editorial title
// case using the same `maybeTitleCase` helper that runs in the
// insert path. Re-running on already-normalized titles is a no-op
// because `maybeTitleCase` short-circuits on mixed-case strings.
//
// Run dev:  npx convex run migrations:titleCaseAllCapsEvents '{"dryRun": true}'
// Run live: npx convex run migrations:titleCaseAllCapsEvents
// =====================================================================

export const titleCaseAllCapsEvents = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }) => {
    const events = await ctx.db.query("events").collect()
    let scanned = 0
    let patched = 0
    const sample: Array<{ from: string; to: string }> = []
    for (const e of events) {
      scanned += 1
      if (!isShouty(e.title)) continue
      const next = maybeTitleCase(e.title)
      if (next === e.title) continue
      if (sample.length < 25) sample.push({ from: e.title, to: next })
      patched += 1
      if (!dryRun) await ctx.db.patch(e._id, { title: next })
    }
    return { scanned, patched, dryRun: !!dryRun, sample }
  },
})

// =====================================================================
// Bulk-move any events sitting in the `politics` section to `arts`.
// Politics has been a classifier overflow bucket — venue/host rules
// drop ambiguous events there even when they're music / nightlife /
// fitness / food. User direction: drop politics as a default target
// and let these land in Arts & Culture (no subsection needed).
//
// Run dev:  npx convex run migrations:movePoliticsToArts '{"dryRun":true}'
// Run live: npx convex run migrations:movePoliticsToArts
// =====================================================================
export const movePoliticsToArts = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }) => {
    const sections = await ctx.db.query("sections").collect()
    const politics = sections.find((s) => s.slug === "politics")
    if (!politics) return { error: "no politics section" as const, moved: 0 }
    const arts =
      sections.find((s) => s.slug === "arts") ??
      sections.find((s) => s.slug === "arts-culture") ??
      sections.find((s) => s.slug === "arts-and-culture")
    if (!arts) {
      return {
        error: "no arts section" as const,
        moved: 0,
        slugs: sections.map((s) => s.slug),
      }
    }
    const events = await ctx.db
      .query("events")
      .withIndex("by_section_status_published", (q) =>
        q.eq("sectionId", politics._id).eq("status", "approved"),
      )
      .collect()
    const sample: Array<string> = []
    let moved = 0
    for (const e of events) {
      if (sample.length < 30) sample.push(e.title.slice(0, 70))
      moved += 1
      if (!dryRun) await ctx.db.patch(e._id, { sectionId: arts._id })
    }
    return {
      scanned: events.length,
      moved,
      dryRun: !!dryRun,
      sample,
      from: politics.slug,
      to: arts.slug,
    }
  },
})

// 2026-06 stripDeadArticleFields removed after drain — patched 3
// events in prod (joyous-dalmatian-894) on 2026-06-04 before the
// schema narrow that dropped `relatedArticleIds` + `storyArcId` from
// the events table. Kept as a comment as breadcrumb; the function
// can no longer typecheck against the narrowed schema.

// =====================================================================
// 2026-06 repair broken CivicEngage iCal events. Two bugs combined to
// corrupt these rows:
//   1. The iCal parser didn't unfold `\` + newline line continuations
//      (RFC 5545 only documents space/tab continuation; CivicEngage
//      uses backslash). DESCRIPTION values got truncated mid-URL.
//   2. `firstSentence` treated the `.` in `https://www.` as a sentence
//      boundary, derivnig deks of just `https://www.`.
//   3. iCal `URL:` values are sometimes the relative path
//      `/common/modules/iCalendar/...` — stored verbatim, links 404'd.
//
// All three are fixed at the adapter / helper layer for future runs.
// This migration cleans up the rows already in the DB:
//   - Blank dek / description / body when they're just the URL artifact.
//   - For relative URL fields, blank them so the renderer falls back
//     to the first citation URL (which holds the real event link).
//
// Idempotent. Bounded scans (200/batch).
//
// Run dev:  npx convex run migrations:repairBrokenIcalEvents
// Run prod: npx convex run migrations:repairBrokenIcalEvents --prod
// =====================================================================

// Matches: bare URL like "https://www.foo.com/x?EID=", possibly with
// a trailing `\` (the unfolding artifact), or the bare "https://www."
// truncation that firstSentence produced.
const BROKEN_TEXT = /^\s*https?:\/\/\S*\\?\s*$/i
// Matches a stored event URL that has no host — e.g. starts with `/`
// or is exactly the relative iCal feed path.
const RELATIVE_URL = /^\s*\//

function isBrokenText(s: string | undefined | null): boolean {
  if (!s) return false
  const trimmed = s.trim()
  if (!trimmed) return false
  return BROKEN_TEXT.test(trimmed)
}

export const repairBrokenIcalEventsBatch = internalMutation({
  args: { cursor: v.optional(v.number()) },
  handler: async (ctx, { cursor }) => {
    const BATCH = 200
    const batch = await ctx.db
      .query("events")
      .order("asc")
      .filter((f) =>
        cursor === undefined
          ? true
          : f.gt(f.field("_creationTime"), cursor),
      )
      .take(BATCH)
    let patched = 0
    let dekFixed = 0
    let descFixed = 0
    let bodyFixed = 0
    let urlFixed = 0
    for (const e of batch) {
      const patch: Record<string, unknown> = {}
      if (isBrokenText(e.dek)) {
        patch.dek = undefined
        dekFixed += 1
      }
      if (isBrokenText(e.description)) {
        // Schema requires `description: v.string()`. Set to empty
        // string rather than undefined so the row still validates;
        // the renderer treats "" as no-description (falls back to
        // body / hides the dek slot).
        patch.description = ""
        descFixed += 1
      }
      if (isBrokenText(e.body)) {
        patch.body = undefined
        bodyFixed += 1
      }
      if (e.url && RELATIVE_URL.test(e.url)) {
        // Blank the url so the renderer falls back to the first
        // citation URL. Better than leaving a host-less path that
        // resolves to miami.community and 404s.
        patch.url = undefined
        urlFixed += 1
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(e._id, patch)
        patched += 1
      }
    }
    const nextCursor =
      batch.length === BATCH
        ? (batch[batch.length - 1]._creationTime as number)
        : null
    return {
      scanned: batch.length,
      patched,
      dekFixed,
      descFixed,
      bodyFixed,
      urlFixed,
      nextCursor,
    }
  },
})

export const repairBrokenIcalEvents = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    batches: number
    scanned: number
    patched: number
    dekFixed: number
    descFixed: number
    bodyFixed: number
    urlFixed: number
  }> => {
    let batches = 0
    let scanned = 0
    let patched = 0
    let dekFixed = 0
    let descFixed = 0
    let bodyFixed = 0
    let urlFixed = 0
    let cursor: number | null = null
    const MAX_BATCHES = 200
    for (let i = 0; i < MAX_BATCHES; i += 1) {
      const result: {
        scanned: number
        patched: number
        dekFixed: number
        descFixed: number
        bodyFixed: number
        urlFixed: number
        nextCursor: number | null
      } = await ctx.runMutation(
        internal.migrations.repairBrokenIcalEventsBatch,
        { cursor: cursor ?? undefined },
      )
      scanned += result.scanned
      patched += result.patched
      dekFixed += result.dekFixed
      descFixed += result.descFixed
      bodyFixed += result.bodyFixed
      urlFixed += result.urlFixed
      batches += 1
      cursor = result.nextCursor
      if (cursor === null) break
    }
    return { batches, scanned, patched, dekFixed, descFixed, bodyFixed, urlFixed }
  },
})

// =====================================================================
// 2026-06 remove the High Schools sub-section. The K-12 sub-tree under
// Education was too granular for the events coverage we actually see —
// the dadeschools.net feed is a single county-wide calendar and the
// other school sources don't carry a per-school feed, so high-school
// events file naturally under the parent Education section. Mirrors
// the earlier `trimSchoolSubsections` that dropped middle / elementary.
//
// Reparents existing high-schools events → education, drops the
// section ID from any sources that reference it, then deletes the
// section row. Idempotent — re-running is a no-op once the section
// is gone.
//
// Run dev:  npx convex run migrations:removeHighSchoolsSubsection
// Run prod: npx convex run migrations:removeHighSchoolsSubsection --prod
// =====================================================================
export const removeHighSchoolsSubsection = internalMutation({
  args: {},
  handler: async (ctx) => {
    const log: Array<string> = []
    const all = await ctx.db.query("sections").collect()
    const bySlug = new Map(all.map((s) => [s.slug, s]))
    const dead = bySlug.get("high-schools")
    if (!dead) {
      log.push("high-schools section already absent — no-op")
      return {
        eventsReparented: 0,
        sourcesUpdated: 0,
        sectionsDeleted: 0,
        log,
      }
    }
    const parent = bySlug.get("education")
    if (!parent) {
      log.push("WARN: no `education` parent section; aborting before any change")
      return {
        eventsReparented: 0,
        sourcesUpdated: 0,
        sectionsDeleted: 0,
        log,
      }
    }
    const events = await ctx.db
      .query("events")
      .withIndex("by_section_starts", (q) => q.eq("sectionId", dead._id))
      .collect()
    for (const e of events) {
      await ctx.db.patch(e._id, { sectionId: parent._id })
    }
    log.push(`reparented ${events.length} events → education`)
    let sourcesUpdated = 0
    const sources = await ctx.db.query("sources").collect()
    for (const s of sources) {
      if (!s.sectionIds?.includes(dead._id)) continue
      const next = s.sectionIds.filter((id) => id !== dead._id)
      await ctx.db.patch(s._id, { sectionIds: next })
      sourcesUpdated += 1
    }
    if (sourcesUpdated > 0) log.push(`updated ${sourcesUpdated} sources`)
    await ctx.db.delete(dead._id)
    log.push("deleted high-schools section")
    return {
      eventsReparented: events.length,
      sourcesUpdated,
      sectionsDeleted: 1,
      log,
    }
  },
})
