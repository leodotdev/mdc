import { useState } from "react"
import type { DateRange } from "react-day-picker"

import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { dayKey } from "@/lib/event-helpers"

// "Today" chip in the events sub-nav, expanded into a popover with a
// react-day-picker Calendar. Switch toggles between single-day (default,
// preserves the chevron-step UX) and range mode (start → end).
//
// On select, navigates with `?day=…` for a single day or `?day=…&until=…`
// for a range. Range clears `range`/preset, just like the chevrons. The
// trigger is a slot — caller passes it so the existing PILL_CLASS keeps
// the nav strip visually flush.

type Mode = "single" | "range"

export function TodayDropdown({
  selectedDay,
  selectedUntil,
  onPickDay,
  onPickRange,
  trigger,
}: {
  /** YYYY-MM-DD currently focused (chevron-stepped or range start). */
  selectedDay: string | undefined
  /** YYYY-MM-DD range end, when in range mode. */
  selectedUntil: string | undefined
  onPickDay: (day: string) => void
  onPickRange: (start: string, end: string) => void
  trigger: React.ReactNode
}) {
  // Range when `until` is set, single otherwise. Mode persists per-open
  // session so the user can flip without re-opening.
  const [mode, setMode] = useState<Mode>(selectedUntil ? "range" : "single")
  const [open, setOpen] = useState(false)

  const initialSingle: Date | undefined = selectedDay
    ? parseDayKey(selectedDay)
    : new Date()
  const initialRange: DateRange | undefined =
    selectedDay && selectedUntil
      ? { from: parseDayKey(selectedDay), to: parseDayKey(selectedUntil) }
      : selectedDay
        ? { from: parseDayKey(selectedDay), to: undefined }
        : undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger as React.ReactElement} />
      <PopoverContent align="center" className="w-auto p-3">
        <label className="mb-3 flex items-center justify-between gap-3 px-1">
          <span className="font-sans text-xs font-medium">
            {mode === "range" ? "Date range" : "Single day"}
          </span>
          <Switch
            checked={mode === "range"}
            onCheckedChange={(next) => setMode(next ? "range" : "single")}
            aria-label="Toggle date range mode"
          />
        </label>
        {mode === "single" ? (
          <Calendar
            mode="single"
            selected={initialSingle}
            onSelect={(d) => {
              if (!d) return
              onPickDay(dayKey(d.getTime()))
              setOpen(false)
            }}
          />
        ) : (
          <Calendar
            mode="range"
            selected={initialRange}
            onSelect={(r) => {
              if (!r?.from || !r?.to) return
              onPickRange(dayKey(r.from.getTime()), dayKey(r.to.getTime()))
              setOpen(false)
            }}
            numberOfMonths={2}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

function parseDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)) // noon UTC so local-tz formatting doesn't slide a day
}
