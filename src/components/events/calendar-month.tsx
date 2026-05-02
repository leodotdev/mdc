import { Link } from "@tanstack/react-router"

import { cn } from "@/lib/utils"
import { buildMonthGrid, dayKey, todayKey } from "@/lib/event-helpers"
import type { EventWithSection } from "@/lib/event-helpers"

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

// Month grid: 7-column header (weekdays) + 6 rows of date cells. Each cell
// shows the date number plus up to 3 truncated event titles, each tinted
// with its section accent color. Cells outside the active month are muted.
export function CalendarMonth({
  year,
  month,
  events,
}: {
  year: number
  month: number
  events: Array<EventWithSection>
}) {
  const grid = buildMonthGrid(year, month)
  const today = todayKey()

  // Bucket events by day key for O(1) lookup per cell.
  const byDay = new Map<string, Array<EventWithSection>>()
  for (const e of events) {
    const key = dayKey(e.startsAt)
    const list = byDay.get(key) ?? []
    list.push(e)
    byDay.set(key, list)
  }

  return (
    <div className="border-t border-l border-foreground bg-card">
      {/* Weekday header */}
      <div className="grid grid-cols-7">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="kicker border-r border-b border-foreground px-2 py-2 text-center text-foreground"
          >
            {d}
          </div>
        ))}
      </div>
      {/* Day cells */}
      <div className="grid grid-cols-7">
        {grid.map((cell) => {
          const dayEvents = byDay.get(cell.dayKey) ?? []
          const isToday = cell.dayKey === today
          return (
            <div
              key={cell.dayKey}
              className={cn(
                "flex min-h-[7rem] flex-col gap-1 border-r border-b border-foreground p-2 text-xs",
                cell.inMonth ? "bg-card" : "bg-muted/30 text-muted-foreground",
              )}
            >
              <div
                className={cn(
                  "font-sans tabular-nums",
                  isToday
                    ? "font-bold text-primary"
                    : cell.inMonth
                      ? "font-semibold text-foreground"
                      : "font-medium text-muted-foreground",
                )}
              >
                {cell.date.getUTCDate()}
              </div>
              <ul className="flex flex-col gap-0.5">
                {dayEvents.slice(0, 3).map((e) => (
                  <li key={e._id}>
                    <Link
                      to="/events"
                      hash={`event-${e._id}`}
                      className="block truncate rounded-sm px-1 py-0.5 leading-tight transition-colors hover:bg-muted"
                      style={{
                        color:
                          e.section?.accentColor ?? "var(--foreground)",
                      }}
                      title={e.title}
                    >
                      {e.title}
                    </Link>
                  </li>
                ))}
                {dayEvents.length > 3 ? (
                  <li className="meta px-1 text-[0.65rem]">
                    +{dayEvents.length - 3} more
                  </li>
                ) : null}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}
