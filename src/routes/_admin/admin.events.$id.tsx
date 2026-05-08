import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Link,
  createFileRoute,
  useNavigate,
} from "@tanstack/react-router"
import { useConvex } from "convex/react"
import {
  Image as ImageIcon,
  Loader2,
  MapPin,
  X,
} from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { api } from "../../../convex/_generated/api"
import { NEIGHBORHOODS } from "../../../convex/lib/neighborhoods"
import type { Id } from "../../../convex/_generated/dataModel"
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
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Textarea } from "@/components/ui/textarea"
import {
  formatEventDate,
  formatEventTime,
} from "@/lib/event-helpers"
import { HeroImg } from "@/components/site/hero-img"
import { proxiedImageUrl } from "@/lib/image-proxy"

export const Route = createFileRoute("/_admin/admin/events/$id")({
  component: EventEditPage,
})

// Convert a millisecond timestamp into the "YYYY-MM-DDTHH:MM" format an
// <input type="datetime-local"> expects, in the user's local time.
function toLocalDateTime(ts?: number): string {
  if (!ts) return ""
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalDateTime(local: string): number | null {
  if (!local) return null
  const ts = new Date(local).getTime()
  return Number.isFinite(ts) ? ts : null
}

function EventEditPage() {
  const { id } = Route.useParams()
  const eventId = id as Id<"events">
  const navigate = useNavigate()
  const convex = useConvex()
  const queryClient = useQueryClient()

  const { data: event } = useQuery(
    convexQuery(api.events.getByIdAdmin, { id: eventId }),
  )
  const { data: sections } = useQuery(convexQuery(api.sections.list, {}))

  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [tags, setTags] = useState("")
  const [startsAtStr, setStartsAtStr] = useState("")
  const [endsAtStr, setEndsAtStr] = useState("")
  const [allDay, setAllDay] = useState(false)
  const [locationName, setLocationName] = useState("")
  const [locationAddress, setLocationAddress] = useState("")
  const [neighborhoods, setNeighborhoods] = useState<Array<string>>([])
  const [url, setUrl] = useState("")
  const [price, setPrice] = useState("")
  const [sectionId, setSectionId] = useState<string>("")
  const [heroImage, setHeroImage] = useState<string | undefined>(undefined)
  const [heroCaption, setHeroCaption] = useState<string | undefined>(undefined)

  // Hydrate state once when the event arrives. Don't overwrite editor
  // input on subsequent re-renders — useQuery may invalidate after a
  // setHero or save and we don't want to clobber unsaved typing.
  useEffect(() => {
    if (!event) return
    setTitle(event.title)
    setDescription(event.description)
    setTags((event.tags ?? []).join(", "))
    setStartsAtStr(toLocalDateTime(event.startsAt))
    setEndsAtStr(toLocalDateTime(event.endsAt))
    setAllDay(event.allDay)
    setLocationName(event.locationName ?? "")
    setLocationAddress(event.locationAddress ?? "")
    setNeighborhoods(event.neighborhoods ?? [])
    setUrl(event.url ?? "")
    setPrice(event.price ?? "")
    setSectionId((event.sectionId as string | undefined) ?? "")
    setHeroImage(event.heroImage ?? undefined)
    setHeroCaption(event.heroCaption ?? undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?._id])

  const toggleNeighborhood = (slug: string) =>
    setNeighborhoods((prev) =>
      prev.includes(slug) ? prev.filter((n) => n !== slug) : [...prev, slug],
    )

  const save = useMutation({
    mutationFn: async () => {
      const startsAt = fromLocalDateTime(startsAtStr)
      const endsAt = fromLocalDateTime(endsAtStr) ?? undefined
      if (startsAt == null) throw new Error("Start time is required.")
      if (endsAt != null && endsAt <= startsAt) {
        throw new Error("End time must be after start time.")
      }
      if (!sectionId) {
        throw new Error("Pick a section — every event needs one.")
      }
      await convex.mutation(api.events.update, {
        id: eventId,
        patch: {
          title: title.trim(),
          description: description.trim(),
          startsAt,
          endsAt,
          allDay,
          locationName: locationName.trim() || undefined,
          locationAddress: locationAddress.trim() || undefined,
          neighborhoods,
          url: url.trim() || undefined,
          price: price.trim() || undefined,
          sectionId: sectionId as Id<"sections">,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          // hero is persisted separately via setHero, but include here too
          // so a manual URL paste in the input field gets saved.
          heroImage,
          heroCaption,
        },
      })
    },
    onSuccess: () => {
      toast.success("Saved")
      queryClient.invalidateQueries({
        queryKey: convexQuery(api.events.getByIdAdmin, { id: eventId })
          .queryKey,
      })
    },
    onError: (e) => {
      toast.error("Couldn't save", {
        description: e instanceof Error ? e.message : String(e),
      })
    },
  })

  const setStatus = useMutation({
    mutationFn: async (
      status: "approved" | "archived" | "rejected" | "pending_review",
    ) => {
      await convex.mutation(api.events.setStatus, { id: eventId, status })
    },
    onSuccess: (_data, status) => {
      const label =
        status === "approved"
          ? "approved"
          : status === "archived"
            ? "archived"
            : status === "rejected"
              ? "rejected"
              : "moved to review"
      toast.success(`Event ${label}`)
      void navigate({ to: "/admin/published", search: { tab: "events" } })
    },
    onError: (e) => {
      toast.error("Couldn't update status", {
        description: e instanceof Error ? e.message : String(e),
      })
    },
  })

  const approve = useMutation({
    mutationFn: async () => {
      await save.mutateAsync()
      await convex.mutation(api.events.setStatus, {
        id: eventId,
        status: "approved",
      })
    },
    onSuccess: () => {
      toast.success("Event approved")
      void navigate({ to: "/admin/published", search: { tab: "events" } })
    },
    onError: (e) => {
      toast.error("Couldn't approve", {
        description: e instanceof Error ? e.message : String(e),
      })
    },
  })

  if (!event) {
    return <p className="meta">Loading…</p>
  }

  const status = event.status

  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <section className="flex flex-col gap-4">
        <Link to="/admin/published" search={{ tab: "events" }} className="meta hover:underline">
          ← Back to events
        </Link>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="starts">Starts</Label>
            <Input
              id="starts"
              type="datetime-local"
              value={startsAtStr}
              onChange={(e) => setStartsAtStr(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ends">Ends (optional)</Label>
            <Input
              id="ends"
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

        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="venue">Venue</Label>
            <Input
              id="venue"
              value={locationName}
              onChange={(e) => setLocationName(e.target.value)}
              placeholder="Bayfront Park"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="address">Address (optional)</Label>
            <Input
              id="address"
              value={locationAddress}
              onChange={(e) => setLocationAddress(e.target.value)}
              placeholder="301 Biscayne Blvd, Miami"
            />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="price">Price</Label>
            <Input
              id="price"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Free / $15-30"
            />
          </div>
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <Label htmlFor="url">Event URL</Label>
            <Input
              id="url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="section">Section</Label>
          <Select
            value={sectionId}
            onValueChange={(v) => setSectionId(v ?? "")}
          >
            <SelectTrigger id="section">
              <SelectValue placeholder="Pick a section" />
            </SelectTrigger>
            <SelectContent>
              {(sections ?? []).map((s) => (
                <SelectItem key={s._id} value={s._id as string}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tags">Tags (comma-separated)</Label>
          <Input
            id="tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="festival, free, family"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Neighborhoods</Label>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md border p-3">
            {NEIGHBORHOODS.map((n) => (
              <label
                key={n.slug}
                className="flex items-center gap-2 text-sm"
              >
                <Checkbox
                  checked={neighborhoods.includes(n.slug)}
                  onCheckedChange={() => toggleNeighborhood(n.slug)}
                />
                {n.name}
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="hero">Hero image</Label>
            <HeroPicker
              eventId={eventId}
              currentUrl={heroImage}
              onPick={(c) => {
                setHeroImage(c.url)
                setHeroCaption(c.caption ?? heroCaption)
              }}
              onClear={() => {
                setHeroImage(undefined)
                setHeroCaption(undefined)
              }}
            />
          </div>
          {heroImage ? (
            <HeroImg
              url={heroImage}
              width={800}
              loading="eager"
              className="aspect-[16/9] w-full rounded-lg border border-border object-cover"
            />
          ) : (
            <div className="flex aspect-[16/9] w-full items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 text-xs text-muted-foreground">
              No hero image
            </div>
          )}
          <Input
            id="hero"
            value={heroImage ?? ""}
            placeholder="https://… (or use Find images above)"
            onChange={(e) => setHeroImage(e.target.value || undefined)}
          />
          <Input
            value={heroCaption ?? ""}
            placeholder="Caption / credit"
            onChange={(e) => setHeroCaption(e.target.value || undefined)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          {status !== "approved" ? (
            <Button
              variant="default"
              disabled={approve.isPending}
              onClick={() => approve.mutate()}
            >
              {approve.isPending ? "Approving…" : "Approve & save"}
            </Button>
          ) : null}
          <Button
            variant="outline"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
          {status === "approved" ? (
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button variant="outline" disabled={setStatus.isPending}>
                    Archive
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Archive this event?</AlertDialogTitle>
                  <AlertDialogDescription>
                    It disappears from the public site but stays in the
                    database. Set it back to approved later if you change
                    your mind.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel
                    render={<Button variant="ghost">Cancel</Button>}
                  />
                  <AlertDialogAction
                    render={
                      <Button onClick={() => setStatus.mutate("archived")}>
                        Archive
                      </Button>
                    }
                  />
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="destructive"
                  disabled={setStatus.isPending}
                >
                  Reject
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reject this event?</AlertDialogTitle>
                <AlertDialogDescription>
                  It won't be approved or published. You can find rejected
                  events later in the Convex dashboard.
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
                      onClick={() => setStatus.mutate("rejected")}
                    >
                      Reject event
                    </Button>
                  }
                />
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {(event.citations ?? []).length > 0 ? (
          <div className="border-t pt-4">
            <h3 className="kicker mb-2">Sources cited</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {(event.citations ?? []).map((c, i) => (
                <li key={i}>
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {c.title}
                  </a>
                  <span className="meta ml-2 text-xs">
                    {c.publisher ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

      </section>

      <section className="flex flex-col gap-3">
        <h3 className="kicker">Live preview</h3>
        <div className="rounded-md border bg-card p-6">
          {event.section ? (
            <p
              className="kicker text-xs"
              style={{ color: event.section.accentColor }}
            >
              {event.section.name}
            </p>
          ) : null}
          <h1 className="display-md mt-2 mb-2">{title || event.title}</h1>
          <div className="meta flex flex-wrap items-center gap-x-3 text-sm">
            <time>
              {formatEventDate(
                fromLocalDateTime(startsAtStr) ?? event.startsAt,
              )}
            </time>
            <span>·</span>
            <time>
              {formatEventTime({
                startsAt: fromLocalDateTime(startsAtStr) ?? event.startsAt,
                endsAt: fromLocalDateTime(endsAtStr) ?? undefined,
                allDay,
              })}
            </time>
            {(locationName || event.locationName) ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3" aria-hidden />
                {locationName || event.locationName}
                {neighborhoods[0] ? ` · ${neighborhoods[0]}` : null}
              </span>
            ) : null}
            {price ? <span>· {price}</span> : null}
          </div>
          {heroImage ? (
            <figure className="my-6">
              <img
                src={proxiedImageUrl(heroImage, { width: 1200 })}
                alt=""
                className="aspect-[16/9] w-full object-cover"
                onError={(e) => {
                  const img = e.currentTarget
                  if (img.src !== heroImage) {
                    img.src = heroImage
                  }
                }}
              />
              {heroCaption ? (
                <figcaption className="meta mt-2 text-sm">
                  {heroCaption}
                </figcaption>
              ) : null}
            </figure>
          ) : null}
          <p className="font-sans mt-4 text-base text-pretty">
            {description || event.description}
          </p>
        </div>
      </section>
    </div>
  )
}

// Hero image picker — mirrors the article picker. Pulls candidates from
// cited sources + Unsplash + Wikimedia, hides broken tiles via <img
// onError>, and persists the pick immediately via events.setHero so the
// event's stored hero stays in sync independent of the broader Save flow.
function HeroPicker({
  eventId,
  currentUrl,
  onPick,
  onClear,
}: {
  eventId: Id<"events">
  currentUrl?: string
  onPick: (candidate: {
    url: string
    source: "source" | "unsplash" | "wikimedia"
    caption?: string
  }) => void
  onClear: () => void
}) {
  const convex = useConvex()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [candidates, setCandidates] = useState<
    Array<{
      url: string
      source: "source" | "unsplash" | "wikimedia"
      caption?: string
      label: string
    }>
  >([])
  const [diagnostics, setDiagnostics] = useState<{
    sourcesScanned: number
    sourcesWithImage: number
    wikimediaCount: number
    totalCandidates: number
  } | null>(null)
  const [broken, setBroken] = useState<Set<string>>(new Set())
  const [picking, setPicking] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setCandidates([])
    setDiagnostics(null)
    setBroken(new Set())
    try {
      const result = await convex.action(api.events.findHeroOptions, {
        eventId,
      })
      setCandidates(result.candidates)
      setDiagnostics(result.diagnostics)
    } catch (e) {
      toast.error("Couldn't load images", {
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setLoading(false)
    }
  }

  const apply = async (c: (typeof candidates)[number]) => {
    setPicking(c.url)
    try {
      await convex.mutation(api.events.setHero, {
        eventId,
        heroImage: c.url,
        heroCaption: c.caption,
        heroSource: c.source,
      })
      onPick(c)
      queryClient.invalidateQueries({
        queryKey: convexQuery(api.events.getByIdAdmin, { id: eventId })
          .queryKey,
      })
      toast.success("Hero image updated")
      setOpen(false)
    } catch (e) {
      toast.error("Couldn't apply image", {
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setPicking(null)
    }
  }

  const clear = async () => {
    setPicking("__clear__")
    try {
      await convex.mutation(api.events.setHero, {
        eventId,
        heroImage: undefined,
        heroCaption: undefined,
        heroSource: "none",
      })
      onClear()
      queryClient.invalidateQueries({
        queryKey: convexQuery(api.events.getByIdAdmin, { id: eventId })
          .queryKey,
      })
      toast.success("Hero image cleared")
      setOpen(false)
    } catch (e) {
      toast.error("Couldn't clear image", {
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setPicking(null)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o && candidates.length === 0) void load()
      }}
    >
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            title="Pull OG images from cited sources + Unsplash matches and pick one. Broken URLs are filtered out."
          >
            <ImageIcon />
            Find images
          </Button>
        }
      />
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Find a hero image</DialogTitle>
          <DialogDescription>
            Pulled from cited sources + Unsplash. Broken URLs are filtered.
            Click a tile to apply.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2 border-y py-2">
          <p className="meta text-xs">
            {loading
              ? "Searching…"
              : (() => {
                  const visible = candidates.filter((c) => !broken.has(c.url))
                  return visible.length > 0
                    ? `${visible.length} option${visible.length === 1 ? "" : "s"}`
                    : "No options yet"
                })()}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={() => void load()}
            >
              {loading ? <Loader2 className="animate-spin" /> : null}
              Refresh
            </Button>
            {currentUrl ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={picking !== null}
                onClick={() => void clear()}
              >
                <X />
                Clear hero
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto md:grid-cols-3">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="aspect-[16/10] animate-pulse rounded-lg bg-muted"
              />
            ))
          ) : candidates.length === 0 ||
            candidates.every((c) => broken.has(c.url)) ? (
            <div className="flex flex-col gap-3 col-span-full py-6 text-center">
              <p className="meta text-sm">
                {candidates.length === 0
                  ? "No alternative images found."
                  : "Every candidate failed to load in this browser."}
              </p>
              {diagnostics ? (
                <ul className="flex flex-col gap-0.5 meta mx-auto max-w-md text-left text-xs">
                  <li>
                    Cited sources scanned:{" "}
                    <span className="font-mono tabular-nums">
                      {diagnostics.sourcesWithImage}/
                      {diagnostics.sourcesScanned}
                    </span>{" "}
                    returned an image
                  </li>
                  <li>
                    Wikimedia Commons:{" "}
                    <span className="font-mono tabular-nums">
                      {diagnostics.wikimediaCount} matches
                    </span>
                  </li>
                </ul>
              ) : null}
            </div>
          ) : (
            candidates
              .filter((c) => !broken.has(c.url))
              .map((c) => (
                <PickerTile
                  key={c.url}
                  candidate={c}
                  selected={c.url === currentUrl}
                  picking={picking === c.url}
                  disabled={picking !== null && picking !== c.url}
                  onApply={() => void apply(c)}
                  onBroken={() =>
                    setBroken((prev) => {
                      const next = new Set(prev)
                      next.add(c.url)
                      return next
                    })
                  }
                />
              ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PickerTile({
  candidate,
  selected,
  picking,
  disabled,
  onApply,
  onBroken,
}: {
  candidate: {
    url: string
    source: "source" | "unsplash" | "wikimedia"
    caption?: string
    label: string
  }
  selected: boolean
  picking: boolean
  disabled: boolean
  onApply: () => void
  onBroken: () => void
}) {
  // Try the wsrv.nl proxy first (it normalizes hotlink protection); on
  // proxy failure fall back to the raw URL; on raw failure mark the tile
  // broken so the parent hides it.
  const [stage, setStage] = useState<"proxy" | "raw">("proxy")
  const src =
    stage === "proxy"
      ? proxiedImageUrl(candidate.url, { width: 480 })
      : candidate.url
  return (
    <button
      type="button"
      disabled={disabled || picking}
      onClick={onApply}
      className={`group/tile relative aspect-[16/10] transform-gpu overflow-clip rounded-lg border text-left transition-colors ${
        selected ? "border-primary ring-2 ring-primary" : "border-border"
      } ${disabled ? "opacity-50" : "hover:border-foreground"}`}
      title={candidate.label}
    >
      <img
        src={src}
        alt=""
        loading="lazy"
        className="size-full object-cover transition-transform duration-200 ease-out group-hover/tile:scale-[1.015]"
        onError={() => {
          if (stage === "proxy") setStage("raw")
          else onBroken()
        }}
      />
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 text-[0.65rem] tracking-wide uppercase text-white">
        {candidate.label}
      </span>
      {picking ? (
        <span className="absolute inset-0 grid place-items-center bg-black/40">
          <Loader2 className="animate-spin text-white" />
        </span>
      ) : null}
    </button>
  )
}

