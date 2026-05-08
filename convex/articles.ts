import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"
import { api, internal } from "./_generated/api"
import { action, internalAction, internalMutation, mutation, query } from "./_generated/server"
import { cleanTags } from "./agents"
import { requireEditor } from "./lib/guard"
import { estimatedCallCents } from "./lib/budget"
import { cronsEnabled } from "./lib/cronGate"
import { generateTranslation, verifyMerge } from "./lib/llm"
import { findHeroCandidates } from "./lib/media"
import { compareByImportance } from "./lib/scoring"
import type { HeroCandidate, HeroFinderDiagnostics } from "./lib/media"
import type { QueryCtx } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"

// Hard ceiling on candidate scan when ranking by importance — bounds query
// work even if the publishing volume balloons. At v1 scale, all recent
// articles fit well under this. Bump it before lookback windows can hold
// more than this many published articles.
const TOP_STORIES_SCAN = 200

async function loadAuthorsForArticle(
  ctx: QueryCtx,
  articleId: Id<"articles">,
) {
  const links = await ctx.db
    .query("article_authors")
    .withIndex("by_article", (q) => q.eq("articleId", articleId))
    .collect()
  return await Promise.all(
    links.map(async (link) => {
      const author = await ctx.db.get(link.authorId)
      return author
    }),
  ).then((authors) => authors.filter((a): a is Doc<"authors"> => a !== null))
}

// Attach the trunk-section accent so kickers render in the parent's
// color (Marlins → Sports red; Business → News blue) rather than the
// leaf's own. Top-level sections get the field omitted; consumers
// fall back to `section.accentColor`.
async function attachParentAccent<T extends Doc<"sections"> | null>(
  ctx: QueryCtx,
  section: T,
): Promise<T extends null ? null : T & { parentAccentColor?: string }> {
  if (!section) return null as T extends null ? null : never
  if (!section.parentId) return section as never
  const parent = await ctx.db.get(section.parentId)
  if (!parent) return section as never
  return { ...section, parentAccentColor: parent.accentColor } as never
}

async function hydrate(ctx: QueryCtx, article: Doc<"articles">) {
  const [rawSection, authors] = await Promise.all([
    ctx.db.get(article.sectionId),
    loadAuthorsForArticle(ctx, article._id),
  ])
  const section = await attachParentAccent(ctx, rawSection)
  return { ...article, section, authors }
}

export { attachParentAccent }

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    let article = await ctx.db
      .query("articles")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique()
    // Slug fallback for merged articles. The merge sweep absorbs a
    // loser article's slug into the winner's `previousSlugs` array, so
    // a request for the loser's old slug still resolves to the merged
    // (winner) article. Scoped scan: bounded at 50 most-recent merged
    // candidates by `mergedIntoId` presence — small relative to the
    // catalog and only fires on cache-miss URLs.
    if (!article) {
      const winners = await ctx.db
        .query("articles")
        .withIndex("by_status_published", (q) => q.eq("status", "published"))
        .order("desc")
        .take(200)
      const match = winners.find((a) =>
        (a.previousSlugs ?? []).includes(slug),
      )
      if (match) article = match
    }
    if (!article) return null
    // If the article was itself merged INTO another, follow the chain
    // and serve the canonical winner. Bounded loop just in case.
    let canonical: Doc<"articles"> = article
    let depth = 0
    while (canonical.mergedIntoId && depth < 4) {
      const next: Doc<"articles"> | null = await ctx.db.get(
        canonical.mergedIntoId,
      )
      if (!next) break
      canonical = next
      depth += 1
    }
    return await hydrate(ctx, canonical)
  },
})

export const listBySection = query({
  args: {
    sectionSlug: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { sectionSlug, paginationOpts }) => {
    const section = await ctx.db
      .query("sections")
      .withIndex("by_slug", (q) => q.eq("slug", sectionSlug))
      .unique()
    if (!section) return { page: [], isDone: true, continueCursor: "" }

    // Sub-sections of this section. When present, the parent section page
    // surfaces articles from itself + every child.
    const children = await ctx.db
      .query("sections")
      .withIndex("by_parent", (q) => q.eq("parentId", section._id))
      .collect()

    if (children.length === 0) {
      // Leaf section — straightforward indexed pagination.
      const result = await ctx.db
        .query("articles")
        .withIndex("by_section_status_published", (q) =>
          q.eq("sectionId", section._id).eq("status", "published"),
        )
        .order("desc")
        .paginate(paginationOpts)

      return {
        ...result,
        page: await Promise.all(result.page.map((a) => hydrate(ctx, a))),
      }
    }

    // Parent section — fan out across its own + each child's section, merge
    // by publishedAt desc, then take the requested page. True cursor
    // pagination across the union is complex; a single page of N satisfies
    // the section-page UI for v1.
    const limit = paginationOpts.numItems
    const sectionIds = [section._id, ...children.map((c) => c._id)]
    const buckets = await Promise.all(
      sectionIds.map((id) =>
        ctx.db
          .query("articles")
          .withIndex("by_section_status_published", (q) =>
            q.eq("sectionId", id).eq("status", "published"),
          )
          .order("desc")
          .take(limit),
      ),
    )
    const merged = buckets.flat()
    merged.sort(
      (a, b) =>
        (b.publishedAt ?? b.createdAt) - (a.publishedAt ?? a.createdAt),
    )
    const page = merged.slice(0, limit)
    return {
      page: await Promise.all(page.map((a) => hydrate(ctx, a))),
      isDone: merged.length <= limit,
      continueCursor: "",
    }
  },
})

export const latest = query({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const articles = await ctx.db
      .query("articles")
      .withIndex("by_status_published", (q) => q.eq("status", "published"))
      .order("desc")
      .take(limit)
    return await Promise.all(articles.map((a) => hydrate(ctx, a)))
  },
})

