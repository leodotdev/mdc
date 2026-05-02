import type { Doc } from "../_generated/dataModel"

// Importance scoring for "above the fold" placement on the homepage and at
// the top of section pages. The score combines three signals already on
// each article — source breadth, citation depth, and recency — into a
// single number used to rank stories. Higher = more prominent.
//
// Editorial pinning was removed: front-page placement is now decided
// entirely by importance, and the admin tables surface the same score
// as a literal gauge so editors can see why a story is ranking where
// it is rather than overriding it with a flag.
//
// Tuning notes (raise/lower these here, not in callers):
// - WEIGHT_BREADTH × derivedFromItems.length    — cross-coverage signal
// - WEIGHT_DEPTH   × citations.length           — distinct cited URLs
// - HALF_LIFE_HOURS controls the recency decay  — older stories fade
export const WEIGHT_BREADTH = 1.5
export const WEIGHT_DEPTH = 1.0
export const HALF_LIFE_HOURS = 24

export function recencyFactor(ts: number, now: number): number {
  const ageHours = Math.max(0, (now - ts) / 3_600_000)
  return 1 / (1 + ageHours / HALF_LIFE_HOURS)
}

// Structural shape importance scoring needs — works for both server-side
// `Doc<"articles">` and client-side hydrated articles, so the admin
// gauge can call this function directly on whatever shape it has.
export type ScorableArticle = {
  derivedFromItems: ReadonlyArray<unknown>
  citations: ReadonlyArray<unknown>
  publishedAt?: number
  createdAt: number
}

export function importanceScore(
  article: ScorableArticle,
  now: number,
): number {
  const ts = article.publishedAt ?? article.createdAt
  const breadth = article.derivedFromItems.length
  const depth = article.citations.length
  const base = breadth * WEIGHT_BREADTH + depth * WEIGHT_DEPTH
  return base * recencyFactor(ts, now)
}

// Stable comparator: higher score wins, then more recent wins.
export function compareByImportance(
  a: Doc<"articles"> | (ScorableArticle & { publishedAt?: number; createdAt: number }),
  b: Doc<"articles"> | (ScorableArticle & { publishedAt?: number; createdAt: number }),
  now: number,
): number {
  const diff = importanceScore(b, now) - importanceScore(a, now)
  if (diff !== 0) return diff
  const ta = a.publishedAt ?? a.createdAt
  const tb = b.publishedAt ?? b.createdAt
  return tb - ta
}
