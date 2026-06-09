// Minimal RFC 5545 RRULE parser / formatter / occurrence-expander.
// Handles the common patterns Miami event sources actually emit:
// FREQ=DAILY|WEEKLY|MONTHLY|YEARLY with INTERVAL, BYDAY, BYMONTHDAY,
// COUNT, UNTIL. Doesn't cover the exotic stuff (BYSETPOS, BYWEEKNO,
// BYYEARDAY, RDATE/EXDATE, sub-day FREQ values) — fall back to the
// raw rule when the parser can't make sense of it.

const WEEKDAY_SHORT = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const
type DayCode = (typeof WEEKDAY_SHORT)[number]
const DAY_NAMES: Record<DayCode, string> = {
  SU: "Sunday",
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
}

export type ParsedRRule = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY"
  interval: number
  byDay?: Array<DayCode>
  byMonthDay?: number
  count?: number
  /** Epoch ms. Inclusive — the rule produces occurrences up to and including this date. */
  until?: number
}

export function parseRRule(rule: string): ParsedRRule | null {
  const trimmed = rule.replace(/^RRULE:/i, "").trim()
  if (!trimmed) return null
  const parts = new Map<string, string>()
  for (const seg of trimmed.split(";")) {
    const [k, v] = seg.split("=")
    if (k && v) parts.set(k.toUpperCase().trim(), v.trim())
  }
  const freqRaw = parts.get("FREQ")
  if (
    freqRaw !== "DAILY" &&
    freqRaw !== "WEEKLY" &&
    freqRaw !== "MONTHLY" &&
    freqRaw !== "YEARLY"
  ) {
    return null
  }
  const interval = Math.max(1, parseInt(parts.get("INTERVAL") ?? "1", 10) || 1)
  const byDay = parts
    .get("BYDAY")
    ?.split(",")
    .map((d) => d.trim().toUpperCase().slice(-2))
    .filter((d): d is DayCode =>
      (WEEKDAY_SHORT as readonly string[]).includes(d),
    )
  const byMonthDayRaw = parts.get("BYMONTHDAY")
  const byMonthDay = byMonthDayRaw ? parseInt(byMonthDayRaw, 10) : undefined
  const countRaw = parts.get("COUNT")
  const count = countRaw ? parseInt(countRaw, 10) : undefined
  const untilRaw = parts.get("UNTIL")
  const until = untilRaw ? parseIcsUntil(untilRaw) : undefined
  return {
    freq: freqRaw,
    interval,
    byDay: byDay && byDay.length > 0 ? byDay : undefined,
    byMonthDay: Number.isFinite(byMonthDay ?? NaN) ? byMonthDay : undefined,
    count: Number.isFinite(count ?? NaN) ? count : undefined,
    until,
  }
}

// UNTIL is either `YYYYMMDD` (all-day) or `YYYYMMDDTHHMMSSZ` (UTC).
function parseIcsUntil(s: string): number | undefined {
  const dateOnly = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (dateOnly) {
    return Date.UTC(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3], 23, 59, 59)
  }
  const dt = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/)
  if (dt) {
    return Date.UTC(+dt[1], +dt[2] - 1, +dt[3], +dt[4], +dt[5], +dt[6])
  }
  return undefined
}