// Video articles — published rows with `mediaType: "video"`. Scans
// recent published items and filters; bounded scan size keeps the
// query cheap regardless of total catalog. Used by the /watch route
// and by section-page "Watch" rails.
export const recentVideos = query({
  args: { limit: v.optional(v.number()), sectionSlug: v.optional(v.string()) },
  handler: async (ctx, { limit, sectionSlug }) => {
    const cap = limit ?? 24
    // Scan ~10× the cap so we still find enough video items even when
    // most recent articles are non-video. 240 is well below the 1000-row
    // best-practice ceiling.
    const candidates = await ctx.db
      .query("articles")
      .withIndex("by_status_published", (q) => q.eq("status", "published"))
      .order("desc")
      .take(cap * 10)
    const filtered = candidates.filter((a) => a.mediaType === "video")
    let scoped = filtered
    if (sectionSlug) {
      const section = await ctx.db
        .query("sections")
        .withIndex("by_slug", (q) => q.eq("slug", sectionSlug))
        .unique()
      if (!section) return []
      const sectionId = section._id
      const childIds = new Set(
        (
          await ctx.db
            .query("sections")
            .withIndex("by_parent", (q) => q.eq("parentId", sectionId))
            .collect()
        ).map((c) => c._id),
      )
      scoped = filtered.filter(
        (a) => a.sectionId === sectionId || childIds.has(a.sectionId),
      )
    }
    return await Promise.all(scoped.slice(0, cap).map((a) => hydrate(ctx, a)))
  },
})

// Above-the-fold ranking. Pulls a recent candidate set and orders it by
// importanceScore (source breadth + citation depth + editor pin × recency).
// Defaults to a 7-day window — long enough that an investigation with broad
// sourcing can stay above a flurry of one-source breaking items.
export const topStories = query({
  args: {
    limit: v.number(),
    lookbackHours: v.optional(v.number()),
  },
  handler: async (ctx, { limit, lookbackHours }) => {
    const now = Date.now()
    const since = now - (lookbackHours ?? 168) * 3_600_000
    const candidates = await ctx.db
      .query("articles")
      .withIndex("by_status_published", (q) => q.eq("status", "published"))
      .order("desc")
      .take(TOP_STORIES_SCAN)
    const ranked = candidates
      .filter((a) => (a.publishedAt ?? a.createdAt) >= since)
      .sort((a, b) => compareByImportance(a, b, now))
      .slice(0, limit)
    return await Promise.all(ranked.map((a) => hydrate(ctx, a)))
  },
})

// Candidates the desk's LLM can pick from when populating a draft's
// relatedArticleIds. Returns recent published articles with the same section
// boosted to the front of the list. Capped tight (15) to keep the LLM prompt
// small and prompt-cache friendly.
export const recentForLinking = query({
  args: {
    sectionId: v.optional(v.id("sections")),
    limit: v.optional(v.number()),
    lookbackHours: v.optional(v.number()),
  },
  handler: async (ctx, { sectionId, limit, lookbackHours }) => {
    const cap = limit ?? 15
    const since = Date.now() - (lookbackHours ?? 168) * 3_600_000

    const sameSection = sectionId
      ? await ctx.db
          .query("articles")
          .withIndex("by_section_status_published", (q) =>
            q.eq("sectionId", sectionId).eq("status", "published"),
          )
          .order("desc")
          .take(cap)
      : []
    const overall = await ctx.db
      .query("articles")
      .withIndex("by_status_published", (q) => q.eq("status", "published"))
      .order("desc")
      .take(cap)

    const seen = new Set<string>()
    const merged: Array<Doc<"articles">> = []
    for (const a of [...sameSection, ...overall]) {
      const key = a._id as string
      if (seen.has(key)) continue
      if ((a.publishedAt ?? a.createdAt) < since) continue
      seen.add(key)
      merged.push(a)
      if (merged.length >= cap) break
    }
    return await Promise.all(
      merged.map(async (a) => {
        const section = await ctx.db.get(a.sectionId)
        return {
          _id: a._id,
          title: a.title,
          dek: a.dek,
          publishedAt: a.publishedAt,
          section: section ? { name: section.name, slug: section.slug } : null,
        }
      }),
    )
  },
})

// Lightweight (non-hydrated) lookup of articles by id. Used to render the
// Related card and Story Arc rail with the same shape as the main feed.
export const listByIds = query({
  args: { ids: v.array(v.id("articles")) },
  handler: async (ctx, { ids }) => {
    if (ids.length === 0) return []
    const docs = await Promise.all(ids.map((id) => ctx.db.get(id)))
    const published = docs.filter(
      (d): d is Doc<"articles"> => d !== null && d.status === "published",
    )
    return await Promise.all(published.map((a) => hydrate(ctx, a)))
  },
})

// Returns every published article in a story arc, oldest first, so the UI
// can render a chronological "story arc" rail across an unfolding story.
export const storyArcMembers = query({
  args: { arcId: v.id("storyArcs") },
  handler: async (ctx, { arcId }) => {
    const arc = await ctx.db.get(arcId)
    if (!arc) return null
    const members = await ctx.db
      .query("articles")
      .withIndex("by_story_arc", (q) => q.eq("storyArcId", arcId))
      .collect()
    const published = members.filter((a) => a.status === "published")
    published.sort(
      (a, b) =>
        (a.publishedAt ?? a.createdAt) - (b.publishedAt ?? b.createdAt),
    )
    return {
      arc,
      articles: await Promise.all(published.map((a) => hydrate(ctx, a))),
    }
  },
})

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
    const children = await ctx.db
      .query("sections")
      .withIndex("by_parent", (q) => q.eq("parentId", section._id))
      .collect()
    const sectionIds = [section._id, ...children.map((c) => c._id)]
    const now = Date.now()
    const since = now - (lookbackHours ?? 168) * 3_600_000
    const buckets = await Promise.all(
      sectionIds.map((id) =>
        ctx.db
          .query("articles")
          .withIndex("by_section_status_published", (q) =>
            q.eq("sectionId", id).eq("status", "published"),
          )
          .order("desc")
          .take(TOP_STORIES_SCAN),
      ),
    )
    const candidates = buckets.flat()
    const ranked = candidates
      .filter((a) => (a.publishedAt ?? a.createdAt) >= since)
      .sort((a, b) => compareByImportance(a, b, now))
      .slice(0, limit)
    return await Promise.all(ranked.map((a) => hydrate(ctx, a)))
  },
})

