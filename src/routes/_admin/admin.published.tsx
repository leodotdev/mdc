import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import { useConvex } from "convex/react"
import { ExternalLink, ImageOff, Pencil, Undo2 } from "lucide-react"
import { useMemo } from "react"

import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { ImportanceGauge } from "@/components/editorial/importance-gauge"
import { TableLoadingRows } from "@/components/editorial/story-card-skeleton"
import { proxiedImageUrl } from "@/lib/image-proxy"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { relativeTime } from "@/lib/dates"
import { runOnAll, useBulkSelection } from "@/lib/use-bulk-selection"

export const Route = createFileRoute("/_admin/admin/published")({
  component: PublishedPage,
})

function PublishedPage() {
  const navigate = useNavigate()
  const convex = useConvex()
  const queryClient = useQueryClient()
  const { data } = useQuery(
    convexQuery(api.articles.publishedList, { limit: 100 }),
  )

  const visibleIds = useMemo(
    () => (data ?? []).map((a) => a._id as string),
    [data],
  )
  const { selected, allSelected, someSelected, toggleAll, toggleOne, clear } =
    useBulkSelection(visibleIds)

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: convexQuery(api.articles.publishedList, { limit: 100 })
        .queryKey,
    })

  const unpublish = useMutation({
    mutationFn: async (id: Id<"articles">) => {
      await convex.mutation(api.articles.unpublish, { id })
    },
    onSuccess: invalidate,
  })

  const bulkUnpublish = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selected) as Array<Id<"articles">>
      await runOnAll(ids, (id) =>
        convex.mutation(api.articles.unpublish, { id }),
      )
    },
    onSuccess: () => {
      clear()
      invalidate()
    },
  })

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-[-0.02em]">
            Published
          </h1>
          <p className="meta mt-1">
            {data ? `${data.length} live` : "Loading…"} on miami.community.
          </p>
        </div>
        {someSelected ? (
          <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 animate-in fade-in-0 slide-in-from-top-1 duration-200 ease-out">
            <span className="meta text-xs">{selected.size} selected</span>
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={bulkUnpublish.isPending}
                  >
                    <Undo2 /> Unpublish
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Unpublish {selected.size}{" "}
                    {selected.size === 1 ? "story" : "stories"}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    They'll be removed from the public site. You can republish
                    individually from the queue editor later.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel
                    render={<Button variant="ghost">Cancel</Button>}
                  />
                  <AlertDialogAction
                    render={
                      <Button
                        variant="destructive"
                        onClick={() => bulkUnpublish.mutate()}
                      >
                        Unpublish
                      </Button>
                    }
                  />
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button size="sm" variant="ghost" onClick={clear}>
              Clear
            </Button>
          </div>
        ) : null}
      </header>

      {data && data.length === 0 ? (
        <div className="rounded-md border bg-card p-6">
          <p className="font-editorial">Nothing published yet.</p>
          <p className="meta mt-1">
            Approved drafts will appear here. Start by reviewing the{" "}
            <Link to="/admin/queue" className="underline">
              queue
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all"
                    checked={allSelected}
                    onCheckedChange={() => toggleAll()}
                  />
                </TableHead>
                <TableHead className="w-20">Image</TableHead>
                <TableHead>Story</TableHead>
                <TableHead className="hidden md:table-cell">Section</TableHead>
                <TableHead className="hidden md:table-cell">Importance</TableHead>
                <TableHead className="hidden md:table-cell">Published</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data === undefined ? (
                <TableLoadingRows rows={6} cols={6} />
              ) : (
                data.map((a) => {
                  const id = a._id as string
                  const isSelected = selected.has(id)
                  return (
                    <TableRow
                      key={a._id}
                      data-state={isSelected ? "selected" : undefined}
                      className="cursor-pointer transition-colors duration-150 hover:bg-muted/50"
                      onClick={(e) => {
                        const target = e.target as HTMLElement
                        if (
                          target.closest(
                            "input, button, a, [role='checkbox']",
                          )
                        )
                          return
                        void navigate({
                          to: "/admin/queue/$id",
                          params: { id: a._id },
                        })
                      }}
                    >
                      <TableCell>
                        <Checkbox
                          aria-label={`Select ${a.title}`}
                          checked={isSelected}
                          onCheckedChange={() => toggleOne(id)}
                        />
                      </TableCell>
                      <TableCell>
                        {a.heroImage ? (
                          <img
                            src={proxiedImageUrl(a.heroImage, { width: 200 })}
                            alt=""
                            loading="lazy"
                            className="h-12 w-16 rounded object-cover"
                          />
                        ) : (
                          <div className="flex h-12 w-16 items-center justify-center rounded bg-muted text-muted-foreground">
                            <ImageOff className="h-4 w-4" />
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="max-w-md whitespace-normal">
                        <Link
                          to="/article/$slug"
                          params={{ slug: a.slug }}
                          target="_blank"
                          className="font-heading text-base font-semibold leading-tight hover:underline"
                        >
                          {a.title}
                        </Link>
                        <div className="font-editorial text-sm text-muted-foreground ">
                          {a.dek}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {a.section ? (
                          <span
                            className="kicker text-[0.65rem]"
                            style={{ color: a.section.accentColor }}
                          >
                            {a.section.name}
                          </span>
                        ) : (
                          <span className="meta">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <ImportanceGauge
                          article={a}
                          accent={a.section?.accentColor}
                        />
                      </TableCell>
                      <TableCell className="hidden md:table-cell meta text-xs tabular-nums">
                        {a.publishedAt ? relativeTime(a.publishedAt) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            to="/article/$slug"
                            params={{ slug: a.slug }}
                            target="_blank"
                            aria-label="View on site"
                            title="View on site"
                            className={buttonVariants({
                              size: "icon-sm",
                              variant: "ghost",
                            })}
                          >
                            <ExternalLink />
                          </Link>
                          <Link
                            to="/admin/queue/$id"
                            params={{ id: a._id }}
                            aria-label="Edit"
                            title="Edit"
                            className={buttonVariants({
                              size: "icon-sm",
                              variant: "ghost",
                            })}
                          >
                            <Pencil />
                          </Link>
                          <AlertDialog>
                            <AlertDialogTrigger
                              render={
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  aria-label="Unpublish"
                                  title="Unpublish"
                                  disabled={unpublish.isPending}
                                >
                                  <Undo2 />
                                </Button>
                              }
                            />
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  Unpublish "{a.title}"?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  It will be removed from the public site and
                                  section pages. You can republish from the
                                  queue editor later.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel
                                  render={<Button variant="ghost">Cancel</Button>}
                                />
                                <AlertDialogAction
                                  render={
                                    <Button
                                      variant="destructive"
                                      onClick={() => unpublish.mutate(a._id)}
                                    >
                                      Unpublish
                                    </Button>
                                  }
                                />
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
