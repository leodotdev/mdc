import type { FunctionReturnType } from "convex/server"
import type { api } from "../../convex/_generated/api"

export type EventWithSection = FunctionReturnType<
  typeof api.events.upcoming
>[number]

const MIAMI_TZ = "America/New_York"

export function startOfMonth(year: number, month: number): number {
  // month is 1-12; Date uses 0-11
  return new Date(Date.UTC(year, month - 1, 1)).getTime()
}

export function startOfNextMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 1)).getTime()
}

/**
 * Returns the YYYY-MM-DD key for an event's start time in Miami time.
 * Used for grouping events by day in calendar / list views.
 */
export function dayKey(ts: number): string {
  const d = new Date(ts)
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MIAMI_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d)
  const y = parts.find((p) => p.type === "year")?.value ?? "0000"
  const m = parts.find((p) => p.type === "month")?.value ?? "01"
  const day = parts.find((p) => p.type === "day")?.value ?? "01"
  return `${y}-${m}-${day}`
}

export function formatEventTime(event: {
  startsAt: number
  endsAt?: number
  allDay: boolean
}): string {
  if (event.allDay) return "All day"
  const start = new Date(event.startsAt)
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: MIAMI_TZ,
  }).format(start)
  if (event.endsAt) {
    const endTime = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: MIAMI_TZ,
    }).format(new Date(event.endsAt))
    return `${time} – ${endTime}`
  }
  return time
}

export function formatEventDate(ts: number): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: MIAMI_TZ,
  }).format(new Date(ts))
}

export function formatEventShortDate(ts: number): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: MIAMI_TZ,
  }).format(new Date(ts))
}

export function monthLabel(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month - 1, 1))
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(d)
}

/**
 * Build the 6×7 grid days for a month view. Pads with prior-month and
 * next-month days so weeks align Sunday→Saturday.
 */
