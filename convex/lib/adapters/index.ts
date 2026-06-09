import { fetchBrowserExtract } from "./browserExtract"
import { fetchEventsHtml } from "./eventsHtml"
import { fetchIcs } from "./ics"
import { fetchLlmExtract } from "./llmExtract"
import { fetchMiamiNewTimes } from "./miamiNewTimes"
import { fetchSitemapEvents } from "./sitemapEvents"
import type { RawItem, SourceForAdapter } from "./types"

export type { RawItem, SourceForAdapter, AdapterType } from "./types"

// Adapter dispatch. The old news/social adapters (rss, reddit, youtube,
// x, bluesky, web, wikipedia-otd, data) were removed with the
// events-only pivot — only calendar-shaped adapters remain. The
// `browser-extract` case routes through the headless-browser fetch
// path when configured (see #39); falls back to llm-extract semantics
// otherwise.
export async function fetchItems(
  source: SourceForAdapter,
): Promise<Array<RawItem>> {
  switch (source.type) {
    case "ics":
      return await fetchIcs(source)
    case "events-html":
      return await fetchEventsHtml(source)
    case "sitemap-events":
      return await fetchSitemapEvents(source)
    case "miami-new-times":
      return await fetchMiamiNewTimes(source)
    case "llm-extract":
      return await fetchLlmExtract(source)
    case "browser-extract":
      return await fetchBrowserExtract(source)
  }
}
