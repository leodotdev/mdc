import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import { useConvex } from "convex/react"
import { ExternalLink, Pencil, Trash2 } from "lucide-react"
import { useMemo } from "react"

import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { TableLoadingRows } from "@/components/editorial/event-card-skeleton"
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
import {
  formatEventShortDate,
  formatEventTime,
} from "@/lib/event-helpers"
import { runOnAll, useBulkSelection } from "@/lib/use-bulk-selection"

// Published-events inbox. Legacy filter tabs were retired with the
// events-only pivot — only the Events table remains, rendered directly
// without a filter row.

export const Route = createFileRoute("/_admin/admin/published")({
  component: PublishedPage,
})

function PublishedPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-sans text-3xl font-semibold tracking-[-0.02em]">
          Published
        </h1>
      </header>
      <EventsTable />
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
      {/* Sticky bulk-actions bar — pins to viewport top when any rows
          are selected so it stays reachable while scrolling. */}
      {someSelected ? (
        <div className="sticky top-0 z-40 -mx-4 sm:-mx-6 lg:-mx-8 xl:-mx-12 border-b border-foreground/10 bg-background/85 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/65 sm:px-6 lg:px-8 xl:px-12">
          <div className="flex flex-wrap items-center gap-2">
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
        </div>
      ) : null}

      <p className="meta">
        {data ? `${data.length} approved · last 7d + upcoming` : "Loading…"}
      </p>

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
