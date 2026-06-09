// Convert SHOUTING / RAW-CMS-TITLE strings into editorial title case.
// Adapter-fed titles are notoriously inconsistent — some venues stamp
// every event in ALL CAPS (Eventbrite organizers love it), some use
// lowercase, some use the page's HTML title format. We normalize to
// AP-ish title case at ingest so the front page reads as one
// publication, not a syndicated mess.
//
// Rules:
//   - The first and last word are always capitalized.
//   - Small connecting words (a, an, the, of, in, on, …) stay
//     lowercase in the middle of the title.
//   - Recognized acronyms (MIA, FIU, NYC, …) stay all-caps.
//   - Mc/Mac names get the inner letter capitalized (McDonald's).
//   - Apostrophe contractions like "'s" / "'re" stay lowercase.
//   - Mixed-case originals are left alone — only fully-uppercase
//     strings get rewritten, so we don't fight intentional casing
//     like "iPhone Tour" or "BMGA May Tournament".

const SMALL_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "if",
  "in",
  "is",
  "nor",
  "of",
  "on",
  "or",
  "so",
  "the",
  "to",
  "up",
  "vs",
  "via",
  "with",
  "from",
])

// Curated set of acronyms we want preserved as ALL-CAPS through the
// rewrite. Keep tight to avoid false positives — adding common words
// here would mis-cap them.
const ACRONYMS = new Set([
  "AI",
  "AM",
  "PM",
  "ATM",
  "BBQ",
  "BMGA",
  "BYOB",
  "CDC",
  "CES",
  "CEO",
  "CFO",
  "CTO",
  "CIA",
  "DIY",
  "DJ",
  "EDM",
  "ER",
  "ESPN",
  "FBI",
  "FCLE",
  "FIFA",
  "FIU",
  "FL",
  "FTCE",
  "GMAT",
  "GRE",
  "HBO",
  "HIV",
  "II",
  "III",
  "IPO",
  "IRL",
  "IV",
  "JD",
  "JFK",
  "LATAM",
  "LGBTQ",
  "LLM",
  "LSAT",
  "MBA",
  "MCAT",
  "MD",
  "MDC",
  "MFA",
  "MIA",
  "MIT",
  "MLB",
  "MLS",
  "MOAD",
  "MOCA",
  "MOMA",
  "NBA",
  "NBC",
  "NCAA",
  "NFL",
  "NFT",
  "NHL",
  "NPR",
  "NWS",
  "NYC",
  "NYE",
  "PAMM",
  "PD",
  "PG",
  "PGA",
  "PhD",
  "RSVP",
  "SAT",
  "SXSW",
  "TBA",
  "TBD",
  "TED",
  "TV",
  "UFC",
  "UM",
  "USA",
  "USPS",
  "UX",
  "UI",
  "VIP",
  "VR",
  "AR",
  "XR",
  "WWE",
  "YMCA",
  "YWCA",
])

const APOSTROPHE_TAILS = new Set([
  "s",
  "d",
  "ll",
  "re",
  "ve",
  "t",
  "m",
  "n",
])

/** Is this title's letter content fully uppercase? */
export function isAllCaps(s: string): boolean {
  const letters = s.replace(/[^A-Za-z]/g, "")
  if (letters.length < 4) return false
  return letters === letters.toUpperCase()
}

/** True when the title reads as SHOUTING even if a few lowercase
 *  fragments leaked in (parentheticals, URL fragments, etc.).
 *  Heuristic: 2+ words that are 3+ alphabetic chars, fully
 *  uppercase, and not in the curated ACRONYMS allow-list. Catches
 *  cases like "POUR NOW, PAY LATER #2 (free Heineken)". */