export const moreFromSection = query({
  args: {
    sectionSlug: v.string(),
    excludeId: v.id("articles"),
    limit: v.number(),
  },
  handler: async (ctx, { sectionSlug, excludeId, limit }) => {
    const section = await ctx.db
      .query("sections")
      .withIndex("by_slug", (q) => q.eq("slug", sectionSlug))
      .unique()
    if (!section) return { section: null, articles: [] }
    const rows = await ctx.db
      .query("articles")
      .withIndex("by_section_status_published", (q) =>
        q.eq("sectionId", section._id).eq("status", "published"),
      )
      .order("desc")
      .take(limit + 1)
    const articles = await Promise.all(
      rows
        .filter((a) => a._id !== excludeId)
        .slice(0, limit)
        .map((a) => hydrate(ctx, a)),
    )
    return { section: await attachParentAccent(ctx, section), articles }
  },
})

// Articles whose `neighborhoods` array includes the given slug. Powers
// the per-neighborhood landing page (`/neighborhood/$slug`). Same scan-
// then-filter pattern as listByTag — Convex doesn't index array fields,
// so we cap the recent scan at 500.
export const listByNeighborhood = query({
  args: { slug: v.string(), limit: v.number() },
  handler: async (ctx, { slug, limit }) => {
    const recent = await ctx.db
      .query("articles")
      .withIndex("by_status_published", (q) => q.eq("status", "published"))
      .order("desc")
      .take(500)
    const matches = recent.filter((a) =>
      (a.neighborhoods ?? []).includes(slug),
    )
    return await Promise.all(matches.slice(0, limit).map((a) => hydrate(ctx, a)))
  },
})

export const listByTag = query({
  args: { tag: v.string(), limit: v.number() },
  handler: async (ctx, { tag, limit }) => {
    // Convex can't index array fields, so scan recent published articles
    // and filter in JS. Bounded by `take(500)` for safety; at v1 scale this
    // is well under a millisecond. Move to a join table if it ever bites.
    const recent = await ctx.db
      .query("articles")
      .withIndex("by_status_published", (q) => q.eq("status", "published"))
      .order("desc")
      .take(500)
    const matches = recent.filter((a) => a.tags.includes(tag))
    return await Promise.all(matches.slice(0, limit).map((a) => hydrate(ctx, a)))
  },
})

export const listByAuthor = query({
  args: {
    authorSlug: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { authorSlug, paginationOpts }) => {
    const author = await ctx.db
      .query("authors")
      .withIndex("by_slug", (q) => q.eq("slug", authorSlug))
      .unique()
    if (!author) return { page: [], isDone: true, continueCursor: "" }

    const links = await ctx.db
      .query("article_authors")
      .withIndex("by_author", (q) => q.eq("authorId", author._id))
      .paginate(paginationOpts)

    const articles = await Promise.all(
      links.page.map(async (link) => {
        const article = await ctx.db.get(link.articleId)
        if (!article || article.status !== "published") return null
        return await hydrate(ctx, article)
      }),
    )

    return {
      ...links,
      page: articles.filter((a): a is NonNullable<typeof a> => a !== null),
    }
  },
})

// ---------- Editorial mutations (called from CMS) ----------

// Composes the denormalized `searchableText` blob. Pulls weight from the
// title (repeated to bias ranking), the dek, and the tag list. Called by
// every write path so the search index stays current.
export function buildSearchableText(input: {
  title: string
  dek: string
  tags: ReadonlyArray<string>
}): string {
  return [input.title, input.title, input.dek, input.tags.join(" ")]
    .join(" ")
    .slice(0, 2000)
}

// Merge new desk-supplied citations and (optionally) refreshed content into
// an existing article. Called by `runDesk` when the LLM identifies an
// incoming source as covering a story we've already published. Behaviour:
// - Always: append new citations (deduped by URL) + new derivedFromItems.
// - Pending review: also replace title / dek / body if patch is provided
//   (editor hasn't approved content yet).
// - Published: never overwrite editor-approved content; only enrich sources.
// - Rejected / archived: skip silently (no-op).
// Writes one `articleRevisions` row of kind `agent_augmented`.
export const augmentArticle = mutation({
  args: {
    articleId: v.id("articles"),
    newCitations: v.array(
      v.object({
        url: v.string(),
        title: v.string(),
        publisher: v.optional(v.string()),
        fetchedAt: v.number(),
        snippet: v.optional(v.string()),
      }),
    ),
    newSourceItems: v.array(v.id("ingestedItems")),
    patch: v.optional(
      v.object({
        title: v.optional(v.string()),
        dek: v.optional(v.string()),
        body: v.optional(v.string()),
      }),
    ),
    agentSlug: v.string(),
    agentRunId: v.id("agentRuns"),
  },
  handler: async (
    ctx,
    {
      articleId,
      newCitations,
      newSourceItems,
      patch,
    },
  ) => {
    const article = await ctx.db.get(articleId)
    if (!article) return { merged: false }
    if (article.status === "rejected" || article.status === "archived") {
      return { merged: false }
    }

    const existingUrls = new Set(article.citations.map((c) => c.url))
    const addedCitations = newCitations.filter(
      (c) => !existingUrls.has(c.url),
    )
    const existingItems = new Set(
      article.derivedFromItems.map((id) => id as string),
    )
    const addedItems = newSourceItems.filter(
      (id) => !existingItems.has(id as string),
    )

    const updates: Record<string, unknown> = {
      citations: [...article.citations, ...addedCitations],
      derivedFromItems: [...article.derivedFromItems, ...addedItems],
    }

    const changedFields: Array<string> = []
    if (article.status === "pending_review" && patch) {
      const nextTitle =
        patch.title && patch.title !== article.title
          ? patch.title
          : article.title
      const nextDek =
        patch.dek && patch.dek !== article.dek ? patch.dek : article.dek
      const nextBody =
        patch.body && patch.body !== article.body ? patch.body : article.body
      if (nextTitle !== article.title) {
        updates.title = nextTitle
        changedFields.push("title")
      }
      if (nextDek !== article.dek) {
        updates.dek = nextDek
        changedFields.push("dek")
      }
      if (nextBody !== article.body) {
        updates.body = nextBody
        changedFields.push("body")
      }
      if (changedFields.length > 0) {
        updates.searchableText = buildSearchableText({
          title: nextTitle,
          dek: nextDek,
          tags: article.tags,
        })
      }
    }

    await ctx.db.patch(articleId, updates)

    return {
      merged: true,
      citationsAdded: addedCitations.length,
      sourceItemsAdded: addedItems.length,
      contentUpdated: changedFields.length > 0,
    }
  },
})


