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
// - FRESHNESS_FLOOR_HOURS: stories younger than this get full credit;
//   older stories decay as usual. Keeps the lead slot from sticking
//   to a high-breadth piece for a full day when fresher news lands.
export const WEIGHT_BREADTH = 1.5
export const WEIGHT_DEPTH = 1.0
// 6h half-life: a 6h-old story has 50% recency, a 12h-old has 33%,
// a 20h-old has 23%. Tightened from 24h so a fresh 1-source story
// can outrank a 20h, 4-source story in the lead slot.
export const HALF_LIFE_HOURS = 6
const FRESHNESS_FLOOR_HOURS = 1

export function recencyFactor(ts: number, now: number): number {
  const ageHours = Math.max(0, (now - ts) / 3_600_000)
  // Stories within the freshness floor get full credit so a 12-min-
  // old breaking item doesn't get penalized vs a 60-min-old one.
  if (ageHours <= FRESHNESS_FLOOR_HOURS) return 1
  return 1 / (1 + (ageHours - FRESHNESS_FLOOR_HOURS) / HALF_LIFE_HOURS)
}

// Structural shape importance scoring needs — works for both server-side
// `Doc<"articles">` and client-side hydrated articles, so the admin
// gauge can call this function directly on whatever shape it has.
export type ScorableArticle = {
  derivedFromItems: ReadonlyArray<unknown>
  citations: ReadonlyArray<unknown>
  tags?: ReadonlyArray<string>
  title?: string
  publishedAt?: number
  createdAt: number
}

// Tags that get a score multiplier applied — used to demote crime
// stories from the lead slot unless their breadth/depth is genuinely
// out-of-distribution. The editor can extend this list as more
// patterns surface.
//
// Why bother: a single-source shooting story scoring 1.5 (one source,
// no extra citations) was outranking a 4-source policy piece scoring
// 9 because of recency. After 0.4× demotion, the shooting drops to
// 0.6 — still visible on the page, just not the lead.
const MUTED_TAGS = new Set([
  // Crime — demote unless genuinely lead-worthy (multi-source, broad
  // public-interest signal).
  "shooting",
  "shooting-victim",
  "shooting-death",
  "police-shooting",
  "mass-shooting",
  "gun-violence",
  "gunfire",
  "homicide",
  "murder",
  "fatal",
  "fatal-shooting",
  "fatal-crash",
  "stabbing",
  "robbery",
  "armed-robbery",
  "drug-bust",
  "narcotics-bust",
  "assault",
  "drive-by",
  "crime",
  "arrest",
  "shot-and-killed",
  // Non-Miami national/global noise — wire copy that occasionally
  // slips past the Miami-test filter at draft time gets shoved off the
  // lead at ranking time as a backstop.
  "national-news",
  "national-sports",
  "national-politics",
  "national-economy",
  "wire-copy",
  "international",
  "oil-markets",
  "oil-prices",
  "wall-street",
  "federal-reserve",
  // National sports teams that aren't Miami franchises — used when the
  // LLM still drafts a Knicks/Cowboys/Yankees recap.
  "cowboys",
  "giants",
  "knicks",
  "76ers",
  "yankees",
  "lakers",
])
const MUTED_TAG_MULTIPLIER = 0.4

// Headline-keyword fallback. The LLM doesn't always tag stories
// with the structured tags above — when a headline contains a strong
// non-local OR crime signal, demote the same way. Word-boundary
// regex so "shotgun" doesn't trigger on "shot", and "Heat" doesn't
// match Iran "heat-up".
const MUTED_HEADLINE_REGEX =
  /\b(shot|shooting|killed|murder|murdered|stabb(?:ed|ing)|homicide|gunman|gunfire|gun violence|drive[- ]by|robbery|robbed|armed robbery|fatal(?:ly)? shot|police shooting|cowboys|giants|knicks|76ers|yankees|lakers|nebraska|iran|denver|wall street|oil markets?|hantavirus|federal reserve)\b/i

function mutedTagFactor(
  tags: ReadonlyArray<string> | undefined,
  title?: string,
): number {
  if (tags && tags.length > 0) {
    for (const t of tags) {
      if (MUTED_TAGS.has(t)) return MUTED_TAG_MULTIPLIER
    }
  }
  if (title && MUTED_HEADLINE_REGEX.test(title)) {
    return MUTED_TAG_MULTIPLIER
  }
  return 1
}

export function importanceScore(
  article: ScorableArticle,
  now: number,
): number {
  const ts = article.publishedAt ?? article.createdAt
  const breadth = article.derivedFromItems.length
  const depth = article.citations.length
  const base = breadth * WEIGHT_BREADTH + depth * WEIGHT_DEPTH
  return (
    base *
    recencyFactor(ts, now) *
    mutedTagFactor(article.tags, article.title)
  )
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

// =====================================================================
// Event importance — different signals than articles. Events are
// time-based, so the strongest signal is "how soon" (proximity to
// startsAt), with depth (citations) and visual richness (hero image)
// as secondary boosts. Used to render the same gauge in admin tables.
// =====================================================================
export type ScorableEvent = {
  startsAt: number
  citations?: ReadonlyArray<unknown>
  derivedFromItems?: ReadonlyArray<unknown>
  heroImage?: string
  imageUrl?: string
}

// Time-to-event proximity. Peaks at 1.0 when the event is happening now,
// decays smoothly out to ~0.05 at 30 days. Past events drop fast.
function eventProximityFactor(startsAt: number, now: number): number {
  const deltaHours = (startsAt - now) / 3_600_000
  if (deltaHours < -24) return 0 // already over
  if (deltaHours < 0) return 0.6 // happening / just-past — still hot
  // Half-life of 7 days for upcoming.
  return 1 / (1 + deltaHours / (24 * 7))
}

export function eventImportanceScore(
  event: ScorableEvent,
  now: number,
): number {
  const proximity = eventProximityFactor(event.startsAt, now)
  const depth = (event.citations?.length ?? 0) * WEIGHT_DEPTH
  const breadth = (event.derivedFromItems?.length ?? 0) * WEIGHT_BREADTH
  const visual = event.heroImage || event.imageUrl ? 1 : 0
  // Same baseline shape as articles so the gauge readings feel comparable.
  const base = breadth + depth + visual
  // Bias toward proximity — a same-day event with one citation should
  // outrank a month-out event with five.
  return base * proximity + proximity * 2
}
