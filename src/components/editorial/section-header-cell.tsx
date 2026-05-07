import { Link } from "@tanstack/react-router"

import { cn } from "@/lib/utils"

// THE section header. Used everywhere a block on the page needs a label
// — homepage section blocks (News, Business, Arts & Culture), Most Read,
// More Top Stories, the events page, the right-rail subsections, the
// dashboard activity blocks. Always: 3px accent rule on top, plain-case
// kicker below, optional right-side affordance (a `More →` link to a
// section, or any custom node).
//
// One pattern, used everywhere — so the page reads as a single paper.
// The `accent` prop tints both the rule and the kicker; pass the
// section's `accentColor` (or omit for default foreground).
export function SectionHeaderCell({
  title,
  subtitle,
  accent,
  moreHref,
  moreParams,
  right,
  className,
}: {
  title: React.ReactNode
  subtitle?: string
  accent?: string
  moreHref?: "/section/$slug"
  moreParams?: { slug: string }
  /** Custom right-side node (overrides moreHref + subtitle when set). */
  right?: React.ReactNode
  className?: string
}) {
  const accentColor = accent ?? "var(--foreground)"
  const rightSlot = right ? (
    right
  ) : moreHref && moreParams ? (
    <Link
      to={moreHref}
      params={moreParams}
      className="meta hover:underline"
    >
      More →
    </Link>
  ) : subtitle ? (
    <span className="meta">{subtitle}</span>
  ) : null
  return (
    <div className={cn("flex flex-col", className)}>
      <div
        aria-hidden
        className="h-[3px] w-full"
        style={{ background: accentColor }}
      />
      <div className="flex items-baseline justify-between py-2.5">
        <h2
          className="font-sans text-base font-semibold"
          style={{ color: accentColor }}
        >
          {title}
        </h2>
        {rightSlot}
      </div>
    </div>
  )
}
