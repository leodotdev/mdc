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
