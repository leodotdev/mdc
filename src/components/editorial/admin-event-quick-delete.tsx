import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { convexQuery, useConvex } from "@convex-dev/react-query"
import { Trash2 } from "lucide-react"

import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"

// Floating "remove this event" affordance for editors browsing the
// public site. Hidden by default — surfaces in the top-right corner
// of the parent `group/item` on hover when the current user is an
// editor. Confirms before calling `events.remove`. Used for the
// fast-cleanup loop where a bad event slipped past ingest filters
// and an editor wants to nuke it without bouncing to /admin.
export function AdminEventQuickDelete({
  eventId,
  title,
}: {
  eventId: Id<"events">
  title: string
}) {
  const { data: me } = useQuery(convexQuery(api.me.current, {}))
  const convex = useConvex()
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: async () => {
      await convex.mutation(api.events.remove, { id: eventId })
    },
    onSuccess: () => {
      // Broad invalidation — events show up across many feeds.
      void queryClient.invalidateQueries()
    },
  })
  if (!me?.isEditor) return null
  return (
    <button
      type="button"
      aria-label="Delete event"
      title="Delete event (admin)"
      disabled={remove.isPending}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (window.confirm(`Delete "${title}"? This is permanent.`)) {
          remove.mutate()
        }
      }}
      className="absolute right-2 top-2 z-10 inline-flex size-7 items-center justify-center rounded-full border border-foreground/20 bg-background/90 text-destructive opacity-0 shadow-sm backdrop-blur-sm transition-opacity duration-150 hover:bg-destructive hover:text-destructive-foreground focus-visible:opacity-100 group-hover/item:opacity-100 disabled:opacity-50"
    >
      <Trash2 className="size-3.5" aria-hidden />
    </button>
  )
}
