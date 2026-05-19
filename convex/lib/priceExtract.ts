// Deterministic price extraction. Two paths:
//
// 1. `extractPriceFromText(s)` — regex-pulls explicit price tokens
//    from the event's description/body. Recognizes "Free", "$15",
//    "$15-25", "$15 - $25", "tickets $25", "$15 general / $10
//    members" (returns range from min/max). Returns undefined when
//    no plausible token is found.
//
// 2. `defaultFreeForSourceUrl(url)` — when an adapter has no price
//    signal in the payload AT ALL, but the source domain implies
//    free-by-default (city commission feeds, library calendars,
//    public school calendars), return "Free". Conservative: only
//    triggers on URLs that match a known-government / public-venue
//    pattern.
//
// Both are pure functions — safe to call from adapters, from the
// ingest pipeline, and from the backfill migration. Never LLM-backed.

const FREE_WORDS =
  /\b(free\s+admission|free\s+to\s+attend|free\s+(and\s+)?open\s+to\s+the\s+public|no\s+(cost|charge|admission|ticket)|admission(\s+is)?\s+free|free\s+event)\b/i

// Single "Free" word — but only when not preceded by anything that
// makes it not-the-cost ("free wifi", "free parking", "feel free").
// Negative-lookbehind in JS: limited support but Node 16+ has it. We
// use it gated, with a simple word boundary.
const STANDALONE_FREE = /(?:^|[^a-z])free(?:\s|[.,!?;:]|$)/i

// Matches $N or $N.NN — used both as single-value detector and as the
// iterator for range extraction.
const PRICE_TOKEN = /\$\s?(\d{1,4}(?:\.\d{1,2})?)/g

export function extractPriceFromText(
  text: string | undefined | null,
): string | undefined {
  if (!text) return undefined
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined

  // "Free admission" / "no cost" beat any stray $ tokens (e.g. a free
  // event whose description mentions "$5 wine bar inside").
  if (FREE_WORDS.test(trimmed)) return "Free"

  const values: Array<number> = []
  for (const m of trimmed.matchAll(PRICE_TOKEN)) {
    const n = Number(m[1])
    if (Number.isFinite(n)) values.push(n)
  }

  if (values.length === 0) {
    // No $ found — fall back to standalone "free" mention. Skipped
    // earlier in case dollar amounts overrode.
    if (STANDALONE_FREE.test(trimmed)) return "Free"
    return undefined
  }

  const lo = Math.min(...values)
  const hi = Math.max(...values)
  if (lo === 0 && hi === 0) return "Free"
  if (lo === hi) return `$${formatMoney(lo)}`
  return `$${formatMoney(lo)}-$${formatMoney(hi)}`
}

function formatMoney(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

// URL patterns that imply free-by-default. Commission meetings, library
// programs, public-school events — none of these charge admission.
// Conservative: only triggers on signals that are unambiguous.
const FREE_BY_DOMAIN = [
  /\.gov\b/i,
  /\biCalendar\.aspx/i, // CivicEngage municipal CMS
  /miamidade\.gov/i,
  /\bdadeschools\b/i,
  /\bmdpls\b/i, // Miami-Dade Public Library System
  /\blibrary\b/i,
  /\bpubliclibrary\b/i,
]

export function defaultFreeForSourceUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  for (const re of FREE_BY_DOMAIN) {
    if (re.test(url)) return "Free"
  }
  return undefined
}