// Auto-published articles in the last 24h that look weak — too long,
// too short, missing a hero, single-source. Surfaced on the admin
// dashboard so the editor can pop in and re-roll voice / find a better
// hero / mark for follow-up. Doesn't block publishing, just flags.
//
// Returns each anomalous row with the specific reasons it tripped, so
// the dashboard UI can show the "why" without re-computing client-side.
export const recentAnomalies = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const cap = limit ?? 12
    const since = Date.now() - 24 * 3_600_000
    const recent = await ctx.db
      .query("articles")
      .withIndex("by_status_published", (q) => q.eq("status", "published"))
      .order("desc")
      .take(60)
    const flagged: Array<{
      _id: Doc<"articles">["_id"]
      slug: string
      title: string
      sectionAccent?: string
      sectionName?: string
      heroImage?: string
      reasons: Array<string>
    }> = []
    for (const a of recent) {
      if (!a.publishedAt || a.publishedAt < since) continue
      const reasons: Array<string> = []
      if (a.title.length > 60) reasons.push(`title ${a.title.length} chars`)
      if (a.dek.length > 100) reasons.push(`dek ${a.dek.length} chars`)
      const bodyWords = a.body.trim().split(/\s+/).filter(Boolean).length
      if (bodyWords < 20) reasons.push(`body ${bodyWords} words (thin)`)
      if (bodyWords > 80) reasons.push(`body ${bodyWords} words (bloated)`)
      if (!a.heroImage || a.heroSource === "none") reasons.push("no hero")
      const distinctPublishers = new Set(
        a.citations
          .map((c) => c.publisher)
          .filter((p): p is string => !!p),
      )
      if (a.citations.length < 2) reasons.push("only 1 citation")
      else if (distinctPublishers.size < 2) reasons.push("single source")
      if (reasons.length === 0) continue
      const section = await ctx.db.get(a.sectionId)
      flagged.push({
        _id: a._id,
        slug: a.slug,
        title: a.title,
        sectionAccent: section?.accentColor,
        sectionName: section?.name,
        heroImage: a.heroImage,
        reasons,
      })
      if (flagged.length >= cap) break
    }
    return flagged
  },
})

// Articles published in the last 24h that came in via the auto-graduate
// gate (i.e. agentSlug set and createdAt very close to publishedAt). Used
// by the live admin status panel "Recently auto-published" inbox.
export const recentlyAutoPublished = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const cap = limit ?? 8
    const since = Date.now() - 24 * 3_600_000
    const all = await ctx.db
      .query("articles")
      .withIndex("by_status_published", (q) => q.eq("status", "published"))
      .order("desc")
      .take(50)
    const auto = all.filter(
      (a) =>
        !!a.agentSlug &&
        a.publishedAt !== undefined &&
        a.publishedAt >= since &&
        Math.abs((a.publishedAt ?? 0) - a.createdAt) < 60_000,
    )
    return await Promise.all(
      auto.slice(0, cap).map((a) => hydrate(ctx, a)),
    )
  },
})

export const search = query({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    sectionId: v.optional(v.id("sections")),
  },
  handler: async (ctx, { query: q, limit, sectionId }) => {
    const trimmed = q.trim()
    if (trimmed.length < 2) return []
    const cap = Math.min(limit ?? 25, 50)
    const results = await ctx.db
      .query("articles")
      .withSearchIndex("by_searchable", (qb) => {
        let b = qb.search("searchableText", trimmed).eq("status", "published")
        if (sectionId) b = b.eq("sectionId", sectionId)
        return b
      })
      .take(cap)
    return await Promise.all(results.map((a) => hydrate(ctx, a)))
  },
})

export const publishedList = query({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const articles = await ctx.db
      .query("articles")
      .withIndex("by_status_published", (q) => q.eq("status", "published"))
      .order("desc")
      .take(limit)
    return await Promise.all(articles.map((a) => hydrate(ctx, a)))
  },
})

export const getById = query({
  args: { id: v.id("articles") },
  handler: async (ctx, { id }) => {
    const article = await ctx.db.get(id)
    if (!article) return null
    return await hydrate(ctx, article)
  },
})

// Hourly publish volume for the last 24 hours. Index 0 = 23 hours ago,
// index 23 = the current hour. Used by the dashboard's Output card
// sparkline. Scans recent published rows once and buckets them — cheap
// because the by_status_published index is keyed by publishedAt desc,
// so the take(200) hits the most-recent rows first.
export const publishedSparkline24h = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const since = now - 24 * 3_600_000
    const articles = await ctx.db
      .query("articles")
      .withIndex("by_status_published", (q) => q.eq("status", "published"))
      .order("desc")
      .take(200)
    const buckets = new Array<number>(24).fill(0)
    let total = 0
    for (const a of articles) {
      const ts = a.publishedAt ?? a.createdAt
      if (ts < since) break
      const hoursAgo = Math.floor((now - ts) / 3_600_000)
      if (hoursAgo < 0 || hoursAgo > 23) continue
      buckets[23 - hoursAgo] += 1
      total += 1
    }
    return { buckets, total }
  },
})

