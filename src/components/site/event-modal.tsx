import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { ArrowUpRight } from "lucide-react"

import { api } from "../../../convex/_generated/api"
import { EventLayout } from "@/components/editorial/event-layout"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useRecordView } from "@/lib/use-record-view"

// Modal overlay that renders the same EventLayout as /event/$slug.
// Replaces the older bottom-sheet `EventDrawer`. Triggered by
// `?event=slug` in the URL — clicking an event card sets the param
// without navigating away from the underlying page (list / month /
// map view stays visible behind the modal).
export function EventModal() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false })
  const slug = search.event

  const { data, isLoading } = useQuery({
    ...convexQuery(api.events.getBySlug, { slug: slug ?? "" }),
    enabled: !!slug,
  })
  // View beacon — counts once per tab session per event so the
  // Popular rail can rank by trailing-30-day open count.
  useRecordView(data?._id)

  const close = (open: boolean) => {
    if (open) return
    void navigate({
      search: ((prev: Record<string, unknown>) => {
        const { event: _, ...rest } = prev
        return rest
      }) as never,
    })
  }

  const open = !!slug

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>{data?.title ?? "Event"}</DialogTitle>
          <DialogDescription>{data?.description ?? ""}</DialogDescription>
        </DialogHeader>

        {/* "Open as full page" sits next to the dialog's built-in close
            button (which lives at `absolute top-4 end-4`). Same
            sr-only-friendly affordance, just promoted into the chrome
            so it's findable without scrolling past the BannerAd that
            used to live at the bottom. */}
        {data?.slug ? (
          <Link
            to="/event/$slug"
            params={{ slug: data.slug }}
            onClick={() => close(false)}
            aria-label="Open as full page"
            className="absolute top-4 end-12 z-10 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowUpRight className="size-4" />
          </Link>
        ) : null}

        <div className="max-h-[88vh] overflow-y-auto overscroll-contain">
          {isLoading || !data ? (
            <div className="flex flex-col gap-4 p-8">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-10 w-3/4" />
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="aspect-[3/2] max-h-80 w-full" />
            </div>
          ) : (
            <div className="px-6 pt-8 pb-8 md:px-8">
              <EventLayout rawEvent={data} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
