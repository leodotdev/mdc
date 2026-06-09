import { useMutation } from "convex/react"
import { useEffect } from "react"

import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"

// Fires the public `events:recordView` mutation exactly once per tab
// session per event. The Convex side is a public mutation that no-ops
// on bad ids / non-approved rows, so the worst a misbehaving client
// can do is burn a writeop.
//
// Dedupe lives in `sessionStorage` — survives in-tab navigation but
// resets on a new tab, which is the right granularity for "popular
// today" counting. Bots that don't run JS won't count at all (fine)
// and refreshes don't re-count (also fine).
//
// Used by both surfaces that open an event:
//   - `EventModal` when the `?event=slug` query loads its row
//   - `/event/$slug` route component on mount
//
// Effect is keyed on `eventId`, so swapping between two events inside
// the same modal session counts each one once.
export function useRecordView(eventId: Id<"events"> | null | undefined) {
  const recordView = useMutation(api.events.recordView)
  useEffect(() => {
    if (!eventId) return
    if (typeof window === "undefined") return
    const key = `evview:${eventId}`
    try {
      if (window.sessionStorage.getItem(key)) return
      window.sessionStorage.setItem(key, "1")
    } catch {
      // Private-mode / disabled storage — fire anyway. Worst case we
      // recount within a session, which is acceptable.
    }
    void recordView({ eventId })
  }, [eventId, recordView])
}
