import { useNavigate } from "@tanstack/react-router"
import { cn } from "@/lib/utils"

// Mission-control card. Visual model mirrors a finance dashboard tile:
// header (title + optional subtitle) → primary metric (big number) →
// supporting content slot → optional full-width pill action button at
// the foot. Each block is optional, so a card can be as simple as
// "title + number" or as rich as "title + subtitle + breakdown sub-cells
// + sparkline + action".
//
// Click target is the full card by default; pass `actionLabel` to
// render a bottom pill button that takes the click instead — same
// destination, more visual weight.

type CardTone = "default" | "warning" | "ok"

type DashboardCardProps = {
  title: string
  /** Subtitle / one-line description under the title. */
  subtitle?: string
  primary?: string | number
  primarySub?: string
  /** Subline rendered under the primary value, before the slot. */
  subtext?: React.ReactNode
  /** Click target — anywhere on the card navigates here when set. */
  to?: string
  /** Bottom pill action button — renders full-width when set. */
  actionLabel?: string
  tone?: CardTone
  /** Free-form middle slot — sparkline, progress bar, sub-cells. */
  children?: React.ReactNode
  /** Renders to the right of the title, e.g. an icon or close button. */
  rightAccessory?: React.ReactNode
  className?: string
}

export function DashboardCard({
  title,
  subtitle,
  primary,
  primarySub,
  subtext,
  to,
  actionLabel,
  tone = "default",
  children,
  rightAccessory,
  className,
}: DashboardCardProps) {
  const navigate = useNavigate()
  const toneClass =
    tone === "warning"
      ? "border-destructive/40"
      : tone === "ok"
        ? "border-foreground/15"
        : "border-foreground/10"
  const handleClick = to
    ? () => {
        // `as never` sidesteps TanStack's strict typed-route union —
        // every caller passes a registered admin path so this lands
        // cleanly at runtime.
        void navigate({ to: to as never })
      }
    : undefined
  const cardClickable = to && !actionLabel
  return (
    <div
      className={cn(
        "group/card flex flex-col rounded-xl border bg-card p-5 transition-colors",
        toneClass,
        cardClickable ? "cursor-pointer hover:bg-muted/30" : "",
        className,
      )}
      role={cardClickable ? "button" : undefined}
      tabIndex={cardClickable ? 0 : undefined}
      onClick={cardClickable ? handleClick : undefined}
      onKeyDown={
        cardClickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                handleClick?.()
              }
            }
          : undefined
      }
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-sans text-[0.95rem] font-semibold leading-tight">
            {title}
          </h3>
          {subtitle ? (
            <p className="meta mt-0.5 text-xs leading-snug">{subtitle}</p>
          ) : null}
        </div>
        {rightAccessory ? (
          <div className="text-muted-foreground">{rightAccessory}</div>
        ) : null}
      </div>

      {/* Primary metric */}
      {primary !== undefined ? (
        <div className="mt-4 flex items-baseline gap-2">
          <p
            className={cn(
              "font-sans text-3xl font-semibold tabular-nums leading-none tracking-tight",
              tone === "warning" && primary !== "—" ? "text-destructive" : "",
            )}
          >
            {primary}
          </p>
          {primarySub ? (
            <span className="meta text-sm">{primarySub}</span>
          ) : null}
        </div>
      ) : null}

      {/* Subtext line */}
      {subtext ? (
        <div className="meta mt-2 text-xs">{subtext}</div>
      ) : null}

      {/* Free-form slot */}
      {children ? <div className="mt-4 flex-1">{children}</div> : null}

      {/* Bottom pill action — full-width, solid foreground */}
      {actionLabel && handleClick ? (
        <button
          type="button"
          onClick={handleClick}
          className="mt-5 w-full rounded-full bg-foreground py-2.5 text-center font-sans text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}

// Sub-cell — a bordered mini-tile inside a card, used to stack 2-3
// metrics under a single header. Mirrors the "RETIREMENT / REAL ESTATE"
// breakdown pattern from the reference design.
export function CardCell({
  label,
  primary,
  primarySub,
  meta,
  progressPct,
  children,
}: {
  label: string
  primary: string | number
  primarySub?: string
  meta?: string
  /** Progress bar 0-100, optional. */
  progressPct?: number
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-foreground/10 bg-muted/20 p-3">
      <p className="meta text-[0.65rem] uppercase tracking-wider">{label}</p>
      <p className="mt-1 font-sans text-2xl font-semibold tabular-nums leading-none">
        {primary}
        {primarySub ? (
          <span className="meta ml-1.5 text-xs font-normal">
            {primarySub}
          </span>
        ) : null}
      </p>
      {progressPct !== undefined ? (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-foreground/70"
            style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
          />
        </div>
      ) : null}
      {meta ? (
        <p className="meta mt-1 flex items-center justify-between text-[0.65rem]">
          <span>{progressPct !== undefined ? `${Math.round(progressPct)}%` : ""}</span>
          <span>{meta}</span>
        </p>
      ) : null}
      {children}
    </div>
  )
}
