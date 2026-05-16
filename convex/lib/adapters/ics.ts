import type { RawItem, SourceForAdapter } from "./types"

// iCalendar (.ics) feed adapter. Targets RFC 5545 calendars served by
// venues, parks, museums, BIDs, and city departments. The feed itself
// is a flat text file — no auth, no API key — so a single new source
// type unlocks dozens of public Miami calendars at once.
//
// Scope (deliberately narrow for v1):
// - Parses VEVENT blocks: UID / SUMMARY / DESCRIPTION / LOCATION / URL
//   / DTSTART. Skips everything else (VTODO, VTIMEZONE, RRULE expansion,
//   alarms, attendees) — the desk's LLM gets enough from the title +
//   description + start time to draft an event item.
// - Treats TZID-tagged or floating datetimes as already-UTC. Real Miami
//   calendars publish in America/New_York; the resulting publishedAt
//   will be off by 4-5 hours, but the events extractor re-derives the
//   canonical start time from the source page (or the calendar's own
//   description), so this is only used for "is this event still
//   upcoming" filtering. The 24h grace below absorbs the offset.
// - Drops events whose start was more than 24h ago, so the ingest
//   pile doesn't fill with last-month's recurring meetings.

type IcsConfig = { max?: number }

export async function fetchIcs(
  source: SourceForAdapter,
): Promise<Array<RawItem>> {
  const res = await fetch(source.url, {
    headers: { Accept: "text/calendar, text/plain;q=0.8, */*;q=0.5" },
  })
  if (!res.ok) throw new Error(`ICS ${source.url} → ${res.status}`)
  const text = await res.text()

  // RFC 5545 line folding: a line continues when the next line starts
  // with a single space or tab. Unfold first so per-property regexes
  // match the whole value.
  const unfolded = text.replace(/\r?\n[ \t]/g, "")

  const cfg = (source.config as IcsConfig | undefined) ?? {}
  const max = Math.min(cfg.max ?? 30, 100)
  const cutoff = Date.now() - 24 * 3_600_000

  const events: Array<RawItem> = []
  const blocks = unfolded.split(/BEGIN:VEVENT/i).slice(1)
  for (const block of blocks) {
    const end = block.search(/END:VEVENT/i)
    if (end < 0) continue
    const body = block.slice(0, end)

    const uid = readProp(body, "UID")
    const summary = readProp(body, "SUMMARY")
    if (!uid || !summary) continue

    const description = readProp(body, "DESCRIPTION")
    const location = readProp(body, "LOCATION")
    const url = readProp(body, "URL")
    const dtRaw = readPropLine(body, "DTSTART")
    const startMs = dtRaw ? parseIcsDate(dtRaw) : undefined
    const dtEndRaw = readPropLine(body, "DTEND")
    const endMs = dtEndRaw ? parseIcsDate(dtEndRaw) : undefined
    // All-day events have DATE-only DTSTART (no T component).
    const allDay = dtRaw ? !dtRaw.includes("T") : undefined
    // RRULE value — strip the property name prefix. When present, the
    // event is recurring and we skip the cutoff check (a recurring
    // VEVENT can have a DTSTART in the past while remaining current).
    const rrule = readProp(body, "RRULE")

    if (!rrule && startMs != null && startMs < cutoff) continue

    const composedBody = [
      description,
      location ? `Location: ${location}` : null,
    ]
      .filter(Boolean)
      .join("\n\n")

    events.push({
      externalId: `ics_${uid}`,
      url: url ?? source.url,
      title: summary,
      snippet: description?.slice(0, 400),
      body: composedBody || undefined,
      publishedAt: startMs,
      recurrenceRule: rrule,
      // Structured event fields — used by the deterministic ingest
      // pipeline. iCal already carries the canonical start/end/venue,
      // so we forward them verbatim instead of leaning on the LLM
      // to re-derive them from the text body.
      startsAt: startMs,
      endsAt: endMs,
      locationName: location,
      allDay,
    })
  }

  events.sort((a, b) => (a.publishedAt ?? 0) - (b.publishedAt ?? 0))
  return events.slice(0, max)
}

// Read a property value, stripping any `;PARAM=...` between the name and
// the colon. Returns the unescaped string, or undefined when absent.
function readProp(block: string, name: string): string | undefined {
  const re = new RegExp(`(?:^|\\n)${name}(?:;[^:\\n]*)?:([^\\n]*)`, "i")
  const m = block.match(re)
  if (!m) return undefined
  return unescape(m[1].trim())
}

// Read the *full* property line (with parameters) — needed for DTSTART
// because the TZID / VALUE=DATE parameters change how the value is parsed.
function readPropLine(block: string, name: string): string | undefined {
  const re = new RegExp(`(?:^|\\n)(${name}(?:;[^:\\n]*)?:[^\\n]*)`, "i")
  const m = block.match(re)
  return m?.[1]
}

function unescape(v: string): string {
  return v
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
}

// Parse a DTSTART line into epoch ms. Handles three shapes:
//   DTSTART;VALUE=DATE:YYYYMMDD                  (all-day)
//   DTSTART:YYYYMMDDTHHMMSSZ                     (UTC)
//   DTSTART;TZID=...:YYYYMMDDTHHMMSS             (zoned, treated as UTC)
function parseIcsDate(line: string): number | undefined {
  const colon = line.indexOf(":")
  if (colon < 0) return undefined
  const params = line.slice(0, colon).toUpperCase()
  const value = line.slice(colon + 1).trim()

  if (params.includes("VALUE=DATE")) {
    const m = value.match(/^(\d{4})(\d{2})(\d{2})$/)
    if (!m) return undefined
    return Date.UTC(+m[1], +m[2] - 1, +m[3])
  }

  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/)
  if (!m) return undefined
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
}
