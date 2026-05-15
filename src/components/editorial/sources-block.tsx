import { ExternalLink } from "lucide-react"

import type { Citation } from "@/lib/article-types"
import { formatLongDate } from "@/lib/dates"
import { decodeEntities } from "@/lib/decode-entities"

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

// Sources rendered as a plain bulleted list — one row per citation,
// publisher + title + fetched date. Keeps the event page text-forward;
// the cited URLs are the load-bearing detail, not the layout.
export function SourcesBlock({ citations }: { citations: Array<Citation> }) {
  if (!citations || citations.length === 0) return null

  return (
    <aside className="mx-auto mt-16 max-w-3xl">
      <h2 className="kicker mb-4">Sources</h2>
      <ul className="flex flex-col divide-y divide-foreground/10 border-y border-foreground/10">
        {citations.map((c, i) => (
          <li key={`${c.url}-${i}`}>
            <a
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group/source flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3 transition-colors hover:bg-muted/40"
            >
              <span className="kicker shrink-0 text-xs text-muted-foreground">
                {c.publisher ?? hostname(c.url)}
              </span>
              <span className="font-sans flex-1 text-sm text-foreground group-hover/source:underline">
                {decodeEntities(c.title)}
                <ExternalLink
                  aria-hidden
                  className="ml-1 inline size-3 -translate-y-px text-muted-foreground"
                />
              </span>
              <span className="meta shrink-0 text-xs tabular-nums">
                {formatLongDate(c.fetchedAt)}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </aside>
  )
}
