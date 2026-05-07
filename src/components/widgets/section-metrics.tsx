import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"

import { api } from "../../../convex/_generated/api"
import { SectionHeaderCell } from "@/components/editorial/section-header-cell"
import { MetricCard } from "@/components/widgets/metric-card"

// Per-section metric block — surfaces metrics whose
// `relatedSectionSlugs` includes this section. Stacked rather than
// carousel'd because each section typically has fewer metrics than
// the homepage and a stack reads as "this section's running
// numbers" instead of rotation.
//
// Hidden entirely when the section has no metrics yet — better empty
// than a card with a stale placeholder.
export function SectionMetrics({
  sectionSlug,
  accent,
  limit = 3,
}: {
  sectionSlug: string
  accent?: string
  limit?: number
}) {
  const { data: metrics } = useQuery(
    convexQuery(api.metrics.list, { sectionSlug, limit }),
  )
  if (!metrics || metrics.length === 0) return null
  return (
    <div>
      <SectionHeaderCell title="By the numbers" accent={accent} />
      <div className="mt-3 flex flex-col gap-3">
        {metrics.map((m) => (
          <MetricCard key={m._id as string} metric={m} variant="widget" />
        ))}
      </div>
    </div>
  )
}
