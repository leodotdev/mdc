import { fetchReddit } from "./reddit"
import { fetchRss } from "./rss"
import { fetchWeb } from "./web"
import { fetchWikipediaOtd } from "./wikipediaOtd"
import { fetchX } from "./x"
import { fetchYouTube } from "./youtube"
import type { RawItem, SourceForAdapter } from "./types"

export type { RawItem, SourceForAdapter } from "./types"

export async function fetchItems(
  source: SourceForAdapter,
): Promise<Array<RawItem>> {
  switch (source.type) {
    case "rss":
      return await fetchRss(source)
    case "reddit":
      return await fetchReddit(source)
    case "youtube":
      return await fetchYouTube(source)
    case "x":
      return await fetchX(source)
    case "web":
      return await fetchWeb(source)
    case "wikipedia-otd":
      return await fetchWikipediaOtd(source)
  }
}