// Section-level breakdown of the last 24h's published articles. Returns
// rows sorted by count desc, capped at 8 — the dashboard's Output card
// only needs the headline mix, not the full taxonomy. Reuses the same
// 200-row scan window as `publishedSparkline24h`; for higher publish
// volumes we'd add a separate per-section index.
export const publishedLast24hBySection = query({
  args: {},
  handler: async (ctx) => {
    const since = Date.now() - 24 * 3_600_000
    const articles = await ctx.db
      .query("articles")
      .withIndex("by_status_published", (q) => q.eq("status", "published"))
      .order("desc")
      .take(200)
    const counts = new Map<string, { name: string; accent: string; count: number }>()
    for (const a of articles) {
      const ts = a.publishedAt ?? a.createdAt
      if (ts < since) break
      const section = await ctx.db.get(a.sectionId)
      if (!section) continue
      const slug = section.slug
      const existing = counts.get(slug)
      if (existing) {
        existing.count += 1
      } else {
        counts.set(slug, {
          name: section.name,
          accent: section.accentColor,
          count: 1,
        })
      }
    }
    return Array.from(counts.entries())
      .map(([slug, v]) => ({ slug, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
  },
})

// Find candidate hero images for a story — used by the editor's "Find
// image" picker. Pulls every OG / twitter:image / inline image from
// each cited source page plus Unsplash + Wikimedia Commons matches
// scoped to the story's headline + section. Reachability is NOT
// checked server-side (newspaper CDNs reject HEAD too aggressively);
// the UI hides broken tiles via <img onError>. Returns the candidate
// list AND a diagnostics object so the picker can explain WHY zero
// candidates came back when that happens.
export const findHeroOptions = action({
  args: { articleId: v.id("articles") },
  handler: async (
    ctx,
    { articleId },
  ): Promise<{
    candidates: Array<HeroCandidate>
    diagnostics: HeroFinderDiagnostics
  }> => {
    const article = await ctx.runQuery(api.articles.getById, { id: articleId })
    if (!article) {
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
    // Better fallback search: prefer tags + section name over the full
    // article title. The full title is usually too specific for stock-
    // photo APIs (e.g. "Miami-Dade water main break floods Coral Gables
    // in 90-minute storm" → 0 results). Tags are designed to be the
    // article's topical hooks; combined with the section they make a
    // search query Unsplash and Wikimedia actually have hits for.
    const sectionLabel = article.section?.name ?? "Miami"
    const tagsForQuery = article.tags
      .filter((t) => t.length > 2)
      .slice(0, 2)
      .map((t) => t.replace(/-/g, " "))
    const queryParts = [...tagsForQuery, sectionLabel].filter(Boolean)
    const fallbackQuery = queryParts.join(" ") || `Miami ${sectionLabel}`
    return await findHeroCandidates({
      citationUrls: article.citations.map((c) => c.url),
      fallbackQuery,
      excludeUrl: article.heroImage,
    })
  },
})

// Apply an editor-picked hero image. Writes an editor_edited revision
// row tagged `hero` so the timeline shows the swap. Pass heroImage
// undefined to clear the image entirely.
export const setHero = mutation({
  args: {
    articleId: v.id("articles"),
    heroImage: v.optional(v.string()),
    heroCaption: v.optional(v.string()),
    heroSource: v.optional(
      v.union(
        v.literal("source"),
        v.literal("unsplash"),
        v.literal("wikimedia"),
        v.literal("none"),
      ),
    ),
  },
  handler: async (ctx, { articleId, heroImage, heroCaption, heroSource }) => {
    await requireEditor(ctx)
    const article = await ctx.db.get(articleId)
    if (!article) return { changed: false }
    const same =
      heroImage === article.heroImage &&
      heroCaption === article.heroCaption &&
      heroSource === article.heroSource
    if (same) return { changed: false }
    await ctx.db.patch(articleId, {
      heroImage,
      heroCaption,
      heroSource: heroSource ?? (heroImage ? "source" : "none"),
    })
    return { changed: true }
  },
})

export const updateDraft = mutation({
  args: {
    id: v.id("articles"),
    title: v.optional(v.string()),
    dek: v.optional(v.string()),
    body: v.optional(v.string()),
    heroImage: v.optional(v.string()),
    heroCaption: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    slug: v.optional(v.string()),
    sectionId: v.optional(v.id("sections")),
    neighborhoods: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, ...patch }) => {
    await requireEditor(ctx)
    const cleaned: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) cleaned[key] = value
    }
    if (cleaned.tags !== undefined) {
      cleaned.tags = cleanTags(cleaned.tags as Array<string>)
    }
    // Refresh the search blob whenever any of its sources changed.
    if (
      cleaned.title !== undefined ||
      cleaned.dek !== undefined ||
      cleaned.tags !== undefined
    ) {
      const existing = await ctx.db.get(id)
      if (existing) {
        cleaned.searchableText = buildSearchableText({
          title: (cleaned.title as string | undefined) ?? existing.title,
          dek: (cleaned.dek as string | undefined) ?? existing.dek,
          tags:
            (cleaned.tags as Array<string> | undefined) ?? existing.tags,
        })
      }
    }
    if (Object.keys(cleaned).length > 0) {
      await ctx.db.patch(id, cleaned)
    }
    return id
  },
})

// Cheap deterministic hash of an article's EN copy. Used as
// `translations.es.sourceHash` so we can detect when EN drifted and the
// stored ES is stale. djb2 — fast, good-enough for change-detection
// (not cryptographic).
function articleSourceHash(article: {
  title: string
  dek: string
  body: string
}): string {
  const s = `${article.title}|${article.dek}|${article.body}`
  let h = 5381
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}

// Articles whose ES translation is missing OR whose sourceHash no
// longer matches the current EN copy. Excludes rejected/archived. Used
// by the dashboard "Translate backlog" button to drain untranslated
// stories at the editor's pace, and by the publish action to skip
// already-current rows when scheduling work.
export const needingTranslation = query({
  args: { limit: v.optional(v.number()), scan: v.optional(v.number()) },
  handler: async (ctx, { limit, scan }) => {
    const cap = limit ?? 10
    const scanCap = scan ?? 200
    const all = await ctx.db
      .query("articles")
      .withIndex("by_status_published", (q) => q.eq("status", "published"))
      .order("desc")
      .take(scanCap)
    const stale: Array<{ _id: typeof all[number]["_id"]; title: string }> = []
    for (const a of all) {
      const hash = articleSourceHash({
        title: a.title,
        dek: a.dek,
        body: a.body,
      })
      const tr = a.translations?.es
      if (!tr || tr.sourceHash !== hash) {
        stale.push({ _id: a._id, title: a.title })
      }
      if (stale.length >= cap) break
    }
    return stale
  },
})

// Persist a translation. Internal — only the translateArticle action
// calls this. Stamps `translatedAt` + `sourceHash` so future reads can
// tell whether the ES copy is still current.
export const setTranslation = internalMutation({
  args: {
    articleId: v.id("articles"),
    lang: v.literal("es"),
    translation: v.object({
      title: v.string(),
      dek: v.string(),
      body: v.string(),
      heroCaption: v.optional(v.string()),
    }),
    sourceHash: v.string(),
  },
  handler: async (ctx, { articleId, lang, translation, sourceHash }) => {
    const article = await ctx.db.get(articleId)
    if (!article) return
    const next = {
      ...translation,
      translatedAt: Date.now(),
      sourceHash,
    }
    const translations = { ...(article.translations ?? {}), [lang]: next }
    await ctx.db.patch(articleId, { translations })
  },
})

// Run the LLM, write the result. Internal action — invoked by the
// publish mutation via the scheduler, by the public translate action
// for one-off backfills, and by the bulkTranslate action to drain the
// backlog. Idempotent: re-running on a row that's already current
// produces the same hash and overwrites with identical data.
export const translateArticleAction = internalAction({
  args: { articleId: v.id("articles"), lang: v.literal("es") },
  handler: async (ctx, { articleId, lang }) => {
    const article = await ctx.runQuery(api.articles.getById, { id: articleId })
    if (!article) return { translated: false }
    if (article.status === "rejected" || article.status === "archived") {
      return { translated: false }
    }
    // Idempotency / debounce: if the stored ES translation already matches
    // the current EN sourceHash, there's nothing to do. Lets us schedule
    // translations cheaply on every publish without paying for repeat work
    // when the editor publishes → tweaks → re-publishes within the debounce
    // window.
    const sourceHash = articleSourceHash({
      title: article.title,
      dek: article.dek,
      body: article.body,
    })
    if (article.translations?.es?.sourceHash === sourceHash) {
      return { translated: false }
    }
    const reservation = await ctx.runMutation(internal.budget.reserve, {
      estimatedCents: estimatedCallCents("claude-sonnet-4-6"),
      label: "translateArticle",
    })
    if (!reservation.allowed) return { translated: false, budgetCapped: true }
    const result = await generateTranslation({
      model: "claude-sonnet-4-6",
      article: {
        title: article.title,
        dek: article.dek,
        body: article.body,
        heroCaption: article.heroCaption,
        sectionSlug: article.section?.slug,
        tags: article.tags,
      },
    })
    if (!result) return { translated: false }
    await ctx.runMutation(internal.articles.setTranslation, {
      articleId,
      lang,
      translation: {
        title: result.title,
        dek: result.dek,
        body: result.body,
        heroCaption: result.heroCaption,
      },
      sourceHash,
    })
    return { translated: true }
  },
})

// Cron-fired backlog drain. No editor UI — translation must always
// happen automatically. Catches rows where the on-publish scheduler
// failed (transient network error, daily budget cap, app restart).
// Idempotent via sourceHash short-circuit.
export const bulkTranslateInternal = internalAction({
  args: { maxArticles: v.optional(v.number()) },
  handler: async (
    ctx,
    { maxArticles },
  ): Promise<{
    processed: number
    translated: number
    errors: number
  }> => {
    if (!cronsEnabled()) {
      return { processed: 0, translated: 0, errors: 0 }
    }
    const cap = maxArticles ?? 10
    const stale = await ctx.runQuery(api.articles.needingTranslation, {
      limit: cap,
    })
    let processed = 0
    let translated = 0
    let errors = 0
    for (const s of stale) {
      processed += 1
      try {
        const r = await ctx.runAction(
          internal.articles.translateArticleAction,
          { articleId: s._id, lang: "es" },
        )
        if (r.translated) translated += 1
      } catch {
        errors += 1
      }
    }
    return { processed, translated, errors }
  },
})

export const publish = mutation({
  args: { id: v.id("articles") },
  handler: async (ctx, { id }) => {
    await requireEditor(ctx)
    const existing = await ctx.db.get(id)
    if (!existing) return
    await ctx.db.patch(id, {
      status: "published",
      publishedAt: existing.publishedAt ?? Date.now(),
    })
    // Auto-translate on publish (60s debounce + sourceHash short-circuit).
    await ctx.scheduler.runAfter(
      60_000,
      internal.articles.translateArticleAction,
      { articleId: id, lang: "es" },
    )
  },
})

export const unpublish = mutation({
  args: { id: v.id("articles") },
  handler: async (ctx, { id }) => {
    await requireEditor(ctx)
    await ctx.db.patch(id, { status: "archived" })
  },
})

export const reject = mutation({
  args: { id: v.id("articles") },
  handler: async (ctx, { id }) => {
    await requireEditor(ctx)
    await ctx.db.patch(id, { status: "rejected" })
  },
})

// =====================================================================
// Post-publish merge sweep. Runs every few hours via cron. Finds
// recently-published article pairs that share enough surface signal
// (citation URLs + title-token overlap), then asks Haiku to verify
// they're actually the same news event before auto-merging. The
// in-run dedup mechanism (LLM `updateOfRelatedIndex`) handles
// same-batch duplicates; this sweep handles the across-batch case
// where two desks (or two runs) drafted the same story hours apart.
//
// Merge policy is cite-only — winner keeps its title/dek/body, just
// absorbs the loser's citations + derivedFromItems + tags +
// neighborhoods + relatedArticleIds. Loser is archived with
// `mergedIntoId` set + its slug pushed to the winner's
// `previousSlugs` so old URLs keep resolving.
// =====================================================================

// 7 days. The window has to cover the worst-case "system was down for
// the weekend" scenario — otherwise a stale prod with the cross-section
// duplicate we want to merge sits forever. Work is bounded by a fixed
// 80-article fetch limit regardless of window.
const MERGE_LOOKBACK_HOURS = 24 * 7
// Lower floor lets Haiku adjudicate looser pairs — the cross-section
// case (e.g. same incident filed under News + Nature) needs the
// permissive pre-filter because shared citation URLs are usually 0.
const MERGE_TITLE_TOKEN_OVERLAP_MIN = 0.3
const MERGE_CITATION_OVERLAP_MIN = 2
const VERIFY_MODEL = "claude-haiku-4-5-20251001"

// Common English filler words — stripping them stops generic words
// like "in"/"the"/"and"/"for"/"with" from inflating Jaccard overlap
// between unrelated headlines and crowding out the actual signal
// tokens (people, places, verbs).
const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "onto",
  "after",
  "over",
  "this",
  "that",
  "but",
  "not",
  "are",
  "was",
  "will",
  "have",
  "has",
  "had",
  "you",
  "your",
  "its",
])

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w)),
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter += 1
  return inter / (a.size + b.size - inter)
}

