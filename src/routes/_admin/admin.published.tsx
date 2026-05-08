import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import { useConvex } from "convex/react"
import { ExternalLink, Pencil, Trash2, Undo2 } from "lucide-react"
import { useMemo } from "react"

import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { ImportanceGauge } from "@/components/editorial/importance-gauge"
import { TableLoadingRows } from "@/components/editorial/story-card-skeleton"
import { Thumb } from "@/components/admin/thumb"
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
import {
  formatEventShortDate,
  formatEventTime,
} from "@/lib/event-helpers"
import { runOnAll, useBulkSelection } from "@/lib/use-bulk-selection"
import { cn } from "@/lib/utils"

// Unified published-content inbox. Replaces the separate /admin/events
// route — same page now handles articles, videos, and events with a
// filter-pill row at the top. Each pill swaps the data source:
//   All       → articles.publishedList (every article + video, sorted)
//   Stories   → articles.publishedList filtered to mediaType !== video
//   Videos    → articles.publishedList filtered to mediaType === video
//   Events    → events.adminList (separate table; starts-at column)
//
// State is URL-driven via `?tab=` so deep links + back-button work.

type Tab = "all" | "stories" | "videos" | "events"

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "all", label: "All" },
  { id: "stories", label: "Stories" },
  { id: "videos", label: "Videos" },
  { id: "events", label: "Events" },
]

type SearchParams = { tab?: Tab }

export const Route = createFileRoute("/_admin/admin/published")({
  validateSearch: (search: Record<string, unknown>): SearchParams => {
    const raw = search.tab
    const tab = TABS.find((t) => t.id === raw)?.id
    return tab ? { tab } : {}
  },
  component: PublishedPage,
})

