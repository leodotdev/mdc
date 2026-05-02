import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useConvex } from "convex/react"
import { Check, Pencil, Plus, Trash2, X } from "lucide-react"
import { useMemo, useState } from "react"

import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import { TableLoadingRows } from "@/components/editorial/story-card-skeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import {
  formatEventShortDate,
  formatEventTime,
} from "@/lib/event-helpers"
import { proxiedImageUrl } from "@/lib/image-proxy"
import { runOnAll, useBulkSelection } from "@/lib/use-bulk-selection"
import { EVENT_KINDS, eventKindLabel } from "../../../convex/lib/eventKinds"
import type { EventKindSlug } from "../../../convex/lib/eventKinds"

export const Route = createFileRoute("/_admin/admin/events")({
  component: EventsAdminPage,
})

function EventsAdminPage() {
  const convex = useConvex()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<Doc<"events"> | null>(null)

  const { data } = useQuery(
    convexQuery(api.events.adminList, { pastDays: 7 }),
  )
  const sections = useQuery(convexQuery(api.sections.list, {}))

  const visibleIds = useMemo(
    () => (data ?? []).map((e) => e._id as string),
    [data],
  )
  const { selected, allSelected, someSelected, toggleAll, toggleOne, clear } =
    useBulkSelection(visibleIds)

  const refetch = () =>
    queryClient.invalidateQueries({
      queryKey: convexQuery(api.events.adminList, { pastDays: 7 }).queryKey,
    })

  const setStatus = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: Id<"events">
      status: "approved" | "rejected" | "pending_review"
    }) => {
      await convex.mutation(api.events.setStatus, { id, status })
    },
    onSuccess: refetch,
  })

  const remove = useMutation({
    mutationFn: async (id: Id<"events">) =>
      convex.mutation(api.events.remove, { id }),
    onSuccess: refetch,
  })

  const bulkSetStatus = useMutation({
    mutationFn: async (status: "approved" | "rejected") => {
      const ids = Array.from(selected) as Array<Id<"events">>
      await runOnAll(ids, (id) =>
        convex.mutation(api.events.setStatus, { id, status }),
      )
    },
    onSuccess: () => {
      clear()
      refetch()
    },
  })

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-[-0.02em]">
            Events
          </h1>
          <p className="meta mt-1">
            {data ? `${data.length} upcoming + recent` : "Loading…"} · approve
            extracted events or add manually.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {someSelected ? (
            <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 animate-in fade-in-0 slide-in-from-top-1 duration-200 ease-out">
              <span className="meta text-xs">{selected.size} selected</span>
              <Button
                size="sm"
                variant="default"
                disabled={bulkSetStatus.isPending}
                onClick={() => bulkSetStatus.mutate("approved")}
              >
                <Check /> Approve
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={bulkSetStatus.isPending}
                onClick={() => bulkSetStatus.mutate("rejected")}
              >
                <X /> Reject
              </Button>
              <Button size="sm" variant="ghost" onClick={clear}>
                Clear
              </Button>
            </div>
          ) : null}
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger
              render={
                <Button size="sm">
                  <Plus /> New event
                </Button>
              }
            />
            <DialogContent className="sm:max-w-2xl">
              <EventForm
                sections={sections.data ?? []}
                onClose={() => {
                  setCreateOpen(false)
                  refetch()
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </header>

      {data && data.length === 0 ? (
        <div className="rounded-md border bg-card p-6">
          <p className="font-editorial">No events yet.</p>
          <p className="meta mt-1">
            Add one with the "New event" button, or wait for a desk run to
            extract events from sources.
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
                <TableHead>Event</TableHead>
                <TableHead className="hidden md:table-cell">Kind</TableHead>
                <TableHead className="hidden md:table-cell">When</TableHead>
                <TableHead className="hidden lg:table-cell">Where</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data === undefined ? (
                <TableLoadingRows rows={6} cols={7} />
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
                        setEditing(e)
                      }}
                    >
                      <TableCell>
                        <Checkbox
                          aria-label={`Select ${e.title}`}
                          checked={isSelected}
                          onCheckedChange={() => toggleOne(id)}
                        />
                      </TableCell>
                      <TableCell className="max-w-md whitespace-normal">
                        <div className="font-medium">{e.title}</div>
                        {e.description ? (
                          <div className="font-editorial text-sm text-muted-foreground">
                            {e.description}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs">
                        <Badge variant="outline" className="text-[0.65rem]">
                          {eventKindLabel(e.kind)}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell tabular-nums text-xs">
                        <div>{formatEventShortDate(e.startsAt)}</div>
                        <div className="meta">
                          {formatEventTime(e)}
                        </div>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-xs">
                        {[e.locationName, e.neighborhood]
                          .filter(Boolean)
                          .join(" · ") || (
                          <span className="meta">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={e.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {e.status !== "approved" ? (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label="Approve"
                              title="Approve"
                              disabled={setStatus.isPending}
                              onClick={() =>
                                setStatus.mutate({
                                  id: e._id,
                                  status: "approved",
                                })
                              }
                            >
                              <Check />
                            </Button>
                          ) : null}
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Edit"
                            title="Edit"
                            onClick={() => setEditing(e)}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Delete"
                            title="Delete"
                            disabled={remove.isPending}
                            onClick={() => remove.mutate(e._id)}
                          >
                            <Trash2 />
                          </Button>
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

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          {editing ? (
            <EventForm
              sections={sections.data ?? []}
              initial={editing}
              onClose={() => {
                setEditing(null)
                refetch()
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function StatusBadge({ status }: { status: Doc<"events">["status"] }) {
  if (status === "approved") {
    return <Badge className="text-[0.65rem]">approved</Badge>
  }
  if (status === "rejected") {
    return (
      <Badge variant="destructive" className="text-[0.65rem]">
        rejected
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className="text-[0.65rem]">
      pending
    </Badge>
  )
}

// ─────────── Event form ───────────

type EventFormSection = {
  _id: Id<"sections">
  name: string
  slug: string
}

function toLocalDateTime(ts: number): string {
  const d = new Date(ts)
  // datetime-local needs YYYY-MM-DDTHH:MM in local time.
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalDateTime(local: string): number | null {
  if (!local) return null
  const ts = new Date(local).getTime()
  return Number.isFinite(ts) ? ts : null
}

function EventForm({
  sections,
  initial,
  onClose,
}: {
  sections: Array<EventFormSection>
  initial?: Doc<"events">
  onClose: () => void
}) {
  const convex = useConvex()
  const isEdit = Boolean(initial)

  const [title, setTitle] = useState(initial?.title ?? "")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [startsAtStr, setStartsAtStr] = useState(
    initial ? toLocalDateTime(initial.startsAt) : "",
  )
  const [endsAtStr, setEndsAtStr] = useState(
    initial?.endsAt ? toLocalDateTime(initial.endsAt) : "",
  )
  const [allDay, setAllDay] = useState(initial?.allDay ?? false)
  const [locationName, setLocationName] = useState(initial?.locationName ?? "")
  const [neighborhood, setNeighborhood] = useState(initial?.neighborhood ?? "")
  const [locationAddress, setLocationAddress] = useState(
    initial?.locationAddress ?? "",
  )
  const [url, setUrl] = useState(initial?.url ?? "")
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? "")
  const [price, setPrice] = useState(initial?.price ?? "")
  const [sectionId, setSectionId] = useState<string>(
    (initial?.sectionId as string | undefined) ??
      (sections.find((s) => s.slug === "things-to-do")?._id as string) ??
      "",
  )
  const [kind, setKind] = useState<EventKindSlug>(
    (initial?.kind as EventKindSlug | undefined) ?? "general",
  )
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    const startsAt = fromLocalDateTime(startsAtStr)
    if (!title.trim() || startsAt == null) {
      setErr("Title and a valid start time are required.")
      return
    }
    const endsAt = fromLocalDateTime(endsAtStr) ?? undefined
    if (endsAt != null && endsAt <= startsAt) {
      setErr("End time must be after start time.")
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        title: title.trim(),
        description: description.trim(),
        startsAt,
        endsAt,
        allDay,
        kind,
        locationName: locationName.trim() || undefined,
        neighborhood: neighborhood.trim() || undefined,
        locationAddress: locationAddress.trim() || undefined,
        url: url.trim() || undefined,
        imageUrl: imageUrl.trim() || undefined,
        price: price.trim() || undefined,
        sectionId: sectionId
          ? (sectionId as Id<"sections">)
          : undefined,
      }
      if (isEdit && initial) {
        await convex.mutation(api.events.update, {
          id: initial._id,
          patch: payload,
        })
      } else {
        await convex.mutation(api.events.create, {
          event: payload,
          status: "approved",
        })
      }
      onClose()
    } catch (caught) {
      setErr(
        caught instanceof Error ? caught.message : "Could not save event",
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{isEdit ? "Edit event" : "New event"}</DialogTitle>
      </DialogHeader>

      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="ev-title">Title</Label>
          <Input
            id="ev-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="ev-desc">Description</Label>
          <Textarea
            id="ev-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="ev-kind">Kind</Label>
          <Select
            value={kind}
            onValueChange={(v) =>
              setKind((v as EventKindSlug | null) ?? "general")
            }
          >
            <SelectTrigger id="ev-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EVENT_KINDS.map((k) => (
                <SelectItem key={k.slug} value={k.slug}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="ev-start">Starts</Label>
            <Input
              id="ev-start"
              type="datetime-local"
              value={startsAtStr}
              onChange={(e) => setStartsAtStr(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ev-end">Ends (optional)</Label>
            <Input
              id="ev-end"
              type="datetime-local"
              value={endsAtStr}
              onChange={(e) => setEndsAtStr(e.target.value)}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={allDay}
            onCheckedChange={(v) => setAllDay(Boolean(v))}
          />
          All-day event
        </label>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="ev-loc">Venue</Label>
            <Input
              id="ev-loc"
              value={locationName}
              onChange={(e) => setLocationName(e.target.value)}
              placeholder="Bayfront Park"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ev-nbhd">Neighborhood</Label>
            <Input
              id="ev-nbhd"
              value={neighborhood}
              onChange={(e) => setNeighborhood(e.target.value)}
              placeholder="Wynwood"
            />
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="ev-addr">Address (optional)</Label>
          <Input
            id="ev-addr"
            value={locationAddress}
            onChange={(e) => setLocationAddress(e.target.value)}
            placeholder="301 Biscayne Blvd, Miami"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="ev-price">Price</Label>
            <Input
              id="ev-price"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Free / $15-30"
            />
          </div>
          <div className="grid gap-1.5 md:col-span-2">
            <Label htmlFor="ev-url">Event URL</Label>
            <Input
              id="ev-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://"
            />
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="ev-image">Image URL</Label>
          <Input
            id="ev-image"
            type="url"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://…/poster.jpg"
          />
          {imageUrl ? (
            <img
              src={proxiedImageUrl(imageUrl, { width: 240 })}
              alt=""
              className="mt-1 aspect-square w-24 rounded-[4px] object-cover"
            />
          ) : null}
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="ev-section">Section</Label>
          <Select
            value={sectionId}
            onValueChange={(v) => setSectionId(v ?? "")}
          >
            <SelectTrigger id="ev-section">
              <SelectValue placeholder="Pick a section" />
            </SelectTrigger>
            <SelectContent>
              {sections.map((s) => (
                <SelectItem key={s._id} value={s._id as string}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {err ? <p className="text-sm text-destructive">{err}</p> : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {isEdit ? "Save changes" : "Create event"}
        </Button>
      </DialogFooter>
    </form>
  )
}