export const recordMerge = internalMutation({
  args: {
    winnerId: v.id("articles"),
    loserId: v.id("articles"),
    reason: v.string(),
  },
  handler: async (ctx, { winnerId, loserId, reason }) => {
    const winner = await ctx.db.get(winnerId)
    const loser = await ctx.db.get(loserId)
    if (!winner || !loser) return { ok: false }
    if (winner._id === loser._id) return { ok: false }

    // Union citations (dedup by URL).
    const seenUrls = new Set(winner.citations.map((c) => c.url))
    const mergedCitations = [...winner.citations]
    for (const c of loser.citations) {
      if (seenUrls.has(c.url)) continue
      seenUrls.add(c.url)
      mergedCitations.push(c)
    }

    // Union derivedFromItems.
    const winnerItems = new Set(
      (winner.derivedFromItems ?? []).map((id) => id as string),
    )
    const mergedItems = [...(winner.derivedFromItems ?? [])]
    for (const id of loser.derivedFromItems ?? []) {
      if (winnerItems.has(id)) continue
      winnerItems.add(id)
      mergedItems.push(id)
    }

    // Union tags + neighborhoods.
    const tagSet = new Set([...winner.tags, ...loser.tags])
    const hoodSet = new Set([
      ...(winner.neighborhoods ?? []),
      ...(loser.neighborhoods ?? []),
    ])

    // Union relatedArticleIds (drop the loser if it's in there).
    const winnerRelated = new Set(
      (winner.relatedArticleIds ?? []).map((id) => id as string),
    )
    for (const id of loser.relatedArticleIds ?? []) {
      if ((id as string) === (loser._id as string)) continue
      winnerRelated.add(id)
    }
    winnerRelated.delete(winner._id)
    winnerRelated.delete(loser._id)

    // Push loser's slug into winner's previousSlugs.
    const previousSlugs = new Set([
      ...(winner.previousSlugs ?? []),
      ...(loser.previousSlugs ?? []),
      loser.slug,
    ])
    previousSlugs.delete(winner.slug)

    await ctx.db.patch(winner._id, {
      citations: mergedCitations,
      derivedFromItems: mergedItems,
      tags: Array.from(tagSet),
      neighborhoods: Array.from(hoodSet),
      relatedArticleIds: Array.from(winnerRelated).map(
        (id) => id as Id<"articles">,
      ),
      previousSlugs: Array.from(previousSlugs),
    })
    await ctx.db.patch(loser._id, {
      status: "archived",
      mergedIntoId: winner._id,
      mergedAt: Date.now(),
    })
    return { ok: true, reason }
  },
})

