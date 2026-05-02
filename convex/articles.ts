import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"
import { api, internal } from "./_generated/api"
import { action, internalAction, internalMutation, mutation, query } from "./_generated/server"
import { requireEditor } from "./lib/guard"
import { generateTranslation } from "./lib/llm"
import { findHeroCandidates } from "./lib/media"
import { compareByImportance } from "./lib/scoring"
import { linkRelated } from "./lib/storyArcs"
import type { HeroCandidate, HeroFinderDiagnostics } from "./lib/media"
import type {MutationCtx, QueryCtx} from "./_generated/server";
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

async function hydrate(ctx: QueryCtx, article: Doc<"articles">) {
  const [section, authors] = await Promise.all([
    ctx.db.get(article.sectionId),
    loadAuthorsForArticle(ctx, article._id),
  ])
  return { ...article, section, authors }
}

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const article = await ctx.db
      .query("articles")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique()
    if (!article) return null
    return await hydrate(ctx, article)
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
    return { section, articles }
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

export const reviewQueue = query({
  args: {},
  handler: async (ctx) => {
    await requireEditor(ctx)
    const articles = await ctx.db
      .query("articles")
      .withIndex("by_status_created", (q) => q.eq("status", "pending_review"))
      .order("desc")
      .collect()
    return await Promise.all(articles.map((a) => hydrate(ctx, a)))
  },
})

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
      agentSlug,
      agentRunId,
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
    await ctx.db.insert("articleRevisions", {
      articleId,
      at: Date.now(),
      kind: "agent_augmented",
      agentSlug,
      agentRunId,
      changedFields: changedFields.length > 0 ? changedFields : undefined,
      citationsAdded: addedCitations.length,
      sourceItemsAdded: addedItems.length,
    })

    return {
      merged: true,
      citationsAdded: addedCitations.length,
      sourceItemsAdded: addedItems.length,
      contentUpdated: changedFields.length > 0,
    }
  },
})

// Articles a desk is allowed to enrich — both already-PUBLISHED pieces
// AND pending-review drafts queued for editor approval. Filters to the
// desk's section (primary + sub-sections via parentId), oldest-first so
// the bulk loop hits the stories with the longest accrual window before
// fresh ones (which haven't had time to attract follow-up coverage).
// `rejected` and `archived` are excluded — those are intentional removals.
export const enrichableForAgent = query({
  args: {
    agentId: v.id("agents"),
    limit: v.optional(v.number()),
    sinceMs: v.optional(v.number()),
  },
  handler: async (ctx, { agentId, limit, sinceMs }) => {
    const agent = await ctx.db.get(agentId)
    if (!agent) return []
    const cap = limit ?? 12
    const since = sinceMs ?? Date.now() - 30 * 24 * 3_600_000
    const childSections = await ctx.db
      .query("sections")
      .withIndex("by_parent", (q) => q.eq("parentId", agent.sectionId))
      .collect()
    const sectionIds: Array<Id<"sections">> = [
      agent.sectionId,
      ...childSections.map((s) => s._id),
    ]
    const collected: Array<Doc<"articles">> = []
    for (const sectionId of sectionIds) {
      for (const status of ["published", "pending_review"] as const) {
        const rows = await ctx.db
          .query("articles")
          .withIndex("by_section_status_published", (q) =>
            q.eq("sectionId", sectionId).eq("status", status),
          )
          .order("desc")
          .take(cap * 2)
        for (const row of rows) {
          const at = row.publishedAt ?? row.createdAt
          if (at < since) continue
          collected.push(row)
        }
      }
    }
    collected.sort(
      (a, b) =>
        (a.publishedAt ?? a.createdAt) - (b.publishedAt ?? b.createdAt),
    )
    return await Promise.all(
      collected.slice(0, cap).map(async (a) => {
        const section = await ctx.db.get(a.sectionId)
        return { ...a, section }
      }),
    )
  },
})

