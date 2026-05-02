import { importanceScore } from "../../../convex/lib/scoring"

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
