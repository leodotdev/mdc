import { ArrowDown, ArrowUp } from "lucide-react"

import { Sparkline } from "@/components/admin/sparkline"
import { cn } from "@/lib/utils"

// First-class Miami metric renderer. Single component handles every
// `kind` — picks the right inner shape (single number / line / bars /
// rank / compare) based on the metric's payload. Citation footer is
// always shown and links to the underlying sources.

type Citation = {
  url: string
  title: string
  publisher: string
}

type MetricRow = {
  _id?: unknown
  slug: string
  title: string
  subtitle?: string
  kind: "number" | "number-with-delta" | "line" | "bars" | "rank" | "compare"
  data: unknown
  unit?: string
  citations: ReadonlyArray<Citation>
}

type Variant = "widget" | "inline" | "hero"

export function MetricCard({
  metric,
  variant = "widget",
  className,
}: {
  metric: MetricRow
  variant?: Variant
  className?: string
}) {
  return (
    <article
      className={cn(
        "rounded-md border border-foreground/10 bg-card",
        variant === "hero" ? "p-6" : "p-4",
        className,
      )}
    >
      <header>
        <h3
          className={cn(
            "font-sans font-semibold leading-tight",
            variant === "hero" ? "text-base" : "text-sm",
          )}
        >
          {metric.title}
        </h3>
        {metric.subtitle ? (
          <p className="meta mt-0.5 text-xs leading-snug">{metric.subtitle}</p>
        ) : null}
      </header>

      <div className="mt-3">
        <MetricBody metric={metric} variant={variant} />
      </div>

      {metric.citations.length > 0 ? (
        <footer className="mt-3 border-t border-foreground/10 pt-2">
          <p className="meta text-[0.6rem] uppercase tracking-wider">
            Source{metric.citations.length > 1 ? "s" : ""}
          </p>
          <ul className="flex flex-col gap-0.5 mt-1">
            {metric.citations.slice(0, 3).map((c) => (
              <li key={c.url} className="line-clamp-1">
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="meta text-[0.65rem] hover:underline"
                  title={c.title}
                >
                  {c.publisher}
                </a>
              </li>
            ))}
          </ul>
        </footer>
      ) : null}
    </article>
  )
}

function MetricBody({
  metric,
  variant,
}: {
  metric: MetricRow
  variant: Variant
}) {
  const data = metric.data as Record<string, unknown>

  if (metric.kind === "number" || metric.kind === "number-with-delta") {
    const value = data.value as number | undefined
    const delta = data.delta as
      | { value: number; period?: string }
      | undefined
    const currency = isCurrency(metric.unit)
    return (
      <div>
        <div className="flex items-baseline gap-2">
          <p
            className={cn(
              "font-sans font-semibold tabular-nums leading-none tracking-tight",
              variant === "hero" ? "text-5xl" : "text-3xl",
            )}
          >
            {currency ? currencySymbol(metric.unit) : ""}
            {formatNumber(value)}
          </p>
          {metric.unit && !currency ? (
            <span className="meta text-sm">{metric.unit}</span>
          ) : null}
        </div>
        {delta ? <DeltaBadge delta={delta} /> : null}
      </div>
    )
  }

  if (metric.kind === "rank") {
    const value = data.value as number | undefined
    const outOf = data.outOf as number | undefined
    const list = data.list as string | undefined
    return (
      <div>
        <div className="flex items-baseline gap-1">
          <span className="font-sans text-sm">#</span>
          <p
            className={cn(
              "font-sans font-semibold tabular-nums leading-none tracking-tight",
              variant === "hero" ? "text-5xl" : "text-3xl",
            )}
          >
            {formatNumber(value)}
          </p>
          {outOf ? (
            <span className="meta text-sm">of {outOf}</span>
          ) : null}
        </div>
        {list ? (
          <p className="meta mt-1 text-xs leading-snug">{list}</p>
        ) : null}
      </div>
    )
  }

  if (metric.kind === "line" || metric.kind === "bars") {
    const points = (data.points as Array<{ label: string; value: number }>) ?? []
    if (points.length === 0) return null
    const latest = points[points.length - 1]
    const labels = points.map((p) => p.label)
    const currency = isCurrency(metric.unit)
    return (
      <div>
        <div className="flex items-baseline gap-2">
          <p
            className={cn(
              "font-sans font-semibold tabular-nums leading-none tracking-tight",
              variant === "hero" ? "text-3xl" : "text-2xl",
            )}
          >
            {currency ? currencySymbol(metric.unit) : ""}
            {formatNumber(latest.value)}
          </p>
          {metric.unit && !currency ? (
            <span className="meta text-sm">{metric.unit}</span>
          ) : null}
          <span className="meta text-xs">· {latest.label}</span>
        </div>
        <Sparkline
          data={points.map((p) => p.value)}
          variant={metric.kind === "line" ? "line" : "bars"}
          width={240}
          height={48}
          highlightLast
          labels={labels.length <= 12 ? labels : undefined}
          className="mt-3 w-full text-foreground/70"
        />
      </div>
    )
  }

  if (metric.kind === "compare") {
    const left = data.left as { label: string; value: number } | undefined
    const right = data.right as { label: string; value: number } | undefined
    if (!left || !right) return null
    return (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="meta text-[0.65rem] uppercase tracking-wider">
            {left.label}
          </p>
          <p className="font-sans text-2xl font-semibold tabular-nums leading-none">
            {formatNumber(left.value)}
          </p>
        </div>
        <div className="border-l border-foreground/10 pl-3">
          <p className="meta text-[0.65rem] uppercase tracking-wider">
            {right.label}
          </p>
          <p className="font-sans text-2xl font-semibold tabular-nums leading-none">
            {formatNumber(right.value)}
          </p>
        </div>
      </div>
    )
  }

  return null
}

