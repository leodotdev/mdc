import { XMLParser } from "fast-xml-parser"
import type { RawItem, SourceForAdapter } from "./types"

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
})

function pickString(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>
    if (typeof v["#text"] === "string") return v["#text"]
    if (typeof v["@_href"] === "string") return v["@_href"]
  }
  return undefined
}

function parseDate(value: unknown): number | undefined {
  const s = pickString(value)
  if (!s) return undefined
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : undefined
}

function stripHtml(s: string | undefined): string | undefined {
  if (!s) return undefined
  return decodeEntities(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
}

// Decode HTML entities (named + numeric) that fast-xml-parser passes
// through inside CDATA sections. Without this, RSS titles like
// "April &#8217;26" land in the database as literal `&#8217;` and
// render that way in citations and source lists.
function decodeEntities(s: string): string {
  if (!s.includes("&")) return s
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
}


function findEnclosure(item: Record<string, unknown>): string | undefined {
  const enc = item.enclosure as Record<string, unknown> | undefined
  if (enc && typeof enc["@_url"] === "string") return enc["@_url"]
  const media = item["media:content"] as Record<string, unknown> | undefined
  if (media && typeof media["@_url"] === "string") return media["@_url"]
  const thumb = item["media:thumbnail"] as Record<string, unknown> | undefined
  if (thumb && typeof thumb["@_url"] === "string") return thumb["@_url"]
  return undefined
}

export async function fetchRss(source: SourceForAdapter): Promise<Array<RawItem>> {
  const res = await fetch(source.url, {
    headers: { "user-agent": "miami.community/1.0 (+https://miami.community)" },
  })
  if (!res.ok) {
    throw new Error(`RSS ${source.url} → ${res.status}`)
  }
  const xml = await res.text()
  const parsed = parser.parse(xml) as Record<string, unknown>

  // RSS 2.0 → rss.channel.item[]
  // Atom → feed.entry[]
  const channel = (parsed.rss as Record<string, unknown> | undefined)?.channel as
    | Record<string, unknown>
    | undefined
  if (channel && channel.item) {
    const items = Array.isArray(channel.item) ? channel.item : [channel.item]
    return items.map((raw): RawItem => {
      const item = raw as Record<string, unknown>
      const url = pickString(item.link) ?? ""
      const guid = pickString(item.guid) ?? url
      const title = decodeEntities(pickString(item.title) ?? "(untitled)")
      const description = stripHtml(pickString(item.description))
      const content = stripHtml(pickString(item["content:encoded"]))
      return {
        externalId: guid,
        url,
        title,
        snippet: description?.slice(0, 400),
        body: content,
        mediaUrl: findEnclosure(item),
        publishedAt: parseDate(item.pubDate ?? item["dc:date"]),
      }
    })
  }

  const feed = parsed.feed as Record<string, unknown> | undefined
  if (feed && feed.entry) {
    const entries = Array.isArray(feed.entry) ? feed.entry : [feed.entry]
    return entries.map((raw): RawItem => {
      const entry = raw as Record<string, unknown>
      const linkRaw = entry.link
      let url = ""
      if (Array.isArray(linkRaw)) {
        const alt = linkRaw.find(
          (l) =>
            typeof l === "object" &&
            l !== null &&
            ((l as Record<string, unknown>)["@_rel"] === "alternate" ||
              !(l as Record<string, unknown>)["@_rel"]),
        )
        url = pickString(alt) ?? ""
      } else {
        url = pickString(linkRaw) ?? ""
      }
      const id = pickString(entry.id) ?? url
      return {
        externalId: id,
        url,
        title: decodeEntities(pickString(entry.title) ?? "(untitled)"),
        snippet: stripHtml(pickString(entry.summary))?.slice(0, 400),
        body: stripHtml(pickString(entry.content)),
        publishedAt: parseDate(entry.published ?? entry.updated),
      }
    })
  }

  return []
}