export function buildMonthGrid(year: number, month: number): Array<{
  date: Date
  dayKey: string
  inMonth: boolean
}> {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const last = new Date(Date.UTC(year, month, 0)) // last day of this month
  const startOffset = first.getUTCDay() // 0=Sun
  const totalCells = Math.ceil((startOffset + last.getUTCDate()) / 7) * 7

  const cells: Array<{ date: Date; dayKey: string; inMonth: boolean }> = []
  for (let i = 0; i < totalCells; i += 1) {
    const d = new Date(Date.UTC(year, month - 1, 1 - startOffset + i))
    const inMonth = d.getUTCMonth() === month - 1
    const ts = d.getTime()
    cells.push({
      date: d,
      dayKey: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`,
      inMonth,
    })
    void ts
  }
  return cells
}

export function todayKey(): string {
  return dayKey(Date.now())
}

// =====================================================================
// Time-range presets — power the /events subnav. Each range collapses
// into a single { startMs, endMs } window in UTC. Saturday/Sunday land
// fixed regardless of the user's local timezone (precision is days, not
// minutes; close enough for a calendar feed).
// =====================================================================

export type EventRange = "today" | "weekend" | "nextWeekend"

const ONE_DAY_MS = 24 * 3_600_000

function startOfTodayUTC(): number {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
}

// Days until the next Saturday (0 if today IS Saturday).
function daysToSaturday(fromUtcMs: number): number {
  const dow = new Date(fromUtcMs).getUTCDay() // 0=Sun…6=Sat
  return (6 - dow + 7) % 7
}

export function rangeWindow(range: EventRange): {
  startMs: number
  endMs: number
} {
  const today = startOfTodayUTC()
  if (range === "today") {
    return { startMs: today, endMs: today + ONE_DAY_MS }
  }
  if (range === "weekend") {
    // Closest upcoming Sat 00:00 → Sun 23:59. If today is Sat or Sun,
    // anchor on the current Saturday.
    const dow = new Date(today).getUTCDay()
    const offset = dow === 0 ? -1 : dow === 6 ? 0 : daysToSaturday(today)
    const sat = today + offset * ONE_DAY_MS
    return { startMs: sat, endMs: sat + 2 * ONE_DAY_MS }
  }
  // nextWeekend — Saturday after the upcoming "this weekend".
  const dow = new Date(today).getUTCDay()
  const thisSatOffset = dow === 0 ? -1 : dow === 6 ? 0 : daysToSaturday(today)
  const nextSat = today + (thisSatOffset + 7) * ONE_DAY_MS
  return { startMs: nextSat, endMs: nextSat + 2 * ONE_DAY_MS }
}

// Map a YYYY-MM-DD `day` back to whichever range chip contains it (or
// null when the chevron-stepped day falls outside every preset window).
export function rangeForDay(day: string | undefined): EventRange | null {
  if (!day) return null
  const ts = new Date(`${day}T00:00:00Z`).getTime()
  const ranges: Array<EventRange> = ["today", "weekend", "nextWeekend"]
  for (const r of ranges) {
    const { startMs, endMs } = rangeWindow(r)
    if (ts >= startMs && ts < endMs) return r
  }
  return null
}

// "Today" or "Sat May 9 – Sun May 10".
export function formatRangeLabel(range: EventRange): string {
  const { startMs, endMs } = rangeWindow(range)
  if (range === "today") return "Today"
  const start = new Date(startMs)
  const end = new Date(endMs - ONE_DAY_MS)
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(d)
  return `${fmt(start)} – ${fmt(end)}`
}

/**
 * Bucket events by Miami day, expanding multi-day events so they appear
 * on every day they touch. A festival from Mar 8–10 shows in Mar 8, Mar
 * 9, AND Mar 10's bucket, sorted within each by start time. Events
 * without an `endsAt` (or with end ≤ start) bucket only into start day.
 *
 * Cap the per-event walk at 7 days so a corrupted multi-week range
 * can't blow up the bucket map.
 */
export function bucketEventsByDay<T extends { startsAt: number; endsAt?: number }>(
  events: ReadonlyArray<T>,
): Map<string, Array<T>> {
  const map = new Map<string, Array<T>>()
  const ONE_DAY = 24 * 3_600_000
  for (const e of events) {
    const start = e.startsAt
    const end = e.endsAt && e.endsAt > e.startsAt ? e.endsAt : e.startsAt
    const lastDay = Math.min(end, start + 6 * ONE_DAY)
    let cursor = start
    const seen = new Set<string>()
    while (cursor <= lastDay) {
      const k = dayKey(cursor)
      if (!seen.has(k)) {
        const list = map.get(k) ?? []
        list.push(e)
        map.set(k, list)
        seen.add(k)
      }
      cursor += ONE_DAY
    }
  }
  for (const list of map.values()) list.sort((a, b) => a.startsAt - b.startsAt)
  return map
}

// =====================================================================
// Week-view helpers — used by the horizontal-scrolling calendar to
// align days into Sunday→Saturday columns and to label each week.
// All boundaries are computed in UTC for stable SSR + a quick client
// recomputation on mount; that means a week may shift by a few hours
// on its edges relative to Miami local time, which is fine for the
// events use-case (date precision, not minute precision).
// =====================================================================

export function startOfWeekUTC(ms: number): number {
  const d = new Date(ms)
  const dayOfWeek = d.getUTCDay() // 0 = Sunday
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() - dayOfWeek,
  )
}

export function addWeeksUTC(ms: number, n: number): number {
  return ms + n * 7 * 24 * 3_600_000
}

export function addDaysUTC(ms: number, n: number): number {
  return ms + n * 24 * 3_600_000
}

/** "May 4–10" or "Apr 27 – May 3" when crossing a month boundary. */
export function formatWeekRange(weekStartMs: number): string {
  const start = new Date(weekStartMs)
  const end = new Date(weekStartMs + 6 * 24 * 3_600_000)
  const startMonth = start.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  })
  const endMonth = end.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  })
  const startDay = start.getUTCDate()
  const endDay = end.getUTCDate()
  if (startMonth === endMonth) return `${startMonth} ${startDay}–${endDay}`
  return `${startMonth} ${startDay} – ${endMonth} ${endDay}`
}

/** "Mon" (3-letter weekday) for a UTC midnight day timestamp. */
export function formatWeekday(dayMs: number): string {
  return new Date(dayMs).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  })
}

/** "5" (day-of-month). */
export function formatDayNumber(dayMs: number): string {
  return String(new Date(dayMs).getUTCDate())
}

/**
 * Build N day-cell entries spanning `weeks` weeks starting at `firstWeekStart`.
 * Each cell is a Sunday-aligned day with its UTC start ms + a YYYY-MM-DD key
 * for grouping events.
 */
export function buildWeekDays(
  firstWeekStart: number,
  weeks: number,
): Array<{
  weekStart: number
  dayMs: number
  dayKey: string
  isToday: boolean
}> {
  const todayK = todayKey()
  const out: Array<{
    weekStart: number
    dayMs: number
    dayKey: string
    isToday: boolean
  }> = []
  for (let w = 0; w < weeks; w += 1) {
    const weekStart = addWeeksUTC(firstWeekStart, w)
    for (let d = 0; d < 7; d += 1) {
      const dayMs = addDaysUTC(weekStart, d)
      const k = dayKey(dayMs)
      out.push({ weekStart, dayMs, dayKey: k, isToday: k === todayK })
    }
  }
  return out
}
