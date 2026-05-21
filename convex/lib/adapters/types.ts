export type RawItem = {
  externalId: string
  url: string
  title: string
  snippet?: string
  body?: string
  mediaUrl?: string
  publishedAt?: number
  /** RFC 5545 RRULE captured from iCal sources. Forwarded through to
   *  the events table at insert time so the renderer can show
   *  "Recurs weekly on Saturdays" instead of one row per occurrence.
   *  Adapters that don't have recurrence data leave it undefined. */
  recurrenceRule?: string
  // ── Structured event fields ──
  // Populated by adapters that ingest event-shaped sources (ICS,
  // events-html JSON-LD, sitemap-events). The deterministic ingest
  // pipeline uses these directly — no LLM rewrite needed. Adapters
  // that return news-shaped content (RSS, reddit, etc.) leave them
  // undefined and those items get skipped at ingest time.
  startsAt?: number
  endsAt?: number
  locationName?: string
  locationAddress?: string
  allDay?: boolean
  /** Free-text price label as it should render on the event card.
   *  Examples: "Free", "$15", "$15-25", "$25 / $20 members". Adapters
   *  format the source's structured offers data into a human-readable
   *  string so the renderer can show it verbatim. */
  price?: string
}

export type SourceForAdapter = {
  type:
    | "rss"
    | "reddit"
    | "youtube"
    | "x"
    | "bluesky"
    | "web"
    | "wikipedia-otd"
    | "ics"
    | "events-html"
    | "sitemap-events"
    | "miami-new-times"
    | "llm-extract"
    | "data"
  url: string
  config?: unknown
}