// Apply LLM-driven enrichment to an existing article. Additive on citations,
// derivedFromItems, and relatedArticleIds (dedup by URL / id). Optional
// rewrites land in title/dek/body/tags/neighborhoods/hero. Every change
// records a row in articleRevisions so the timeline shows what the desk
// touched and why. Skips rejected/archived articles outright.
export const enrichArticle = mutation({
  args: {
    articleId: v.id("articles"),
    patch: v.object({
      title: v.optional(v.string()),
      dek: v.optional(v.string()),
      body: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      neighborhoods: v.optional(v.array(v.string())),
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
    }),
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
    newRelatedIds: v.array(v.id("articles")),
    agentSlug: v.string(),
    agentRunId: v.id("agentRuns"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get(args.articleId)
    if (!article) return { changed: false }
    if (article.status === "rejected" || article.status === "archived") {
      return { changed: false }
    }

    const updates: Record<string, unknown> = {}
    const changedFields: Array<string> = []

    const patchString = (
      field: "title" | "dek" | "body",
      next: string | undefined,
    ) => {
      if (next === undefined) return
      const trimmed = next.trim()
      if (!trimmed || trimmed === article[field]) return
      updates[field] = trimmed
      changedFields.push(field)
    }
    patchString("title", args.patch.title)
    patchString("dek", args.patch.dek)
    patchString("body", args.patch.body)

    if (args.patch.tags) {
      const dedup = Array.from(
        new Set(args.patch.tags.map((t) => t.toLowerCase().trim()).filter(Boolean)),
      )
      const same =
        dedup.length === article.tags.length &&
        dedup.every((t, i) => article.tags[i] === t)
      if (!same) {
        updates.tags = dedup
        changedFields.push("tags")
      }
    }
    if (args.patch.neighborhoods) {
      const next = args.patch.neighborhoods
      const cur = article.neighborhoods ?? []
      const same =
        next.length === cur.length && next.every((n, i) => cur[i] === n)
      if (!same) {
        updates.neighborhoods = next
        changedFields.push("neighborhoods")
      }
    }
    if (args.patch.heroImage && args.patch.heroImage !== article.heroImage) {
      updates.heroImage = args.patch.heroImage
      if (args.patch.heroCaption !== undefined)
        updates.heroCaption = args.patch.heroCaption
      if (args.patch.heroSource !== undefined)
        updates.heroSource = args.patch.heroSource
      changedFields.push("hero")
    }

    // Append unique citations.
    const existingUrls = new Set(article.citations.map((c) => c.url))
    const addedCitations = args.newCitations.filter(
      (c) => !existingUrls.has(c.url),
    )
    if (addedCitations.length > 0) {
      updates.citations = [...article.citations, ...addedCitations]
    }

    // Append unique derivedFromItems.
    const existingItems = new Set(
      article.derivedFromItems.map((id) => id as string),
    )
    const addedItems = args.newSourceItems.filter(
      (id) => !existingItems.has(id as string),
    )
    if (addedItems.length > 0) {
      updates.derivedFromItems = [...article.derivedFromItems, ...addedItems]
    }

    // Append unique relatedArticleIds.
    const currentRelated = article.relatedArticleIds ?? []
    const existingRelated = new Set(currentRelated.map((id) => id as string))
    const addedRelated = args.newRelatedIds.filter(
      (id) => !existingRelated.has(id as string) && (id as string) !== (args.articleId as string),
    )
    if (addedRelated.length > 0) {
      updates.relatedArticleIds = [...currentRelated, ...addedRelated]
      changedFields.push("related")
    }

    // Refresh searchableText if any indexed field moved.
    if (
      changedFields.includes("title") ||
      changedFields.includes("dek") ||
      changedFields.includes("tags")
    ) {
      updates.searchableText = buildSearchableText({
        title: (updates.title as string | undefined) ?? article.title,
        dek: (updates.dek as string | undefined) ?? article.dek,
        tags: (updates.tags as Array<string> | undefined) ?? article.tags,
      })
    }

    const noChange =
      Object.keys(updates).length === 0 && addedRelated.length === 0
    if (noChange) return { changed: false }

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(args.articleId, updates)
    }

    if (addedRelated.length > 0) {
      await linkRelated(
        ctx,
        args.articleId,
        addedRelated,
        (updates.title as string | undefined) ?? article.title,
      )
    }

    await ctx.db.insert("articleRevisions", {
      articleId: args.articleId,
      at: Date.now(),
      kind: "agent_enriched",
      agentSlug: args.agentSlug,
      agentRunId: args.agentRunId,
      changedFields: changedFields.length > 0 ? changedFields : undefined,
      citationsAdded: addedCitations.length,
      sourceItemsAdded: addedItems.length,
      note: args.note,
    })

    return {
      changed: true,
      changedFields,
      citationsAdded: addedCitations.length,
      sourceItemsAdded: addedItems.length,
      relatedAdded: addedRelated.length,
    }
  },
})

// Published articles whose copy is bloated by the new house style (title
// > 60 chars, dek > 120 chars, or body > 80 words). Used by the bulk
// voice-refresh action — scans the most recent N published pieces and
// returns just the ones that need a re-roll. Stays cheap by capping the
// scan window; callers can call it repeatedly to drain the backlog.
export const needingVoiceRefresh = query({
  args: {
    limit: v.optional(v.number()),
    scan: v.optional(v.number()),
  },
  handler: async (ctx, { limit, scan }) => {
    const cap = limit ?? 20
    const scanCap = scan ?? 200
    const all = await ctx.db
      .query("articles")
      .withIndex("by_status_published", (q) => q.eq("status", "published"))
      .order("desc")
      .take(scanCap)
    const bloated = all.filter((a) => {
      if (a.title.length > 60) return true
      if (a.dek.length > 120) return true
      const wordCount = a.body.trim().split(/\s+/).length
      if (wordCount > 80) return true
      return false
    })
    return bloated.slice(0, cap).map((a) => ({
      _id: a._id,
      title: a.title,
      dek: a.dek,
      titleLen: a.title.length,
      dekLen: a.dek.length,
      bodyWords: a.body.trim().split(/\s+/).length,
    }))
  },
})

