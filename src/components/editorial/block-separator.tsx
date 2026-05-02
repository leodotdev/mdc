import { cn } from "@/lib/utils"

// The dark `border-t border-foreground pt-10` separator the homepage
// uses between major page blocks (above-fold → widgets → most read →
// each section block). Wrapped here so child pages don't redefine the
// constant in every file. Can be tinted by passing `accent`.
export const BLOCK_CLASS = "border-t border-foreground pt-10"

export function BlockSeparator({
  accent,
  children,
  className,
  as: Component = "section",
}: {
  /** Optional CSS color value (e.g. section.accentColor) used for the
   *  top border instead of the default foreground. Hairline-only — we
   *  don't tint the page background. */
  accent?: string
  children?: React.ReactNode
  className?: string
  as?: "section" | "div" | "aside"
}) {
  return (
    <Component
      className={cn(BLOCK_CLASS, className)}
      style={accent ? { borderTopColor: accent } : undefined}
    >
      {children}
    </Component>
  )
}
