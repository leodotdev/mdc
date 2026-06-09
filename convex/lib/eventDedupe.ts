// Content-derived dedup key for events. Two events with the same
// normalized title that start on the same calendar day collide on
// this key — that's the signal that the same event has been ingested
// from a second source (FIU has its iCal + its events-html crawl
// publishing the same items with different externalIds, for example).
//
// The key is intentionally coarse: same-day + same-title is enough
// to fold duplicates without over-matching unrelated events that
// happen to share a word.

export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[–—]/g, "-") // en/em dash → hyphen
    .replace(/[''""`]/g, "") // smart quotes
    .replace(/[^a-z0-9\s-]/g, " ") // punctuation → space
    .replace(/\s+/g, " ")
    .trim()
}

function dayKey(ts: number): string {
  // Miami-local day so events spanning midnight UTC group correctly.
  const d = new Date(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(ts),
  )
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`
}

export function eventDedupeKey(opts: {
  title: string
  startsAt: number
}): string {
  return `${normalizeTitle(opts.title)}|${dayKey(opts.startsAt)}`
}

// Date-independent series key — same normalized title + same venue.
// Used by insertExtracted to fold recurring-exhibit showings (Balloon
// Museum daily over 6 weeks, weekly trivia at a bar, etc.) into a
// single row whose `startsAt` tracks the next upcoming showing.
// Returns null when there's no usable venue — we don't want to merge
// every "Yoga" event in Miami because they share a generic title.
export function eventSeriesKey(opts: {
  title: string
  locationName?: string | null
}): string | null {
  const venue = normalizeVenue(opts.locationName)
  if (!venue) return null
  const title = normalizeTitle(opts.title)
  if (!title) return null
  return `${title}|${venue}`
}

// ── Secondary dedup signals ──────────────────────────────────────────
// The primary key above misses near-duplicates whose titles are
// worded differently ("Heat vs. Bucks" vs "Miami Heat — game day").
// The functions below give insertExtracted a cheap second-pass check
// after the primary key misses: scan same-day candidates, score them
// on URL + venue + time similarity, fold when above threshold.

/** Canonicalize a URL by lowercasing, stripping tracking params, and
 *  dropping the fragment. Two URLs that point at the same event page
 *  from different sources should collapse to the same canon form. */
export function canonicalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    const TRACKING = /^(utm_|fbclid|gclid|mc_|_ga|ref|source)/i
    const params = new URLSearchParams()
    for (const [k, v] of u.searchParams) {
      if (TRACKING.test(k)) continue
      params.append(k, v)
    }
    const qs = params.toString()
    const pathname = u.pathname.replace(/\/+$/, "")
    return `${u.hostname.toLowerCase()}${pathname}${qs ? "?" + qs : ""}`
  } catch {
    return url.toLowerCase().trim()
  }
}

/** Token-set Jaccard similarity over normalized title words. Cheap
 *  proxy for "do these two titles describe the same thing." */
export function titleSimilarity(a: string, b: string): number {
  const STOP = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "at",
    "in",
    "on",
    "of",
    "with",
    "for",
    "to",
  ])
  const tokens = (s: string) =>
    new Set(
      normalizeTitle(s)
        .split(/\s+/)
        .filter((t) => t.length > 1 && !STOP.has(t)),
    )
  const sa = tokens(a)
  const sb = tokens(b)
  if (sa.size === 0 || sb.size === 0) return 0
  let inter = 0
  for (const t of sa) if (sb.has(t)) inter += 1
  const union = sa.size + sb.size - inter
  return inter / union
}