export function isShouty(s: string): boolean {
  if (isAllCaps(s)) return true
  const words = s.split(/[\s,/.!?:;()[\]{}"'-]+/).filter(Boolean)
  let shoutyCount = 0
  for (const w of words) {
    const stripped = w.replace(/[^A-Za-z]/g, "")
    if (stripped.length < 3) continue
    if (stripped !== stripped.toUpperCase()) continue
    if (ACRONYMS.has(stripped)) continue
    shoutyCount += 1
    if (shoutyCount >= 2) return true
  }
  return false
}

/** Capitalize a single token, preserving inner apostrophes / hyphens. */
function capitalizeWord(word: string): string {
  if (word.length === 0) return word
  // Handle the inner-apostrophe tail: "miami's" → "Miami's", not
  // "Miami'S". Split on the first apostrophe; capitalize the head,
  // keep the tail lowercase when it looks like a contraction.
  const apostropheIdx = word.indexOf("'")
  if (apostropheIdx > 0) {
    const head = word.slice(0, apostropheIdx)
    const tail = word.slice(apostropheIdx + 1)
    if (APOSTROPHE_TAILS.has(tail.toLowerCase())) {
      return capitalizeWord(head) + "'" + tail.toLowerCase()
    }
    // Tail isn't a contraction (e.g. "rock'n'roll") — capitalize each
    // sub-segment recursively.
    return word
      .split("'")
      .map((part) => capitalizeWord(part))
      .join("'")
  }
  // Hyphenated: capitalize each segment ("mid-town" → "Mid-Town").
  if (word.includes("-")) {
    return word
      .split("-")
      .map((part) => capitalizeWord(part))
      .join("-")
  }
  // Mc/Mac names: "mcdonald" → "McDonald", "macarthur" → "MacArthur".
  if (/^(mc|mac)[a-z]+/i.test(word)) {
    const prefixLen = word.toLowerCase().startsWith("mac") ? 3 : 2
    const prefix = word.slice(0, prefixLen).toLowerCase()
    const rest = word.slice(prefixLen).toLowerCase()
    return (
      prefix[0].toUpperCase() +
      prefix.slice(1) +
      rest[0].toUpperCase() +
      rest.slice(1)
    )
  }
  return word[0].toUpperCase() + word.slice(1).toLowerCase()
}

/** Convert a string to editorial title case. */
export function toTitleCase(input: string): string {
  // Split on whitespace but keep the separators so we can rejoin
  // without collapsing multi-space runs into one.
  const parts = input.split(/(\s+)/)
  // Index of the first/last *word* parts (skipping whitespace).
  const wordIndices: Array<number> = []
  for (let i = 0; i < parts.length; i += 1) {
    if (!/^\s+$/.test(parts[i]) && parts[i].length > 0) wordIndices.push(i)
  }
  const firstWord = wordIndices[0] ?? -1
  const lastWord = wordIndices[wordIndices.length - 1] ?? -1
  return parts
    .map((tok, i) => {
      if (/^\s+$/.test(tok) || tok.length === 0) return tok
      // Acronym match — leave it shouting. Strip a trailing
      // punctuation so "FIU." still hits.
      const tokenStripped = tok.replace(/[^A-Za-z0-9]+$/g, "")
      const tail = tok.slice(tokenStripped.length)
      if (ACRONYMS.has(tokenStripped.toUpperCase())) {
        return tokenStripped.toUpperCase() + tail
      }
      // Pure-digit token (year, number) — leave alone.
      if (/^\d+$/.test(tokenStripped)) return tok
      const lower = tokenStripped.toLowerCase()
      // Always cap the first / last word, even if it's in
      // SMALL_WORDS — "The" / "Up" at the start should stay capped.
      if (i !== firstWord && i !== lastWord && SMALL_WORDS.has(lower)) {
        return lower + tail
      }
      // Strip wrapping punctuation we don't want to count as letters
      // (e.g. quotes) so leading-quote titles still cap the first
      // *letter*. Apply capitalize then re-attach.
      const leadMatch = tokenStripped.match(/^[^A-Za-z0-9]*/)
      const leadPunct = leadMatch ? leadMatch[0] : ""
      const core = tokenStripped.slice(leadPunct.length)
      return leadPunct + capitalizeWord(core) + tail
    })
    .join("")
    // Collapse the common "Miami Swim Week®" / trailing-symbol garbage
    // is left as-is; this regex only normalizes multiple spaces that
    // can leak in from CMS-mangled titles.
    .replace(/[ \t]+/g, " ")
    .trim()
}

/** If the title is shouting, rewrite to title case. Otherwise return
 *  the original verbatim — we never touch intentionally-cased copy. */
export function maybeTitleCase(input: string): string {
  if (!input) return input
  if (isShouty(input)) return toTitleCase(input)
  return input
}
