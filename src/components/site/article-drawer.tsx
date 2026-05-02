import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { ExternalLink } from "lucide-react"

import { api } from "../../../convex/_generated/api"
import { ArticleBody } from "@/components/editorial/article-body"
import { ArticleHeader } from "@/components/editorial/article-header"
import { SourcesBlock } from "@/components/editorial/sources-block"
import { TagList } from "@/components/editorial/tag-list"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

export function ArticleDrawer() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { article?: string }
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
    <Sheet open={open} onOpenChange={close}>
      <SheetContent
        side="bottom"
        className="flex max-h-[92dvh] flex-col gap-0 overflow-y-auto rounded-t-2xl p-0 sm:mx-auto sm:max-w-[628px] md:max-w-[760px] lg:max-w-[1024px] xl:max-w-[1288px]"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{data?.title ?? "Article"}</SheetTitle>
          <SheetDescription>{data?.dek ?? ""}</SheetDescription>
        </SheetHeader>

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
          <article className="px-6 pt-12 pb-10 md:px-10">
            <ArticleHeader article={data} />
            <div className="mt-10">
              <ArticleBody markdown={data.body} />
            </div>
            <TagList tags={data.tags} />
            <SourcesBlock citations={data.citations} />
            <div className="mt-10 border-t pt-6 text-center">
              <Link
                to="/article/$slug"
                params={{ slug: data.slug }}
                className="meta inline-flex items-center gap-1.5 text-sm hover:text-foreground hover:underline"
                onClick={() => close(false)}
              >
                Open as full page <ExternalLink className="size-3.5" />
              </Link>
            </div>
          </article>
        )}
      </SheetContent>
    </Sheet>
  )
}
