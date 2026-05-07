// Centralized date / time formatting. All editorial dates flow through here.

export function formatLongDate(ts: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(ts)
}

export function formatShortDate(ts: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(ts)
}

export function formatDateTime(ts: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(ts)
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.round(diff / 60_000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

// "Future" relative — "in 12m", "in 2h", "due now" / "overdue 5m" when
// the predicted moment has passed (cron will fire on next tick). Used by
// the dashboard's Next-run column.
export function formatNextRun(ts: number): string {
  const diff = ts - Date.now()
  if (diff <= 0) {
    const overdueMin = Math.round(-diff / 60_000)
    if (overdueMin < 5) return "any moment"
    if (overdueMin < 60) return `overdue ${overdueMin}m`
    const overdueHours = Math.round(overdueMin / 60)
    return `overdue ${overdueHours}h`
  }
  const m = Math.round(diff / 60_000)
  if (m < 60) return `in ${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `in ${h}h`
  const d = Math.round(h / 24)
  return `in ${d}d`
}

export function todayInMiami(): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  }).format(new Date())
}