// Canonical short-name table for Miami venues that have multiple
// public names. Maps "any variant in the array" → "the canonical
// short name we'll use as the dedup token." Order matters: we match
// longest-first so "adrienne arsht center" wins over "arsht center".
//
// Keep this list short and high-confidence. False positives here
// silently fold unrelated events together — only add a venue when
// both names are common in real listings.
const VENUE_CANON: ReadonlyArray<{ canon: string; variants: ReadonlyArray<string> }> = [
  { canon: "arsht", variants: ["adrienne arsht center", "adrienne arsht center for the performing arts", "arsht center"] },
  { canon: "pamm", variants: ["perez art museum miami", "perez art museum", "pamm"] },
  { canon: "frost-science", variants: ["phillip and patricia frost museum of science", "frost science museum", "frost science"] },
  { canon: "frost-art", variants: ["patricia and phillip frost art museum", "frost art museum"] },
  { canon: "vizcaya", variants: ["vizcaya museum and gardens", "vizcaya museum gardens", "vizcaya"] },
  { canon: "fairchild", variants: ["fairchild tropical botanic garden", "fairchild gardens", "fairchild"] },
  { canon: "deering", variants: ["deering estate at cutler", "deering estate"] },
  { canon: "historymiami", variants: ["historymiami museum", "history miami museum", "historymiami"] },
  { canon: "icamiami", variants: ["institute of contemporary art miami", "ica miami", "icamiami"] },
  { canon: "bass", variants: ["the bass museum", "bass museum of art", "the bass"] },
  { canon: "wolfsonian", variants: ["wolfsonian-fiu", "the wolfsonian", "wolfsonian fiu"] },
  { canon: "books-and-books", variants: ["books and books", "books books"] },
  { canon: "olympia-theater", variants: ["olympia theater at the gusman", "olympia theater", "gusman center"] },
  { canon: "kaseya", variants: ["kaseya center", "ftx arena", "miami-dade arena", "american airlines arena"] },
  { canon: "loandepot-park", variants: ["loandepot park", "marlins park"] },
  { canon: "hard-rock", variants: ["hard rock stadium", "hard rock"] },
  { canon: "miami-beach-convention", variants: ["miami beach convention center", "mbcc"] },
  { canon: "north-beach-bandshell", variants: ["north beach bandshell", "miami beach bandshell"] },
]

/** Normalized venue match — same lowercase + punctuation strip as
 *  the classifier uses, plus a small Miami-specific canonical-name
 *  table so "Adrienne Arsht Center" and "The Arsht Center" fold to
 *  the same key, etc. */
export function normalizeVenue(s: string | null | undefined): string {
  if (!s) return ""
  const cleaned = s
    .toLowerCase()
    .replace(/^the\s+/i, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!cleaned) return ""
  // Match longest variant first so "adrienne arsht center" beats "arsht center".
  for (const { canon, variants } of VENUE_CANON) {
    const sorted = [...variants].sort((a, b) => b.length - a.length)
    for (const v of sorted) {
      if (cleaned === v || cleaned.startsWith(v + " ") || cleaned.endsWith(" " + v) || cleaned.includes(" " + v + " ")) {
        return canon
      }
    }
  }
  return cleaned
}

/** Score two candidate events on dedup signals. 0..1; >=0.7 is
 *  treated as the same event by insertExtracted. */
export function similarityScore(
  a: {
    title: string
    startsAt: number
    locationName?: string | null
    url?: string | null
  },
  b: {
    title: string
    startsAt: number
    locationName?: string | null
    url?: string | null
  },
): number {
  // Same-canonical-URL is a strong solo signal — drop everything
  // else, this is the same listing.
  if (a.url && b.url && canonicalizeUrl(a.url) === canonicalizeUrl(b.url)) {
    return 1.0
  }
  let score = 0
  // Time proximity — same day required (caller queries by day
  // already), ±60min adds confidence.
  const dt = Math.abs(a.startsAt - b.startsAt)
  if (dt <= 60 * 60_000) score += 0.35
  else if (dt <= 4 * 60 * 60_000) score += 0.15
  // Venue match
  const va = normalizeVenue(a.locationName)
  const vb = normalizeVenue(b.locationName)
  if (va && vb && va === vb) score += 0.35
  // Title overlap
  score += 0.3 * titleSimilarity(a.title, b.title)
  return Math.min(score, 1)
}
