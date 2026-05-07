export type RawItem = {
  externalId: string
  url: string
  title: string
  snippet?: string
  body?: string
  mediaUrl?: string
  publishedAt?: number
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
    | "data"
  url: string
  config?: unknown
}
