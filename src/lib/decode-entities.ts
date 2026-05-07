// Decode HTML entities — named (&amp;, &quot;) + numeric (&#8217;,
// &#x2014;) that RSS feeds, web scrapes, and old database rows
// occasionally pass through undecoded. Idempotent on already-decoded
// strings.
//
// New ingests are already cleaned at fetch time in the RSS adapter
// (see convex/lib/adapters/rss.ts). This helper exists so render
// surfaces can defensively clean older data that landed before the
// adapter fix without needing a full database backfill.
export function decodeEntities(s: string | undefined | null): string {
  if (!s) return ""
  if (!s.includes("&")) return s
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
}
