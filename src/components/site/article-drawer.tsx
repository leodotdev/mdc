import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { ExternalLink, X } from "lucide-react"

import { api } from "../../../convex/_generated/api"
import { ArticleLayout } from "@/components/editorial/article-layout"
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

// Drawer overlay that renders the exact same layout as the dedicated
// /article/$slug route. Both surfaces share `<ArticleLayout>` so any
// future change (typography, sections added, removed) lands in both
// places automatically. Powered by Vaul via the shadcn Drawer wrapper —
// drag the top handle (or the backdrop) to close, swipe down to dismiss
// on touch. The "Open as full page" link sits at the bottom as the only
// in-app escape hatch into the dedicated route.
export function ArticleDrawer() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false })
  const slug = search.article

  const { data, isLoading } = useQuery({
    ...convexQuery(api.articles.getBySlug, { slug: slug ?? "" }),
    enabled: !!slug,
  })

  const close = (open: boolean) => {
    if (open) return
    void navigate({
      // Preserve everything else — pagination, etc.
      search: ((prev: Record<string, unknown>) => {
        const { article: _, ...rest } = prev
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
          <DrawerTitle>{data?.title ?? "Article"}</DrawerTitle>
          <DrawerDescription>{data?.dek ?? ""}</DrawerDescription>
        </DrawerHeader>

        {/* Top-right close — overlay button so it floats above the
            scrolling content. Drag handle (top center) still works for
            swipe-to-close on touch; this gives mouse + keyboard users an
            obvious affordance. `z-20` to clear the absolute drag pill. */}
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
              <Skeleton className="h-10 w-2/3" />
              <Skeleton className="h-3 w-40" />
              <Skeleton className="aspect-[16/9] w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-9/12" />
            </div>
          ) : data.status !== "published" ? (
            <div className="p-8">
              <p className="meta">This article isn't published.</p>
            </div>
          ) : (
            <div className="px-6 pt-6 pb-10 md:px-10">
              <ArticleLayout rawArticle={data} />
              <BannerAd
                slot="article-drawer-bottom"
                className="mt-12 border-t border-border pt-10"
              />
              {/* Drawer-only affordance: promote to full page. Footer
                  position keeps the head clean — the in-app reader stays
                  in the drawer; the dedicated `/article/$slug` route is
                  reached only via this link or via an external/shared URL. */}
              <div className="mt-10 flex justify-center">
                <Link
                  to="/article/$slug"
                  params={{ slug: data.slug }}
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