function DeltaBadge({
  delta,
}: {
  delta: { value: number; period?: string }
}) {
  const positive = delta.value >= 0
  const Icon = positive ? ArrowUp : ArrowDown
  return (
    <p
      className={cn(
        "meta mt-1 inline-flex items-center gap-1 text-xs",
        positive
          ? "text-emerald-700 dark:text-emerald-400"
          : "text-red-700 dark:text-red-400",
      )}
    >
      <Icon className="size-3" />
      <span className="tabular-nums">
        {positive ? "+" : ""}
        {formatNumber(delta.value)}
      </span>
      {delta.period ? (
        <span className="text-muted-foreground">· {delta.period}</span>
      ) : null}
    </p>
  )
}

// ISO-style currency codes (and a couple of common informal ones)
// that should render as a leading symbol instead of a trailing unit
// string. "$61M" reads better than "61,000,000 USD".
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  CAD: "C$",
  MXN: "MX$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CNY: "¥",
}

function isCurrency(unit: string | undefined): boolean {
  return !!unit && unit.toUpperCase() in CURRENCY_SYMBOLS
}

function currencySymbol(unit: string | undefined): string {
  if (!unit) return ""
  return CURRENCY_SYMBOLS[unit.toUpperCase()] ?? ""
}

// Compact representation of large counts: 61,000,000 → 61M,
// 1,200,000 → 1.2M, 60,000 → 60K. Keeps small values and decimals
// readable as-is — shorthand only kicks in once the digit count
// becomes a stat-card legibility problem.
function formatNumber(value: number | undefined): string {
  if (value == null || Number.isNaN(value)) return "—"
  const abs = Math.abs(value)
  const sign = value < 0 ? "-" : ""
  if (abs >= 1e9) return sign + trim(abs / 1e9) + "B"
  if (abs >= 1e6) return sign + trim(abs / 1e6) + "M"
  if (abs >= 10_000) return sign + trim(abs / 1000) + "K"
  if (abs >= 1000) return new Intl.NumberFormat("en-US").format(value)
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(2)
}

function trim(n: number): string {
  if (Number.isInteger(n)) return String(n)
  // One decimal, but drop a trailing ".0" so 60.0K just reads "60K".
  return n.toFixed(1).replace(/\.0$/, "")
}