export const revisions = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, { articleId }) => {
    return await ctx.db
      .query("articleRevisions")
      .withIndex("by_article_at", (q) => q.eq("articleId", articleId))
      .order("desc")
      .take(50)
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
          unsplashEnabled: !!process.env.UNSPLASH_ACCESS_KEY,
          unsplashCount: 0,
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
    const editorEmail = await requireEditor(ctx)
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
    await ctx.db.insert("articleRevisions", {
      articleId,
      at: Date.now(),
      kind: "editor_edited",
      editorEmail,
      changedFields: ["hero"],
      note: heroImage
        ? `Hero swapped to ${heroSource ?? "source"}`
        : "Hero cleared",
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
    const editorEmail = await requireEditor(ctx)
    const cleaned: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) cleaned[key] = value
    }
    // Refresh the search blob whenever any of its sources changed.
    let existing: Doc<"articles"> | null = null
    if (
      cleaned.title !== undefined ||
      cleaned.dek !== undefined ||
      cleaned.tags !== undefined
    ) {
      existing = await ctx.db.get(id)
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
      // Compute changed fields for the revision log (excluding the
      // derived searchableText).
      if (!existing) existing = await ctx.db.get(id)
      const changedFields = existing
        ? Object.keys(cleaned).filter((k) => {
            if (k === "searchableText") return false
            const before = (existing as unknown as Record<string, unknown>)[k]
            const after = cleaned[k]
            return JSON.stringify(before) !== JSON.stringify(after)
          })
        : Object.keys(cleaned)
      await ctx.db.patch(id, cleaned)
      if (changedFields.length > 0) {
        await ctx.db.insert("articleRevisions", {
          articleId: id,
          at: Date.now(),
          kind: "editor_edited",
          editorEmail,
          changedFields,
        })
      }
    }
    return id
  },
})

async function logStatusChange(
  ctx: MutationCtx,
  articleId: Id<"articles">,
  before: string,
  after: string,
  editorEmail: string,
): Promise<void> {
  await ctx.db.insert("articleRevisions", {
    articleId,
    at: Date.now(),
    kind: "status_changed",
    editorEmail,
    statusBefore: before,
    statusAfter: after,
  })
}

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
    const result = await generateTranslation({
      model: "claude-opus-4-7",
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
    const sourceHash = articleSourceHash({
      title: article.title,
      dek: article.dek,
      body: article.body,
    })
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

// Editor-triggered single-article translation (e.g. from the queue
// editor). Wraps the internal action behind an auth check.
export const translateArticleNow = action({
  args: { articleId: v.id("articles") },
  handler: async (ctx, { articleId }): Promise<{ translated: boolean }> => {
    // Auth check — the action runs LLM calls so we don't want it
    // hammered by anonymous traffic.
    await ctx.runQuery(api.me.current, {})
    return await ctx.runAction(internal.articles.translateArticleAction, {
      articleId,
      lang: "es",
    })
  },
})

// Drain the backlog. Defaults to 10 articles per call so cost is
// predictable; the editor's "Translate backlog" button on the dashboard
// re-clicks until everything is current.
export const bulkTranslate = action({
  args: { maxArticles: v.optional(v.number()) },
  handler: async (
    ctx,
    { maxArticles },
  ): Promise<{
    processed: number
    translated: number
    errors: number
  }> => {
    await ctx.runQuery(api.me.current, {})
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
    const editorEmail = await requireEditor(ctx)
    const existing = await ctx.db.get(id)
    if (!existing) return
    await ctx.db.patch(id, {
      status: "published",
      publishedAt: existing.publishedAt ?? Date.now(),
    })
    await logStatusChange(ctx, id, existing.status, "published", editorEmail)
    // Auto-translate on publish so the ES copy is ready when the next
    // ES-language reader hits the page. Scheduled (not awaited) so the
    // editor's publish click stays snappy.
    await ctx.scheduler.runAfter(
      0,
      internal.articles.translateArticleAction,
      { articleId: id, lang: "es" },
    )
  },
})

export const unpublish = mutation({
  args: { id: v.id("articles") },
  handler: async (ctx, { id }) => {
    const editorEmail = await requireEditor(ctx)
    const existing = await ctx.db.get(id)
    if (!existing) return
    await ctx.db.patch(id, { status: "archived" })
    await logStatusChange(ctx, id, existing.status, "archived", editorEmail)
  },
})

export const reject = mutation({
  args: { id: v.id("articles") },
  handler: async (ctx, { id }) => {
    const editorEmail = await requireEditor(ctx)
    const existing = await ctx.db.get(id)
    if (!existing) return
    await ctx.db.patch(id, { status: "rejected" })
    await logStatusChange(ctx, id, existing.status, "rejected", editorEmail)
  },
})
