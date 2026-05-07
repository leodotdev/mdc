import {
  eventImportanceScore,
  importanceScore,
} from "../../../convex/lib/scoring"

// Plain importance score for admin tables — the same number that
// drives `topStories` / above-the-fold ranking on the public site.
// `accent` is accepted for API compatibility with earlier table calls
// but no longer rendered (the bar was dropped in favor of just the
// number). Hover to see the breadth/depth breakdown.
type Article = Parameters<typeof importanceScore>[0] & {
  publishedAt?: number
  createdAt: number
}

export function ImportanceGauge({
  article,
  accent: _accent,
  className,
}: {
  article: Article
  /** Kept for API compatibility — no longer rendered. */
  accent?: string
  className?: string
}) {
  const score = importanceScore(article, Date.now())
  return (
    <span
      className={`font-mono text-xs tabular-nums text-foreground ${className ?? ""}`}
      title={`Importance ${score.toFixed(1)} — breadth ${article.derivedFromItems.length} sources · depth ${article.citations.length} citations · recency-decayed`}
    >
      {score.toFixed(1)}
    </span>
  )
}

// Same renderer for events — time-to-event-weighted score with depth +
// hero-presence boosts. Hover tooltip explains the inputs.
export function EventImportanceGauge({
  event,
  className,
}: {
  event: Parameters<typeof eventImportanceScore>[0]
  className?: string
}) {
  const score = eventImportanceScore(event, Date.now())
  const deltaHours = Math.round(
    (event.startsAt - Date.now()) / 3_600_000,
  )
  const when =
    deltaHours < 0
      ? `${Math.abs(deltaHours)}h ago`
      : deltaHours < 48
        ? `in ${deltaHours}h`
        : `in ${Math.round(deltaHours / 24)}d`
  return (
    <span
      className={`font-mono text-xs tabular-nums text-foreground ${className ?? ""}`}
      title={`Importance ${score.toFixed(1)} — ${when}, depth ${event.citations?.length ?? 0} citations${event.heroImage || event.imageUrl ? ", hero" : ""}`}
    >
      {score.toFixed(1)}
    </span>
  )
}
