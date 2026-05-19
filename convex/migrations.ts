import { v } from "convex/values"

import { internal } from "./_generated/api"
import { buildSearchableText } from "./articles"
import { internalAction, internalMutation } from "./_generated/server"

// One-shot strip for redundant location tags. Every story on
// miami.community is local by definition, so tags like "miami-dade" carry
// no signal and clutter the tag list.
//
// Run with:
//   npx convex run migrations:stripTag '{"tag":"miami-dade"}'
export const stripTag = internalMutation({
  args: { tag: v.string() },
  handler: async (ctx, { tag }) => {
    const articles = await ctx.db.query("articles").collect()
    let cleared = 0
    for (const a of articles) {
      if (!a.tags.includes(tag)) continue
      const next = a.tags.filter((t) => t !== tag)
      await ctx.db.patch(a._id, { tags: next })
      cleared += 1
    }
    return { scanned: articles.length, cleared }
  },
})

// Backfill `searchableText` on every article from its current title + dek
// + tags so the search index covers legacy docs. Idempotent — re-running
// just refreshes the blob.
//
// Run with:
//   npx convex run migrations:backfillSearchable
export const backfillSearchable = internalMutation({
  args: {},
  handler: async (ctx) => {
    const articles = await ctx.db.query("articles").collect()
    let updated = 0
    for (const a of articles) {
      const next = buildSearchableText({
        title: a.title,
        dek: a.dek,
        tags: a.tags,
      })
      if (a.searchableText === next) continue
      await ctx.db.patch(a._id, { searchableText: next })
      updated += 1
    }
    return { scanned: articles.length, updated }
  },
})

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

export const wipeArticlesBatch = internalMutation({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, { batchSize }) => {
    // 200 articles × (~1 join row each) ≈ 400 writes per call, well
    // under Convex's per-transaction write limit.
    const cap = batchSize ?? 200
    const articles = await ctx.db.query("articles").take(cap)
    let deletedArticles = 0
    let deletedAuthorJoins = 0
    for (const a of articles) {
      const joins = await ctx.db
        .query("article_authors")
        .withIndex("by_article", (q) => q.eq("articleId", a._id))
        .collect()
      for (const j of joins) {
        await ctx.db.delete(j._id)
        deletedAuthorJoins += 1
      }
      await ctx.db.delete(a._id)
      deletedArticles += 1
    }
    return {
      deletedArticles,
      deletedAuthorJoins,
      hasMore: articles.length === cap,
    }
  },
})

export const wipeArticles = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    totalArticles: number
    totalAuthorJoins: number
    batches: number
  }> => {
    let totalArticles = 0
    let totalAuthorJoins = 0
    let batches = 0
    // Safety ceiling — refuses to loop forever if something is wrong.
    // 50 batches × 200 = 10k articles, plenty for our scale.
    const MAX_BATCHES = 200
    for (let i = 0; i < MAX_BATCHES; i += 1) {
      const result: {
        deletedArticles: number
        deletedAuthorJoins: number
        hasMore: boolean
      } = await ctx.runMutation(
        internal.migrations.wipeArticlesBatch,
        {},
      )
      totalArticles += result.deletedArticles
      totalAuthorJoins += result.deletedAuthorJoins
      batches += 1
      if (!result.hasMore) break
    }
    return { totalArticles, totalAuthorJoins, batches }
  },
})

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

  // Sports — parent + each team sub gets its own lineage.
  sports: ["sports", "game", "tailgate", "match"],
  dolphins: ["dolphins", "nfl", "miami-dolphins"],
  heat: ["heat", "nba", "miami-heat"],
  marlins: ["marlins", "mlb", "miami-marlins"],
  panthers: ["panthers", "nhl", "florida-panthers"],
  "inter-miami": ["inter-miami", "mls", "soccer"],
  "the-u": ["um", "the-u", "hurricanes", "miami-hurricanes"],
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
// 2026-05 hard prune of story-gathering sources. The events-only pivot
// shifted the editorial product from news+events to calendar-only —
// pure-news feeds now produce zero events per fetch in 90% of cases,
// they just consume input tokens. This migration flips
// enabled=false on every source that isn't in the event-rich
// allowlist below.
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
// pass — they're ~5% events / 95% stories. Stripped down to the curated
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
          "story-gathering source (events-only pivot prune)",
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
    slug: "high-schools",
    name: "High Schools",
    description:
      "Miami-Dade public and private high school events — open houses, fairs, parent nights, performances.",
    accentColor: "oklch(0.609 0.126 221.723)", // cyan-600
    order: 39,
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
