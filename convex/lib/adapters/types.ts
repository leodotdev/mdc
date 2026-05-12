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
    | "data"
  url: string
  config?: unknown
}
