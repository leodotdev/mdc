// Near-duplicate detection. Most outlets cover the same Miami stories
// (county-commission rulings, festivals, weather), and the fact that
// multiple desks file from overlapping source pools means we ship the
// same story twice. This cron walks recent published articles and:
//
//   - For each new article (last 24h), scan ≤14 days of recent published
//     articles in the same section.
//   - If title similarity ≥ THRESHOLD or shared-tag count ≥ 3, treat as
//     a duplicate.
//   - When the duplicate has FEWER citations: archive it, redirect later
//     readers to the canonical (kept) one.
//   - When borderline (similarity .65–.80): just link as related, don't
//     archive.
//
// No LLM call — pure string + tag math. Runs every 6 hours.

import { internalAction, internalMutation, query } from "./_generated/server"
import { internal } from "./_generated/api"
import type { Doc } from "./_generated/dataModel"

const HARD_THRESHOLD = 0.8
const RELATED_THRESHOLD = 0.65
const RECENT_WINDOW_MS = 14 * 24 * 3_600_000

// Tokenize a title into lowercase content words. Drops short stop-noise
// so headline shape doesn't dominate the similarity metric.
const STOPWORDS = new Set([
  "a", "an", "and", "as", "at", "be", "by", "for", "from", "in", "is",
  "it", "of", "on", "or", "the", "to", "with", "after", "amid", "miami",
])
function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  )
}

// Jaccard similarity over title tokens. 0 = disjoint, 1 = identical.
function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter += 1
  return inter / (a.size + b.size - inter)
}

function sharedTagCount(a: ReadonlyArray<string>, b: ReadonlyArray<string>): number {
  const setA = new Set(a)
  let n = 0
  for (const t of b) if (setA.has(t)) n += 1
  return n
}

export const cronTick = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    scanned: number
    archivedDups: number
    linkedRelated: number
  }> => {
    const result = await ctx.runMutation(internal.dedup.runDedupPass, {})
    return result
  },
})

export const runDedupPass = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const recent = await ctx.db
      .query("articles")
      .withIndex("by_status_published", (q) => q.eq("status", "published"))
      .order("desc")
      .take(50)
    const newish = recent.filter(
      (a) => (a.publishedAt ?? a.createdAt) >= now - 24 * 3_600_000,
    )

    let archivedDups = 0
    let linkedRelated = 0

    for (const a of newish) {
      const aTokens = titleTokens(a.title)
      const candidates = await ctx.db
        .query("articles")
        .withIndex("by_section_status_published", (q) =>
          q.eq("sectionId", a.sectionId).eq("status", "published"),
        )
        .order("desc")
        .take(60)
      const peers = candidates.filter(
        (c) =>
          c._id !== a._id &&
          (c.publishedAt ?? c.createdAt) >= now - RECENT_WINDOW_MS,
      )
      let bestMatch:
        | { article: Doc<"articles">; score: number }
        | null = null
      for (const c of peers) {
        const score = Math.max(
          jaccard(aTokens, titleTokens(c.title)),
          // Tag overlap counts as a high signal too.
          sharedTagCount(a.tags, c.tags) >= 3 ? 0.85 : 0,
        )
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { article: c, score }
        }
      }
      if (!bestMatch) continue

      if (bestMatch.score >= HARD_THRESHOLD) {
        // Duplicate — archive whichever has FEWER citations. If equal,
        // archive the newer one (the older is likely the canonical
        // first-mover).
        const aCount = a.citations.length
        const bCount = bestMatch.article.citations.length
        const archiveTarget: Doc<"articles"> =
          aCount < bCount
            ? a
            : aCount > bCount
              ? bestMatch.article
              : (a.publishedAt ?? a.createdAt) >
                  (bestMatch.article.publishedAt ?? bestMatch.article.createdAt)
                ? a
                : bestMatch.article
        if (archiveTarget.status === "archived") continue
        await ctx.db.patch(archiveTarget._id, { status: "archived" })
        archivedDups += 1
      } else if (bestMatch.score >= RELATED_THRESHOLD) {
        // Soft match — just link both ways via relatedArticleIds.
        const linkA: Set<string> = new Set(
          (a.relatedArticleIds ?? []).map((id) => id as string),
        )
        const linkB: Set<string> = new Set(
          (bestMatch.article.relatedArticleIds ?? []).map((id) => id as string),
        )
        let touched = false
        if (!linkA.has(bestMatch.article._id)) {
          await ctx.db.patch(a._id, {
            relatedArticleIds: [
              ...(a.relatedArticleIds ?? []),
              bestMatch.article._id,
            ],
          })
          touched = true
        }
        if (!linkB.has(a._id)) {
          await ctx.db.patch(bestMatch.article._id, {
            relatedArticleIds: [
              ...(bestMatch.article.relatedArticleIds ?? []),
              a._id,
            ],
          })
          touched = true
        }
        if (touched) linkedRelated += 1
      }
    }

    return {
      scanned: newish.length,
      archivedDups,
      linkedRelated,
    }
  },
})

// Live status panel: how many duplicates were archived in the last 7 days.
// Cheap (scans 100 archived rows max).
export const recentDupActivity = query({
  args: {},
  handler: async (ctx) => {
    const since = Date.now() - 7 * 24 * 3_600_000
    const recent = await ctx.db
      .query("articles")
      .withIndex("by_status_created", (q) => q.eq("status", "archived"))
      .order("desc")
      .take(100)
    const recentDups = recent.filter((a) => a.createdAt >= since).length
    return { recentDups }
  },
})

