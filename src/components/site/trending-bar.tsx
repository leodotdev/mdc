import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"

import { api } from "../../../convex/_generated/api"
import { useTranslation } from "@/lib/i18n/context"

// Tag-frequency cache: pull the latest 30 events, count how often each tag
// appears, and surface the top 6 as a horizontal "what's getting written
// about" strip — WaPo's Trending bar shape, populated from real editorial
// activity rather than a separate trending-topic query. Switched from
// articles.latest → events.latestEditorial as part of the events-only
// pivot (Phase 2).
const TRENDING_LIMIT = 6
const SCAN_LIMIT = 30

function humanize(tag: string): string {
  return tag.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function TrendingBar() {
  const { t } = useTranslation()
  const { data: latest } = useQuery(
    convexQuery(api.events.latestEditorial, { limit: SCAN_LIMIT }),
  )
  const trending = computeTrending(latest ?? [])

  if (trending.length === 0) {
    return <div className="h-9" aria-hidden />
  }

  return (
    <div className="flex h-9 items-center justify-center gap-x-4 overflow-x-auto whitespace-nowrap text-sm">
      <span className="shrink-0 font-sans text-sm font-bold text-foreground">
        {t("trending.label")}
      </span>
      <ul className="flex items-center gap-x-4">
        {trending.map((tag) => (
          <li key={tag}>
            <Link
              to="/tag/$slug"
              params={{ slug: tag }}
              className="font-sans text-sm text-foreground transition-colors hover:text-primary"
            >
              {humanize(tag)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function computeTrending(
  articles: ReadonlyArray<{ tags?: ReadonlyArray<string> }>,
): Array<string> {
  const counts = new Map<string, number>()
  for (const a of articles) {
    for (const tag of a.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, TRENDING_LIMIT)
    .map(([tag]) => tag)
}
