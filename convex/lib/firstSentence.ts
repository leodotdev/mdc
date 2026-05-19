// Trim a free-form blurb down to its first sentence. Used to derive
// a concise `dek` from a source's description / body / snippet — the
// deterministic ingest pipeline doesn't carry multi-sentence
// descriptions any more, just a 1-sentence dek per event.
//
// Greedy first-sentence detector: matches up to and including the
// first . ! or ?. Returns the original string when no terminator is
// found, then caps at 200 chars (with ellipsis) so a single run-on
// sentence still fits the slot.

const SENTENCE_END = /^[^.!?]*[.!?]/

export function firstSentence(text: string | undefined | null): string | undefined {
  if (!text) return undefined
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  const m = trimmed.match(SENTENCE_END)
  const first = (m ? m[0] : trimmed).trim()
  if (first.length <= 200) return first
  // Hard cap at 200 chars; trim back to the previous word boundary so
  // we don't hyphenate or split mid-word, then append the ellipsis.
  const capped = first.slice(0, 200)
  const lastSpace = capped.lastIndexOf(" ")
  return (lastSpace > 100 ? capped.slice(0, lastSpace) : capped).trimEnd() + "…"
}
