import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Link,
  createFileRoute,
  useNavigate,
} from "@tanstack/react-router"
import { useConvex } from "convex/react"
import { Image as ImageIcon, Loader2, Sparkles, X } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { ArticleBody } from "@/components/editorial/article-body"
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
import { NEIGHBORHOODS } from "../../../convex/lib/neighborhoods"
import { formatDateTime } from "@/lib/dates"
import { proxiedImageUrl } from "@/lib/image-proxy"

export const Route = createFileRoute("/_admin/admin/queue/$id")({
  component: QueueEditPage,
})

function QueueEditPage() {
  const { id } = Route.useParams()
  const articleId = id as Id<"articles">
  const navigate = useNavigate()
  const convex = useConvex()
  const queryClient = useQueryClient()

  const { data: article } = useQuery(
    convexQuery(api.articles.getById, { id: articleId }),
  )
  const { data: sections } = useQuery(convexQuery(api.sections.list, {}))

  const [title, setTitle] = useState("")
  const [dek, setDek] = useState("")
  const [body, setBody] = useState("")
  const [slug, setSlug] = useState("")
  const [tags, setTags] = useState("")
  const [heroImage, setHeroImage] = useState<string | undefined>(undefined)
  const [heroCaption, setHeroCaption] = useState<string | undefined>(undefined)
  const [sectionId, setSectionId] = useState<string>("")
  const [neighborhoods, setNeighborhoods] = useState<Array<string>>([])

  useEffect(() => {
    if (article) {
      setTitle(article.title)
      setDek(article.dek)
      setBody(article.body)
      setSlug(article.slug)
      setTags(article.tags.join(", "))
      setHeroImage(article.heroImage)
      setHeroCaption(article.heroCaption)
      setSectionId(article.sectionId as string)
      setNeighborhoods(article.neighborhoods ?? [])
    }
  }, [article])

  const toggleNeighborhood = (slug: string) =>
    setNeighborhoods((prev) =>
      prev.includes(slug) ? prev.filter((n) => n !== slug) : [...prev, slug],
    )

  const saveDraft = useMutation({
    mutationFn: async () => {
      await convex.mutation(api.articles.updateDraft, {
        id: articleId,
        title,
        dek,
        body,
        slug,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        heroImage,
        heroCaption,
        sectionId: sectionId
          ? (sectionId as Id<"sections">)
          : undefined,
        neighborhoods,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: convexQuery(api.articles.getById, { id: articleId })
          .queryKey,
      })
    },
  })

  const publish = useMutation({
    mutationFn: async () => {
      await saveDraft.mutateAsync()
      await convex.mutation(api.articles.publish, { id: articleId })
    },
    onSuccess: () => {
      void navigate({ to: "/admin/queue" })
    },
  })

  const reject = useMutation({
    mutationFn: async () => {
      await convex.mutation(api.articles.reject, { id: articleId })
    },
    onSuccess: () => {
      void navigate({ to: "/admin/queue" })
    },
  })

  // Re-run the desk against this single story: refreshes sources, asks the
  // LLM for additive citations / related links / optional copy polish, and
  // re-resolves the hero image when missing. Every change writes a row in
  // the History panel below.
  const enrich = useMutation({
    mutationFn: async () => {
      return await convex.action(api.agents.enrichStory, { articleId })
    },
    onSuccess: (result) => {
      if (result.error) {
        toast.error(`${result.deskName ?? "Desk"} enrichment failed`, {
          description: result.error,
        })
        return
      }
      queryClient.invalidateQueries({
        queryKey: convexQuery(api.articles.getById, { id: articleId })
          .queryKey,
      })
      queryClient.invalidateQueries({
        queryKey: convexQuery(api.articles.revisions, { articleId })
          .queryKey,
      })
      if (!result.changed) {
        toast(`${result.deskName} found nothing to add`, {
          description: "No new citations, related links, or copy changes.",
        })
        return
      }
      const parts: Array<string> = []
      if (result.citationsAdded) parts.push(`+${result.citationsAdded} citations`)
      if (result.relatedAdded) parts.push(`+${result.relatedAdded} related`)
      if (result.changedFields && result.changedFields.length > 0)
        parts.push(`refreshed ${result.changedFields.join(", ")}`)
      toast.success(`${result.deskName} enriched this story`, {
        description: parts.join(" · ") || "Updated.",
      })
    },
    onError: (err) => {
      toast.error("Enrich failed", {
        description: err instanceof Error ? err.message : String(err),
      })
    },
  })

  if (!article) {
    return <p className="meta">Loading…</p>
  }

  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <section className="space-y-4">
        <Link to="/admin/queue" className="meta hover:underline">
          ← Back to queue
        </Link>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="title">Headline</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dek">Standfirst (dek)</Label>
          <Textarea
            id="dek"
            value={dek}
            rows={3}
            onChange={(e) => setDek(e.target.value)}
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tags">Tags (comma-separated)</Label>
            <Input
              id="tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
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
              articleId={articleId}
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
            <img
              src={proxiedImageUrl(heroImage, { width: 800 })}
              alt=""
              className="aspect-[16/9] w-full rounded-[4px] border border-border object-cover"
            />
          ) : (
            <div className="flex aspect-[16/9] w-full items-center justify-center rounded-[4px] border border-dashed border-border bg-muted/30 text-xs text-muted-foreground">
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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="body">Body (Markdown)</Label>
          <Textarea
            id="body"
            value={body}
            rows={20}
            onChange={(e) => setBody(e.target.value)}
            className="font-mono text-sm"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button
            variant="default"
            disabled={publish.isPending}
            onClick={() => publish.mutate()}
          >
            {publish.isPending ? "Publishing…" : "Publish"}
          </Button>
          <Button
            variant="outline"
            disabled={saveDraft.isPending}
            onClick={() => saveDraft.mutate()}
          >
            {saveDraft.isPending ? "Saving…" : "Save draft"}
          </Button>
          <Button
            variant="outline"
            disabled={enrich.isPending}
            onClick={() => enrich.mutate()}
            title="Re-run the desk on this story — pulls fresh items, adds citations, links related, polishes copy if warranted, refreshes hero image. Tracked in the History panel below."
          >
            {enrich.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Sparkles />
            )}
            {enrich.isPending ? "Enriching…" : "Enrich"}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button variant="destructive" disabled={reject.isPending}>
                  Reject
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reject this draft?</AlertDialogTitle>
                <AlertDialogDescription>
                  It will leave the review queue and won't be published. You
                  can find it later by status in the Convex dashboard if you
                  need to recover it.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel render={<Button variant="ghost">Cancel</Button>} />
                <AlertDialogAction
                  render={
                    <Button
                      variant="destructive"
                      onClick={() => reject.mutate()}
                    >
                      Reject draft
                    </Button>
                  }
                />
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div className="border-t pt-4">
          <h3 className="kicker mb-2">Sources cited</h3>
          <ul className="space-y-1 text-sm">
            {article.citations.map((c, i) => (
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

        <RevisionTimeline articleId={articleId} />
      </section>

      <section className="space-y-3">
        <h3 className="kicker">Live preview</h3>
        <div className="rounded-md border bg-card p-6">
          <h1 className="display-md mb-2">{title || article.title}</h1>
          <p className="font-editorial text-lg text-muted-foreground">
            {dek || article.dek}
          </p>
          {heroImage ? (
            <figure className="my-6">
              <img
                src={heroImage}
                alt=""
                className="aspect-[16/9] w-full object-cover"
              />
              {heroCaption ? (
                <figcaption className="meta mt-2 text-sm">
                  {heroCaption}
                </figcaption>
              ) : null}
            </figure>
          ) : null}
          <div className="mt-4">
            <ArticleBody markdown={body || article.body} />
          </div>
        </div>
      </section>
    </div>
  )
}

// Per-article timeline. Lists revisions newest-first with provenance —
// who changed it (desk slug or editor email), what kind of change, and a
// concise summary line. Body diffs aren't stored, so this is a "what + when"
// log rather than full version history.
function RevisionTimeline({ articleId }: { articleId: Id<"articles"> }) {
  const { data: revs } = useQuery(
    convexQuery(api.articles.revisions, { articleId }),
  )
  if (!revs || revs.length === 0) {
    return (
      <div className="border-t pt-4">
        <h3 className="kicker mb-2">History</h3>
        <p className="meta text-sm">No history yet.</p>
      </div>
    )
  }
  return (
    <div className="border-t pt-4">
      <h3 className="kicker mb-3">History</h3>
      <ol className="space-y-3 text-sm">
        {revs.map((r) => {
          const who =
            r.editorEmail ?? (r.agentSlug ? `${r.agentSlug} desk` : "system")
          const action = describeRevision(r)
          return (
            <li
              key={r._id}
              className="flex flex-col gap-0.5 border-l-2 border-foreground/20 pl-3"
            >
              <p className="font-mono text-xs text-muted-foreground tabular-nums">
                {formatDateTime(r.at)} · {who}
              </p>
              <p>{action}</p>
              {r.note ? (
                <p className="font-editorial italic text-muted-foreground">
                  &ldquo;{r.note}&rdquo;
                </p>
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function describeRevision(r: {
  kind: string
  changedFields?: Array<string>
  citationsAdded?: number
  sourceItemsAdded?: number
  statusBefore?: string
  statusAfter?: string
}): string {
  if (r.kind === "draft_created") {
    return `Drafted with ${r.citationsAdded ?? 0} citations.`
  }
  if (r.kind === "agent_augmented") {
    const parts: Array<string> = []
    if (r.citationsAdded && r.citationsAdded > 0) {
      parts.push(`+${r.citationsAdded} citations`)
    }
    if (r.sourceItemsAdded && r.sourceItemsAdded > 0) {
      parts.push(`+${r.sourceItemsAdded} sources`)
    }
    if (r.changedFields && r.changedFields.length > 0) {
      parts.push(`updated ${r.changedFields.join(", ")}`)
    }
    return `Desk merged this story (${parts.join(" · ") || "no change"}).`
  }
  if (r.kind === "agent_enriched") {
    const parts: Array<string> = []
    if (r.citationsAdded && r.citationsAdded > 0) {
      parts.push(`+${r.citationsAdded} citations`)
    }
    if (r.sourceItemsAdded && r.sourceItemsAdded > 0) {
      parts.push(`+${r.sourceItemsAdded} sources`)
    }
    if (r.changedFields && r.changedFields.length > 0) {
      parts.push(`refreshed ${r.changedFields.join(", ")}`)
    }
    return `Desk enriched this story (${parts.join(" · ") || "no change"}).`
  }
  if (r.kind === "editor_edited" && r.changedFields) {
    return `Editor edited ${r.changedFields.join(", ")}.`
  }
  if (r.kind === "status_changed") {
    return `Status: ${r.statusBefore ?? "?"} → ${r.statusAfter ?? "?"}.`
  }
  return r.kind
}

// Hero image picker — fetches multiple OG candidates from cited sources +
// Unsplash matches scoped to the headline + section, drops anything that
// fails a reachability check, and lets the editor click a tile to apply.
// Picking a tile also persists immediately via `articles.setHero` so the
// timeline records the swap independent of the broader Save flow.
function HeroPicker({
  articleId,
  currentUrl,
  onPick,
  onClear,
}: {
  articleId: Id<"articles">
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
    unsplashEnabled: boolean
    unsplashCount: number
    wikimediaCount: number
    totalCandidates: number
  } | null>(null)
  // Tiles whose <img> fired onError — hidden so the editor only sees
  // images that actually render in their browser.
  const [broken, setBroken] = useState<Set<string>>(new Set())
  const [picking, setPicking] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setCandidates([])
    setDiagnostics(null)
    setBroken(new Set())
    try {
      const result = await convex.action(api.articles.findHeroOptions, {
        articleId,
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
      await convex.mutation(api.articles.setHero, {
        articleId,
        heroImage: c.url,
        heroCaption: c.caption,
        heroSource: c.source,
      })
      onPick(c)
      queryClient.invalidateQueries({
        queryKey: convexQuery(api.articles.getById, { id: articleId }).queryKey,
      })
      queryClient.invalidateQueries({
        queryKey: convexQuery(api.articles.revisions, { articleId }).queryKey,
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
      await convex.mutation(api.articles.setHero, {
        articleId,
        heroImage: undefined,
        heroCaption: undefined,
        heroSource: "none",
      })
      onClear()
      queryClient.invalidateQueries({
        queryKey: convexQuery(api.articles.getById, { id: articleId }).queryKey,
      })
      queryClient.invalidateQueries({
        queryKey: convexQuery(api.articles.revisions, { articleId }).queryKey,
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
                className="aspect-[16/10] animate-pulse rounded-[4px] bg-muted"
              />
            ))
          ) : candidates.length === 0 ||
            candidates.every((c) => broken.has(c.url)) ? (
            <div className="col-span-full space-y-3 py-6 text-center">
              <p className="meta text-sm">
                {candidates.length === 0
                  ? "No alternative images found."
                  : "Every candidate failed to load in this browser."}
              </p>
              {diagnostics ? (
                <ul className="meta mx-auto max-w-md space-y-0.5 text-left text-xs">
                  <li>
                    Cited sources scanned:{" "}
                    <span className="font-mono tabular-nums">
                      {diagnostics.sourcesWithImage}/{diagnostics.sourcesScanned}
                    </span>{" "}
                    returned an image
                  </li>
                  <li>
                    Unsplash:{" "}
                    {diagnostics.unsplashEnabled ? (
                      <span className="font-mono tabular-nums">
                        {diagnostics.unsplashCount} matches
                      </span>
                    ) : (
                      <span className="text-destructive">
                        not configured (set <code>UNSPLASH_ACCESS_KEY</code>{" "}
                        in Convex env)
                      </span>
                    )}
                  </li>
                  <li>
                    Wikimedia Commons:{" "}
                    <span className="font-mono tabular-nums">
                      {diagnostics.wikimediaCount} matches
                    </span>
                  </li>
                </ul>
              ) : null}
              {candidates.length > 0 ? (
                <details className="mx-auto max-w-md text-left">
                  <summary className="meta cursor-pointer text-xs">
                    Failed URLs ({candidates.length})
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {candidates.map((c) => (
                      <li key={c.url} className="text-xs break-all">
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-muted-foreground hover:underline"
                        >
                          {c.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <SearchExternal articleId={articleId} />
              <p className="meta mx-auto max-w-md text-xs">
                Or paste a URL into the field below, or Refresh after
                rephrasing the headline.
              </p>
            </div>
          ) : (
            candidates.map((c) => {
              if (broken.has(c.url)) return null
              return (
                <PickerTile
                  key={c.url}
                  candidate={c}
                  isCurrent={c.url === currentUrl}
                  isPicking={picking === c.url}
                  picking={picking}
                  onPick={() => void apply(c)}
                  onBroken={() =>
                    setBroken((prev) => {
                      if (prev.has(c.url)) return prev
                      const next = new Set(prev)
                      next.add(c.url)
                      return next
                    })
                  }
                />
              )
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Single tile in the hero picker. Tries the proxied URL first (wsrv.nl
// re-fetches server-side, bypassing newspaper-CDN hotlink protection);
// if the browser still can't load it (the origin sometimes refuses
// even the proxy, or wsrv.nl is rate-limiting that domain), falls
// through to the raw URL as a second attempt before giving up. Only
// after BOTH fail do we mark the tile broken and let the parent hide
// it. This keeps the false-negative rate close to zero — the user
// almost always gets to see what was found.
function PickerTile({
  candidate,
  isCurrent,
  isPicking,
  picking,
  onPick,
  onBroken,
}: {
  candidate: {
    url: string
    source: "source" | "unsplash" | "wikimedia"
    caption?: string
    label: string
  }
  isCurrent: boolean
  isPicking: boolean
  picking: string | null
  onPick: () => void
  onBroken: () => void
}) {
  // 0 = proxied (default), 1 = raw fallback, 2 = broken (let parent hide)
  const [attempt, setAttempt] = useState<0 | 1 | 2>(0)
  const src =
    attempt === 0
      ? proxiedImageUrl(candidate.url, { width: 480 })
      : candidate.url

  return (
    <button
      type="button"
      disabled={picking !== null || isCurrent}
      onClick={onPick}
      className={
        "group relative flex flex-col gap-1 overflow-hidden rounded-[4px] border bg-card text-left transition-colors hover:border-primary disabled:opacity-50 " +
        (isCurrent ? "border-primary" : "border-border")
      }
    >
      <div className="aspect-[16/10] w-full overflow-hidden bg-muted">
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => {
            if (attempt === 0) {
              setAttempt(1) // try raw URL next
            } else {
              setAttempt(2)
              onBroken()
            }
          }}
          className="h-full w-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.02]"
        />
      </div>
      <div className="flex items-center justify-between gap-2 px-2 pb-2">
        <span className="meta truncate text-[0.65rem]">{candidate.label}</span>
        {isPicking ? (
          <Loader2 className="size-3 animate-spin" />
        ) : isCurrent ? (
          <span className="meta text-[0.6rem] uppercase tracking-wider text-primary">
            Current
          </span>
        ) : null}
      </div>
    </button>
  )
}

// Escape-hatch buttons rendered in the picker's empty state. When the
// auto-find can't surface a usable image — usually because the cited
// sources hotlink-block their CDN AND the LLM-derived search query is
// too narrow to hit Unsplash/Wikimedia — these open external image
// search pages in a new tab so the editor can browse and paste a URL
// into the manual hero field. Query is built client-side from the
// article's title + tags.
function SearchExternal({ articleId }: { articleId: Id<"articles"> }) {
  const { data: article } = useQuery(
    convexQuery(api.articles.getById, { id: articleId }),
  )
  if (!article) return null
  // Drop common stop-y headlinese words that pollute image search queries.
  const stop = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "of",
    "in",
    "on",
    "at",
    "to",
    "for",
    "from",
    "with",
    "as",
    "is",
    "are",
    "was",
    "were",
    "after",
    "amid",
  ])
  const titleWords = article.title
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w))
    .slice(0, 4)
  const query = [...titleWords].join(" ") || "miami"
  const enc = encodeURIComponent(query)
  const links: Array<{ label: string; href: string }> = [
    { label: "Unsplash", href: `https://unsplash.com/s/photos/${enc}` },
    {
      label: "Wikimedia Commons",
      href: `https://commons.wikimedia.org/w/index.php?search=filetype%3Abitmap+${enc}&title=Special%3ASearch&fulltext=1&ns6=1`,
    },
    {
      label: "Google Images",
      href: `https://www.google.com/search?tbm=isch&q=${enc}`,
    },
  ]
  return (
    <div className="space-y-1.5">
      <p className="meta text-xs">Search elsewhere for "{query}"</p>
      <div className="flex flex-wrap justify-center gap-2">
        {links.map((l) => (
          <a
            key={l.label}
            href={l.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-foreground/20 bg-card px-3 py-1 text-xs hover:bg-muted"
          >
            {l.label} ↗
          </a>
        ))}
      </div>
    </div>
  )
}
