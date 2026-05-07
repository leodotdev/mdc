import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"

import { api } from "../../../convex/_generated/api"
import { SectionHeaderCell } from "@/components/editorial/section-header-cell"
import { MetricCard } from "@/components/widgets/metric-card"

// "Miami in numbers" — full-width grid of metrics rendered in the
// main column, below the day's top news. Replaces the right-rail
// carousel: metrics get their own block where the reader can see
// the whole catalog at a glance instead of one rotating slide.
//
// Hidden until at least MIN_VISIBLE metrics exist so the section
// doesn't read as half-built on day 1.

const MIN_VISIBLE = 3

export function MetricsGrid({
  className,
  limit = 12,
}: {
  className?: string
  limit?: number
}) {
  const { data: metrics } = useQuery(
    convexQuery(api.metrics.list, { limit }),
  )
  if (!metrics || metrics.length < MIN_VISIBLE) return null
  return (
    <section className={className}>
      <SectionHeaderCell
        title="Miami in numbers"
        subtitle={`${metrics.length} stat${metrics.length === 1 ? "" : "s"}, drawn from cited reporting`}
        className="mb-6"
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {metrics.map((m) => (
          <MetricCard key={m._id as string} metric={m} variant="widget" />
        ))}
      </div>
    </section>
  )
}