function PublishedPage() {
  const navigate = useNavigate()
  const { tab = "all" } = Route.useSearch()

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="font-sans text-3xl font-semibold tracking-[-0.02em]">
          Published
        </h1>
        <nav
          aria-label="Published filter"
          className="flex flex-wrap items-center gap-2 border-b border-foreground/10"
        >
          {TABS.map((t) => {
            const active = t.id === tab
            return (
              <button
                key={t.id}
                type="button"
                onClick={() =>
                  void navigate({
                    to: "/admin/published",
                    search: t.id === "all" ? {} : { tab: t.id },
                  })
                }
                className={cn(
                  "relative px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
                {active ? (
                  <span
                    aria-hidden
                    className="absolute right-2 left-2 -bottom-px h-0.5 rounded-full bg-foreground"
                  />
                ) : null}
              </button>
            )
          })}
        </nav>
      </header>

      {tab === "events" ? <EventsTable /> : <ArticlesTable filter={tab} />}
    </div>
  )
}

// ─── Articles table — used for All / Stories / Videos ───
function ArticlesTable({ filter }: { filter: Exclude<Tab, "events"> }) {
  const navigate = useNavigate()
  const convex = useConvex()
  const queryClient = useQueryClient()
  const { data } = useQuery(
    convexQuery(api.articles.publishedList, { limit: 100 }),
  )

  const filtered = useMemo(() => {
    if (!data) return data
    if (filter === "stories") {
      return data.filter((a) => a.mediaType !== "video")
    }
    if (filter === "videos") {
      return data.filter((a) => a.mediaType === "video")
    }
    return data
  }, [data, filter])

  const visibleIds = useMemo(
    () => (filtered ?? []).map((a) => a._id as string),
    [filtered],
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

  const emptyHint =
    filter === "videos"
      ? "No video stories yet — they appear when the desk publishes from a YouTube/Vimeo source."
      : filter === "stories"
        ? "No text stories published yet."
        : "Nothing published yet. Wait for the next mega-desk tick."

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="meta">
          {filtered ? `${filtered.length} live` : "Loading…"}
        </p>
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
                    They'll be removed from the public site. Republish
                    individually from the article editor later.
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
      </div>

      {filtered && filtered.length === 0 ? (
        <div className="rounded-md border bg-card p-6">
          <p className="meta">{emptyHint}</p>
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
              {filtered === undefined ? (
                <TableLoadingRows rows={6} cols={6} />
              ) : (
                filtered.map((a) => {
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
                          to: "/admin/article/$id",
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
                        <Thumb url={a.heroImage} />
                      </TableCell>
                      <TableCell className="max-w-md whitespace-normal">
                        <div className="flex items-center gap-2">
                          {a.mediaType === "video" ? (
                            <span className="kicker rounded-full bg-foreground/10 px-2 py-0.5 text-[0.6rem]">
                              Video
                            </span>
                          ) : null}
                          <Link
                            to="/article/$slug"
                            params={{ slug: a.slug }}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-base font-semibold leading-tight hover:underline"
                          >
                            {a.title}
                          </Link>
                        </div>
                        <div className="text-sm text-muted-foreground">
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
                            rel="noopener noreferrer"
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
                            to="/admin/article/$id"
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
                                  It will be removed from the public site.
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

// ─── Events table — uses events.adminList ───
function EventsTable() {
  const navigate = useNavigate()
  const convex = useConvex()
  const queryClient = useQueryClient()
  const { data } = useQuery(
    convexQuery(api.events.adminList, { pastDays: 7 }),
  )

  const visibleIds = useMemo(
    () => (data ?? []).map((e) => e._id as string),
    [data],
  )
  const { selected, allSelected, someSelected, toggleAll, toggleOne, clear } =
    useBulkSelection(visibleIds)

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: convexQuery(api.events.adminList, { pastDays: 7 }).queryKey,
    })

  const remove = useMutation({
    mutationFn: async (id: Id<"events">) => {
      await convex.mutation(api.events.remove, { id })
    },
    onSuccess: invalidate,
  })

  const bulkRemove = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selected) as Array<Id<"events">>
      await runOnAll(ids, (id) =>
        convex.mutation(api.events.remove, { id }),
      )
    },
    onSuccess: () => {
      clear()
      invalidate()
    },
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="meta">
          {data ? `${data.length} approved · last 7d + upcoming` : "Loading…"}
        </p>
        {someSelected ? (
          <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5">
            <span className="meta text-xs">{selected.size} selected</span>
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={bulkRemove.isPending}
                  >
                    <Trash2 /> Delete
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Delete {selected.size}{" "}
                    {selected.size === 1 ? "event" : "events"}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Permanently removes them from the public site.
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
                        onClick={() => bulkRemove.mutate()}
                      >
                        Delete
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
      </div>

      {data && data.length === 0 ? (
        <div className="rounded-md border bg-card p-6">
          <p className="meta">
            No events. The mega-desk extracts events from source items
            mentioning a concrete date — they'll appear here automatically.
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
                <TableHead>Event</TableHead>
                <TableHead className="hidden md:table-cell">Section</TableHead>
                <TableHead className="hidden md:table-cell">When</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data === undefined ? (
                <TableLoadingRows rows={6} cols={6} />
              ) : (
                data.map((e) => {
                  const id = e._id as string
                  const isSelected = selected.has(id)
                  return (
                    <TableRow
                      key={e._id}
                      data-state={isSelected ? "selected" : undefined}
                      className="cursor-pointer transition-colors duration-150 hover:bg-muted/50"
                      onClick={(ev) => {
                        const target = ev.target as HTMLElement
                        if (
                          target.closest(
                            "input, button, a, [role='checkbox']",
                          )
                        )
                          return
                        void navigate({
                          to: "/admin/events/$id",
                          params: { id: e._id },
                        })
                      }}
                    >
                      <TableCell>
                        <Checkbox
                          aria-label={`Select ${e.title}`}
                          checked={isSelected}
                          onCheckedChange={() => toggleOne(id)}
                        />
                      </TableCell>
                      <TableCell>
                        <Thumb url={e.heroImage} />
                      </TableCell>
                      <TableCell className="max-w-md whitespace-normal">
                        <p className="text-base font-semibold leading-tight">
                          {e.title}
                        </p>
                        {e.locationName ? (
                          <p className="text-sm text-muted-foreground">
                            {e.locationName}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {e.section ? (
                          <span
                            className="kicker text-[0.65rem]"
                            style={{ color: e.section.accentColor }}
                          >
                            {e.section.name}
                          </span>
                        ) : (
                          <span className="meta">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell meta text-xs tabular-nums">
                        <div>{formatEventShortDate(e.startsAt)}</div>
                        <div className="text-[0.7rem]">{formatEventTime(e)}</div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {e.slug ? (
                            <Link
                              to="/event/$slug"
                              params={{ slug: e.slug }}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label="View on site"
                              title="View on site"
                              className={buttonVariants({
                                size: "icon-sm",
                                variant: "ghost",
                              })}
                            >
                              <ExternalLink />
                            </Link>
                          ) : null}
                          <Link
                            to="/admin/events/$id"
                            params={{ id: e._id }}
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
                                  aria-label="Delete"
                                  title="Delete"
                                  disabled={remove.isPending}
                                >
                                  <Trash2 />
                                </Button>
                              }
                            />
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  Delete "{e.title}"?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  Permanently removes it from the public site.
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
                                      onClick={() => remove.mutate(e._id)}
                                    >
                                      Delete
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
