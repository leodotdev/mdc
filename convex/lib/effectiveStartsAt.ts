// Server-side mirror of the frontend `effectiveStartsAt` helper.
// Recurring events keep their canonical `startsAt` (the series'
// original DTSTART) — but if that's already passed, the *displayed*
// start time should be the next future occurrence from
// `recurrenceInstances` (populated nightly by `recurrence.cronTick`).
//
// Used by date-range queries (inRange / inMonth / upcoming) when they
// need to decide whether a recurring event is "in" a future window
// even though its raw startsAt fell out of that window long ago.

export function effectiveStartsAt(event: {
  startsAt: number
  recurrenceRule?: string | null
  recurrenceInstances?: ReadonlyArray<number> | null
}): number {
  if (event.startsAt >= Date.now()) return event.startsAt
  const instances = event.recurrenceInstances ?? []
  if (!event.recurrenceRule || instances.length === 0) return event.startsAt
  const now = Date.now()
  const next = instances.find((t) => t >= now)
  return next ?? event.startsAt
}

/** True when ANY of an event's occurrences (the canonical startsAt or
 *  any recurrenceInstances entry) falls inside [windowStart, windowEnd). */
export function intersectsWindow(
  event: {
    startsAt: number
    endsAt?: number | null
    recurrenceRule?: string | null
    recurrenceInstances?: ReadonlyArray<number> | null
  },
  windowStart: number,
  windowEnd: number,
): boolean {
  // Direct hit — startsAt inside window, OR an endsAt that overlaps.
  if (event.startsAt >= windowStart && event.startsAt < windowEnd) return true
  if (
    event.endsAt &&
    event.endsAt >= windowStart &&
    event.startsAt < windowEnd
  ) {
    return true
  }
  // Recurring hit — any precomputed instance inside the window.
  if (!event.recurrenceRule) return false
  const instances = event.recurrenceInstances ?? []
  for (const t of instances) {
    if (t >= windowStart && t < windowEnd) return true
  }
  return false
}
