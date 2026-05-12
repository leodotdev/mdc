import { fetchBluesky } from "./bluesky"
import { fetchEventsHtml } from "./eventsHtml"
import { fetchIcs } from "./ics"
import { fetchReddit } from "./reddit"
import { fetchRss } from "./rss"
import { fetchSitemapEvents } from "./sitemapEvents"
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
    case "bluesky":
      return await fetchBluesky(source)
    case "web":
      return await fetchWeb(source)
    case "wikipedia-otd":
      return await fetchWikipediaOtd(source)
    case "ics":
      return await fetchIcs(source)
    case "events-html":
      return await fetchEventsHtml(source)
    case "sitemap-events":
      return await fetchSitemapEvents(source)
    case "data":
      // `data` source rows are vestigial — they used to drive the
      // Miami in Numbers metrics catalog (deleted with the
      // events-only pivot). The mega-desk's source loop now skips
      // them upstream, so this branch should never be reached. Throw
      // loudly if it ever is, so the stray caller is visible in the
      // run log instead of silently failing.
      throw new Error(
        "`data` source type is retired — metrics were removed in the events-only pivot",
      )
  }
}