// Human-readable label. Returns "Recurs weekly", "Every Saturday",
// "Monthly on the 15th", "Every 2 weeks on Tuesdays & Thursdays", etc.
// Returns null when the rule is unparseable — caller can fall back to
// hiding the recurrence line.
export function describeRRule(rule: string): string | null {
  const parsed = parseRRule(rule)
  if (!parsed) return null
  const parts: Array<string> = []
  const intervalWord = (singular: string, plural: string) =>
    parsed.interval === 1 ? singular : `Every ${parsed.interval} ${plural}`
  switch (parsed.freq) {
    case "DAILY":
      parts.push(parsed.interval === 1 ? "Daily" : intervalWord("Daily", "days"))
      break
    case "WEEKLY":
      if (parsed.byDay && parsed.byDay.length > 0) {
        const days = parsed.byDay.map((d) => `${DAY_NAMES[d]}s`)
        const list =
          days.length === 1
            ? days[0]
            : days.length === 2
              ? `${days[0]} & ${days[1]}`
              : `${days.slice(0, -1).join(", ")} & ${days[days.length - 1]}`
        parts.push(
          parsed.interval === 1 ? `Every ${list}` : `${intervalWord("Weekly", "weeks")} on ${list}`,
        )
      } else {
        parts.push(parsed.interval === 1 ? "Weekly" : intervalWord("Weekly", "weeks"))
      }
      break
    case "MONTHLY":
      parts.push(parsed.interval === 1 ? "Monthly" : intervalWord("Monthly", "months"))
      if (parsed.byMonthDay) {
        parts[0] = `${parts[0]} on the ${ordinal(parsed.byMonthDay)}`
      }
      break
    case "YEARLY":
      parts.push(parsed.interval === 1 ? "Yearly" : intervalWord("Yearly", "years"))
      break
  }
  if (parsed.until) {
    const d = new Date(parsed.until)
    const month = d.toLocaleString("en-US", { month: "short" })
    parts.push(`until ${month} ${d.getDate()}, ${d.getFullYear()}`)
  }
  return parts.join(" ")
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"]
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

// Compute the next N occurrences starting from `startsAt` (inclusive
// when it's still in the future). Honors UNTIL and COUNT. Caller is
// responsible for filtering to future-only when only future
// occurrences are wanted.
export function nextOccurrences(
  rule: string,
  startsAt: number,
  n: number,
): Array<number> {
  const parsed = parseRRule(rule)
  if (!parsed) return []
  const out: Array<number> = []
  const start = new Date(startsAt)
  // For WEEKLY with BYDAY (multiple), we need to enumerate within
  // each interval-week starting from the start's week.
  if (parsed.freq === "WEEKLY" && parsed.byDay && parsed.byDay.length > 0) {
    const dayIndices = parsed.byDay
      .map((d) => WEEKDAY_SHORT.indexOf(d))
      .sort((a, b) => a - b)
    // Anchor: the Sunday of the start's week.
    const anchor = new Date(start)
    anchor.setDate(anchor.getDate() - anchor.getDay())
    let weekOffset = 0
    while (out.length < n) {
      for (const di of dayIndices) {
        const occ = new Date(anchor)
        occ.setDate(occ.getDate() + di + weekOffset * 7 * parsed.interval)
        occ.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), 0)
        const ms = occ.getTime()
        if (ms < startsAt) continue
        if (parsed.until && ms > parsed.until) return out
        out.push(ms)
        if (out.length >= n) return out
        if (parsed.count && out.length >= parsed.count) return out
      }
      weekOffset += 1
      if (weekOffset > 200) break // safety
    }
    return out
  }
  // DAILY / WEEKLY without BYDAY / MONTHLY / YEARLY — step the base
  // unit by INTERVAL each iteration.
  let occ = new Date(startsAt)
  while (out.length < n) {
    if (parsed.until && occ.getTime() > parsed.until) break
    if (parsed.count && out.length >= parsed.count) break
    if (occ.getTime() >= startsAt) out.push(occ.getTime())
    occ = stepForward(occ, parsed)
    if (out.length > 1000) break // safety
  }
  return out
}

function stepForward(date: Date, parsed: ParsedRRule): Date {
  const next = new Date(date)
  switch (parsed.freq) {
    case "DAILY":
      next.setDate(next.getDate() + parsed.interval)
      break
    case "WEEKLY":
      next.setDate(next.getDate() + 7 * parsed.interval)
      break
    case "MONTHLY":
      next.setMonth(next.getMonth() + parsed.interval)
      break
    case "YEARLY":
      next.setFullYear(next.getFullYear() + parsed.interval)
      break
  }
  return next
}
