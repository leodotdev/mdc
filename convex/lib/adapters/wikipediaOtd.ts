import type { RawItem, SourceForAdapter } from "./types"

// Wikipedia "On this day" — pulls events, births, and deaths for today's
// calendar date in America/New_York (so it lines up with what locals call
// "today"). Each event becomes a RawItem; the agent's prompt does the Miami
// filtering and storytelling work.

type OtdConfig = {
  // Optional: pin to a specific MM/DD instead of "today" (useful for testing).
  forceDate?: string // "MM/DD"
  // Cap items returned per category. Default 12.
  perCategory?: number
}

type WikiPage = {
  title?: string
  extract?: string
  content_urls?: { desktop?: { page?: string } }
  thumbnail?: { source?: string }
}

type WikiEvent = {
  text?: string
  year?: number
  pages?: Array<WikiPage>
}

type WikiOtdResponse = {
  selected?: Array<WikiEvent>
  events?: Array<WikiEvent>
  births?: Array<WikiEvent>
  deaths?: Array<WikiEvent>
}

function todayInMiami(): { month: string; day: string } {
  const now = new Date()
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "2-digit",
    day: "2-digit",
  })
  const [month, day] = fmt.format(now).split("/")
  return { month, day }
}

function toRawItem(event: WikiEvent, kind: string, date: string): RawItem | null {
  const text = event.text?.trim()
  if (!text) return null
  const year = event.year
  const firstPage = event.pages?.[0]
  const url =
    firstPage?.content_urls?.desktop?.page ??
    "https://en.wikipedia.org/wiki/Main_Page"
  const externalId = `wikipedia:otd:${date}:${kind}:${year ?? ""}:${text.slice(0, 40)}`
  const title = year ? `${year} — ${text}` : text
  const body = [
    text,
    ...(event.pages ?? [])
      .map((p) => {
        const t = p.title ?? ""
        const ex = p.extract?.trim() ?? ""
        return ex ? `${t}: ${ex}` : ""
      })
      .filter(Boolean),
  ].join("\n\n")

  return {
    externalId,
    url,
    title,
    snippet: text.slice(0, 400),
    body,
    mediaUrl: firstPage?.thumbnail?.source,
    publishedAt: Date.now(),
  }
}

export async function fetchWikipediaOtd(
  source: SourceForAdapter,
): Promise<Array<RawItem>> {
  const cfg = (source.config as OtdConfig | undefined) ?? {}
  const perCategory = Math.min(cfg.perCategory ?? 12, 30)

  let month: string
  let day: string
  if (cfg.forceDate && /^\d{2}\/\d{2}$/.test(cfg.forceDate)) {
    ;[month, day] = cfg.forceDate.split("/")
  } else {
    ;({ month, day } = todayInMiami())
  }

  const apiUrl = `https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/all/${month}/${day}`
  const res = await fetch(apiUrl, {
    headers: {
      "user-agent":
        "miami.community/1.0 (+https://miami.community; tips@miami.community)",
      accept: "application/json",
    },
  })
  if (!res.ok) {
    throw new Error(`Wikipedia OTD ${month}/${day} → ${res.status}`)
  }
  const json = (await res.json()) as WikiOtdResponse

  const date = `${month}-${day}`
  const items: Array<RawItem> = []

  // Selected (curated/featured) carries the most weight; lead with it.
  for (const e of (json.selected ?? []).slice(0, perCategory)) {
    const item = toRawItem(e, "selected", date)
    if (item) items.push(item)
  }
  for (const e of (json.events ?? []).slice(0, perCategory)) {
    const item = toRawItem(e, "events", date)
    if (item) items.push(item)
  }
  for (const e of (json.births ?? []).slice(0, perCategory)) {
    const item = toRawItem(e, "births", date)
    if (item) items.push(item)
  }
  for (const e of (json.deaths ?? []).slice(0, perCategory)) {
    const item = toRawItem(e, "deaths", date)
    if (item) items.push(item)
  }

  return items
}