// Recent merges for the dashboard's Self-healing card. Returns up to
// `limit` losers (status=archived, mergedIntoId set), each hydrated
// with its winner's title so the editor can see "loser → winner" at a
// glance. Bounded scan; no separate index needed at v1 volume.
export const recentMerges = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const cap = limit ?? 6
    const candidates = await ctx.db.query("articles").order("desc").take(200)
    const merges = candidates
      .filter((a) => a.mergedIntoId && a.mergedAt)
      .sort((a, b) => (b.mergedAt ?? 0) - (a.mergedAt ?? 0))
      .slice(0, cap)
    return await Promise.all(
      merges.map(async (loser) => {
        const winner = loser.mergedIntoId
          ? await ctx.db.get(loser.mergedIntoId)
          : null
        return {
          _id: loser._id,
          loserTitle: loser.title,
          winnerTitle: winner?.title ?? null,
          winnerSlug: winner?.slug ?? null,
          mergedAt: loser.mergedAt ?? 0,
        }
      }),
    )
  },
})

// Total count of articles that have been merged away — the cumulative
// "this many duplicate stories were absorbed" number for the
// dashboard. Bounded scan; bump if volume grows.
export const mergedCount = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("articles").take(2000)
    let merged = 0
    let last7d = 0
    const weekAgo = Date.now() - 7 * 24 * 3_600_000
    for (const a of all) {
      if (!a.mergedIntoId) continue
      merged += 1
      if ((a.mergedAt ?? 0) >= weekAgo) last7d += 1
    }
    return { total: merged, last7d }
  },
})

