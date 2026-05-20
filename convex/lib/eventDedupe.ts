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
