import { fetchRss } from "./rss"
import type { RawItem, SourceForAdapter } from "./types"

// X / Twitter: best-effort via RSSHub.
// Public RSSHub instances rate-limit and break frequently.
// `source.url` is the X handle, e.g. "MiamiHerald" or "@MiamiHerald".
// `source.config.rsshubBase` overrides the default instance.

type XConfig = { rsshubBase?: string }

export async function fetchX(source: SourceForAdapter): Promise<Array<RawItem>> {
  const cfg = (source.config as XConfig | undefined) ?? {}
  const base = cfg.rsshubBase ?? "https://rsshub.app"
  const handle = source.url
    .replace(/^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\//, "")
    .replace(/^@/, "")
    .replace(/\/$/, "")
  if (!handle) throw new Error(`X source URL is empty`)
  const rssUrl = `${base.replace(/\/$/, "")}/twitter/user/${handle}`
  return await fetchRss({ ...source, type: "rss", url: rssUrl })
}
