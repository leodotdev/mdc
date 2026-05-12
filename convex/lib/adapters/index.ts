import { fetchBluesky } from "./bluesky"
import { fetchEventsHtml } from "./eventsHtml"
import { fetchIcs } from "./ics"
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
    case "data":
      // Data sources are routed through `convex/lib/dataAdapters.ts`
      // before they reach this dispatcher — they never produce
      // RawItems. Reaching this branch means the caller forgot the
      // upstream branch.
      throw new Error(
        "Data sources must be routed via fetchDataMetrics, not fetchItems",
      )
  }
}
