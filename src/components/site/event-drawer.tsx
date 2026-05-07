import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { ExternalLink, X } from "lucide-react"

import { api } from "../../../convex/_generated/api"
import { EventLayout } from "@/components/editorial/event-layout"
import { BannerAd } from "@/components/site/banner-ad"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Skeleton } from "@/components/ui/skeleton"

// Drawer overlay that renders the same EventLayout as /event/$slug.
// Triggered by `?event=slug` in the URL — clicking an event card sets
// the param without navigating away from the underlying page (week /
// month / list view stays scrollable behind the sheet). Powered by Vaul
// via the shadcn Drawer wrapper — drag the top handle to dismiss.
export function EventDrawer() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false })
  const slug = search.event

  const { data, isLoading } = useQuery({
    ...convexQuery(api.events.getBySlug, { slug: slug ?? "" }),
    enabled: !!slug,
  })

  const close = (open: boolean) => {
    if (open) return
    void navigate({
      // Preserve everything else — pagination, etc.
      search: ((prev: Record<string, unknown>) => {
        const { event: _, ...rest } = prev
        return rest
      }) as never,
    })
  }

  const open = !!slug

  return (
    <Drawer open={open} onOpenChange={close}>
      <DrawerContent
        className="overflow-hidden data-[vaul-drawer-direction=bottom]:max-h-[92dvh] sm:mx-auto sm:max-w-[628px] md:max-w-[720px] lg:max-w-[880px] xl:max-w-[1024px]"
      >
        <DrawerHeader className="sr-only">
          <DrawerTitle>{data?.title ?? "Event"}</DrawerTitle>
          <DrawerDescription>{data?.description ?? ""}</DrawerDescription>
        </DrawerHeader>

        <DrawerClose asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close"
            className="absolute end-3 top-3 z-20"
          >
            <X className="size-5" />
          </Button>
        </DrawerClose>

        <div className="overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {isLoading || !data ? (
            <div className="flex flex-col gap-4 p-8">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-10 w-3/4" />
              <Skeleton className="h-3 w-40" />
              <Skeleton className="aspect-[16/9] w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
            </div>
          ) : (
            <div className="px-6 pt-6 pb-10 md:px-10">
              <EventLayout rawEvent={data} />
              <BannerAd
                slot="event-drawer-bottom"
                className="mt-12 border-t border-border pt-10"
              />
              <div className="mt-10 flex justify-center">
                <Link
                  to="/event/$slug"
                  params={{ slug: data.slug ?? "" }}
                  onClick={() => close(false)}
                  className="meta inline-flex items-center gap-1.5 text-xs hover:text-foreground hover:underline"
                >
                  Open as full page
                  <ExternalLink className="size-3.5" />
                </Link>
              </div>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
