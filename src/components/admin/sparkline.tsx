import { cn } from "@/lib/utils"

// Tiny inline SVG sparkline. ~30 lines and zero dependencies. Renders
// either bars (discrete counts) or a stroked line (cumulative trend).
// Bars get rounded tops and a subtle "track" background so the chart
// reads even on near-empty data. Inherits color from `currentColor`,
// so the parent picks the tint via Tailwind text classes.

type SparklineProps = {
  data: ReadonlyArray<number>
  variant?: "bars" | "line"
  width?: number
  height?: number
  className?: string
  /** Emphasize the last bar/point. */
  highlightLast?: boolean
  /** Optional inline labels under the bars. Length must match `data`. */
  labels?: ReadonlyArray<string>
}

export function Sparkline({
  data,
  variant = "bars",
  width = 220,
  height = 56,
  className,
  highlightLast = false,
  labels,
}: SparklineProps) {
  const max = Math.max(1, ...data)
  const len = Math.max(1, data.length)
  const labelHeight = labels ? 14 : 0
  const chartHeight = height - labelHeight

  if (variant === "line") {
    const stepX = width / Math.max(1, len - 1)
    const points = data
      .map((v, i) => {
        const x = i * stepX
        const y = chartHeight - (v / max) * (chartHeight - 2) - 1
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(" ")
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        aria-hidden
        preserveAspectRatio="none"
        className={cn(className)}
      >
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
        />
      </svg>
    )
  }

  const barW = width / len
  const gap = Math.max(2, barW * 0.2)
  const innerW = Math.max(2, barW - gap)
  const radius = Math.min(innerW / 2, 3)
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden
      preserveAspectRatio="none"
      className={cn(className)}
    >
      {data.map((v, i) => {
        const ratio = v / max
        const h = Math.max(1, ratio * (chartHeight - 1))
        const x = i * barW + gap / 2
        const y = chartHeight - h
        const isLast = i === len - 1
        return (
          <g key={i}>
            {/* track — full-height faint bg behind the bar */}
            <rect
              x={x}
              y={0}
              width={innerW}
              height={chartHeight}
              rx={radius}
              fill="currentColor"
              className="opacity-[0.08]"
            />
            <rect
              x={x}
              y={y}
              width={innerW}
              height={h}
              rx={radius}
              fill="currentColor"
              className={cn(
                "transition-opacity",
                highlightLast && !isLast ? "opacity-50" : "opacity-90",
                v === 0 ? "opacity-0" : "",
              )}
            />
            {labels?.[i] ? (
              <text
                x={x + innerW / 2}
                y={height - 2}
                fontSize={9}
                textAnchor="middle"
                fill="currentColor"
                className="opacity-50"
                fontFamily="inherit"
              >
                {labels[i]}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}