export const mergeSweep = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    scanned: number
    candidates: number
    verified: number
    merged: number
    notes: Array<string>
  }> => {
    if (!cronsEnabled()) {
      return {
        scanned: 0,
        candidates: 0,
        verified: 0,
        merged: 0,
        notes: ["skipped — CRONS_ENABLED not set"],
      }
    }
    const since = Date.now() - MERGE_LOOKBACK_HOURS * 3_600_000
    const recent = await ctx.runQuery(api.articles.publishedRecentForMerge, {
      sinceMs: since,
      limit: 80,
    })
    const notes: Array<string> = []

    // Pre-filter: pairs with citation OR title overlap above threshold.
    type Candidate = { a: typeof recent[number]; b: typeof recent[number] }
    const candidates: Array<Candidate> = []
    for (let i = 0; i < recent.length; i += 1) {
      const a = recent[i]
      if (a.mergedIntoId) continue
      const aTokens = tokenize(`${a.title} ${a.dek}`)
      const aUrls = new Set(a.citations.map((c) => c.url))
      for (let j = i + 1; j < recent.length; j += 1) {
        const b = recent[j]
        if (b.mergedIntoId) continue
        // Cross-section pairs are allowed — the gator-shooting case
        // (Nature + News filing the same incident) needs the merge
        // sweep to consider pairs across sections. Haiku verification
        // is the gate on false positives.
        const bTokens = tokenize(`${b.title} ${b.dek}`)
        const bUrls = new Set(b.citations.map((c) => c.url))
        let urlOverlap = 0
        for (const u of aUrls) if (bUrls.has(u)) urlOverlap += 1
        const titleOverlap = jaccard(aTokens, bTokens)
        if (
          urlOverlap >= MERGE_CITATION_OVERLAP_MIN ||
          titleOverlap >= MERGE_TITLE_TOKEN_OVERLAP_MIN
        ) {
          candidates.push({ a, b })
        }
      }
    }

    // LLM verification + merge for verified pairs. Mark merged loser
    // ids so we don't re-merge them inside this same run.
    const mergedLoserIds = new Set<string>()
    let verified = 0
    let merged = 0
    // Hard cap — at hourly cadence with a permissive title-overlap
    // floor, a quiet-news day can still surface 30+ pairs. Cap each
    // run so a flurry of false-positive candidates can't burn cents
    // even at 1¢ each. The unverified pairs roll into the next sweep.
    const MAX_VERIFICATIONS_PER_RUN = 12
    for (const { a, b } of candidates) {
      if (verified >= MAX_VERIFICATIONS_PER_RUN) {
        notes.push(`per-run verification cap hit at ${verified}`)
        break
      }
      if (mergedLoserIds.has(a._id)) continue
      if (mergedLoserIds.has(b._id)) continue
      // Budget gate — verifications are cheap (~1¢) but still booked.
      const reservation = await ctx.runMutation(internal.budget.reserve, {
        estimatedCents: estimatedCallCents(VERIFY_MODEL),
        label: "mergeVerify",
      })
      if (!reservation.allowed) {
        notes.push(`budget cap hit at ${verified} verifications`)
        break
      }
      const result = await verifyMerge({
        model: VERIFY_MODEL,
        a: { title: a.title, dek: a.dek, body: a.body },
        b: { title: b.title, dek: b.dek, body: b.body },
      })
      verified += 1
      if (!result || !result.sameStory) {
        notes.push(
          `kept distinct: "${a.title.slice(0, 40)}" / "${b.title.slice(0, 40)}" — ${result?.reason ?? "no verdict"}`,
        )
        continue
      }
      // Pick winner: most citations, fall back to most-recent.
      const aCount = a.citations.length
      const bCount = b.citations.length
      const winner =
        aCount === bCount
          ? (a.publishedAt ?? a.createdAt) >=
            (b.publishedAt ?? b.createdAt)
            ? a
            : b
          : aCount > bCount
            ? a
            : b
      const loser = winner._id === a._id ? b : a
      const r = await ctx.runMutation(internal.articles.recordMerge, {
        winnerId: winner._id,
        loserId: loser._id,
        reason: result.reason,
      })
      if (r.ok) {
        merged += 1
        mergedLoserIds.add(loser._id)
        notes.push(
          `merged "${loser.title.slice(0, 40)}" into "${winner.title.slice(0, 40)}" — ${result.reason}`,
        )
      }
    }

    return {
      scanned: recent.length,
      candidates: candidates.length,
      verified,
      merged,
      notes,
    }
  },
})

// Internal query — pulls recently-published articles for the merge
// sweep with just the fields the sweep needs (citation URLs, body for
// LLM verification, slug for redirects).
export const publishedRecentForMerge = query({
  args: { sinceMs: v.number(), limit: v.number() },
  handler: async (ctx, { sinceMs, limit }) => {
    const all = await ctx.db
      .query("articles")
      .withIndex("by_status_published", (q) => q.eq("status", "published"))
      .order("desc")
      .take(limit * 2)
    return all
      .filter((a) => (a.publishedAt ?? a.createdAt) >= sinceMs)
      .slice(0, limit)
  },
})

// Diagnostic for the merge sweep — when `mergeSweep` returns scanned=0
// you usually want to know whether the deployment has any published
// articles at all, when the most recent was, and what the oldest in
// the merge window looks like. Run via `npx convex run articles:diagnoseMerge --prod`.
export const diagnoseMerge = query({
  args: {},
  handler: async (ctx) => {
    const sample = await ctx.db
      .query("articles")
      .withIndex("by_status_published", (q) => q.eq("status", "published"))
      .order("desc")
      .take(20)
    const now = Date.now()
    const newest = sample[0]
    const oldest = sample[sample.length - 1]
    return {
      publishedSampleSize: sample.length,
      newestPublishedAt: newest?.publishedAt
        ? new Date(newest.publishedAt).toISOString()
        : null,
      newestAgeHours: newest?.publishedAt
        ? Math.round((now - newest.publishedAt) / 3_600_000)
        : null,
      newestTitle: newest?.title ?? null,
      oldestPublishedAt: oldest?.publishedAt
        ? new Date(oldest.publishedAt).toISOString()
        : null,
      now: new Date(now).toISOString(),
    }
  },
})
