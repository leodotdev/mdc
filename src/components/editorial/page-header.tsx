import { cn } from "@/lib/utils"

// Page-level header used by every child page (section, tag, author,
// events, search, about, 404). Standardizes the kicker → display-xl →
// dek pattern that's been hand-rolled differently across each route.
//
// The right slot is for view toggles, nav arrows, etc. — anything that
// needs to sit baseline-aligned with the page heading.
export function PageHeader({
  kicker,
  kickerColor,
  title,
  dek,
  right,
  ruleBottom = true,
  className,
}: {
  kicker?: string
  /** Section accent or other CSS color value. Defaults to foreground. */
  kickerColor?: string
  title: React.ReactNode
  dek?: React.ReactNode
  right?: React.ReactNode
  /** Renders the bottom hairline rule (`rule-bottom` class). Default true. */
  ruleBottom?: boolean
  className?: string
}) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-end justify-between gap-3 pb-6",
        ruleBottom && "rule-bottom",
        className,
      )}
    >
      <div className="min-w-0">
        {kicker ? (
          <p className="kicker" style={{ color: kickerColor }}>
            {kicker}
          </p>
        ) : null}
        <h1 className="display-xl mt-2 text-balance">{title}</h1>
        {dek ? (
          <p className="font-editorial mt-3 max-w-prose text-base text-pretty text-muted-foreground">
            {dek}
          </p>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </header>
  )
}
