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
  type: "rss" | "reddit" | "youtube" | "x" | "web" | "wikipedia-otd"
  url: string
  config?: unknown
}
