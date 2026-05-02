import { SectionHeaderCell } from "./section-header-cell"
import { cn } from "@/lib/utils"

// Right-side rail wrapper used on article / section / tag / author /
// events pages. Sticks to the top of the viewport on desktop so the
// reader always has somewhere to go mid-read.
//
// Layout pairing: drop inside a `lg:grid-cols-12` parent and pass
// `lg:col-span-3` via `className` (main column gets `lg:col-span-9`).
// That 9/3 split lands the rail at ~25% of the container — matching
// WaPo's hp-rail proportion. Earlier 8/4 left the rail too wide.
// Mobile collapses to a top-bordered block below the main content.
export function SidebarRail({
  className,
  sticky = true,
  children,
}: {
  className?: string
  /** Whether the rail position-sticks on lg+. Default true. */
  sticky?: boolean
  children: React.ReactNode
}) {
  return (
    <aside
      className={cn(
        "mt-10 border-t border-foreground pt-6 lg:mt-0 lg:border-t-0 lg:border-l lg:border-foreground/15 lg:pt-0 lg:pl-6",
        sticky && "lg:sticky lg:top-24 lg:self-start",
        className,
      )}
    >
      <div className="space-y-8">{children}</div>
    </aside>
  )
}

// Section header inside a rail — uses the canonical SectionHeaderCell
// so rail blocks visually match every other section header on the page
// (homepage News / Business, Most Read, the events page, etc.).
export function SidebarRailSection({
  title,
  accent,
  more,
  children,
}: {
  title: string
  /** Optional accent color for the rule + kicker. */
  accent?: string
  /** Optional anchor element rendered on the right of the header. */
  more?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section>
      <SectionHeaderCell
        title={title}
        accent={accent}
        right={more}
        className="mb-4"
      />
      {children}
    </section>
  )
}
