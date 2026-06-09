import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useConvex } from "convex/react"
import { Trash2 } from "lucide-react"
import { useState } from "react"

import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { Button } from "@/components/ui/button"

// /admin/taxonomy — editor-curated overrides for the classifier and
// audience filter. DB rows take precedence over the hardcoded
// baseline in convex/lib/classify.ts so editors can fix
// misclassifications and add new venues without a redeploy.

export const Route = createFileRoute("/_admin/admin/taxonomy")({
  component: TaxonomyPage,
})

function TaxonomyPage() {
  const convex = useConvex()
  const queryClient = useQueryClient()
  const data = useQuery(convexQuery(api.taxonomy.list, {}))
  const refetch = () =>
    queryClient.invalidateQueries({
      queryKey: convexQuery(api.taxonomy.list, {}).queryKey,
    })

  if (!data.data) return <p className="meta">Loading…</p>
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-sans text-3xl font-semibold tracking-[-0.02em]">
          Taxonomy
        </h1>
        <p className="meta mt-1 text-sm">
          Editor-curated overrides for the event classifier. Each row
          takes precedence over the built-in hardcoded baseline; new
          rules apply on the next mega-desk tick (no redeploy needed).
        </p>
      </header>

      <VenuesSection rows={data.data.venues} convex={convex} refetch={refetch} />
      <HostsSection rows={data.data.hosts} convex={convex} refetch={refetch} />
      <KeywordsSection
        rows={data.data.keywords}
        convex={convex}
        refetch={refetch}
      />
      <AudienceBlocksSection
        rows={data.data.audienceBlocks}
        convex={convex}
        refetch={refetch}
      />
    </div>
  )
}

function VenuesSection({
  rows,
  convex,
  refetch,
}: {
  rows: Array<{
    _id: Id<"taxonomyVenues">
    venueKey: string
    sectionSlug: string
    note?: string
  }>
  convex: ReturnType<typeof useConvex>
  refetch: () => void
}) {
  const [venueKey, setVenueKey] = useState("")
  const [sectionSlug, setSectionSlug] = useState("")
  const [note, setNote] = useState("")
  const add = useMutation({
    mutationFn: async () => {
      await convex.mutation(api.taxonomy.addVenue, {
        venueKey,
        sectionSlug,
        note: note || undefined,
      })
    },
    onSuccess: () => {
      setVenueKey("")
      setSectionSlug("")
      setNote("")
      refetch()
    },
  })
  const remove = useMutation({
    mutationFn: async (id: Id<"taxonomyVenues">) => {
      await convex.mutation(api.taxonomy.removeVenue, { id })
    },
    onSuccess: refetch,
  })
  return (
    <section className="rounded-md border bg-card">
      <SectionHeader title="Venues" caption="venue name → section" />
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (venueKey && sectionSlug) add.mutate()
        }}
        className="flex flex-wrap items-center gap-2 border-b bg-muted/50 px-3 py-2 text-xs"
      >
        <Input
          placeholder="venue (lowercase, e.g. kaseya center)"
          value={venueKey}
          onChange={setVenueKey}
          className="min-w-[18rem]"
        />
        <Input
          placeholder="section slug (e.g. heat)"
          value={sectionSlug}
          onChange={setSectionSlug}
        />
        <Input
          placeholder="note (optional)"
          value={note}
          onChange={setNote}
          className="flex-1"
        />
        <Button size="xs" type="submit" disabled={add.isPending}>
          Add
        </Button>
      </form>
      <RowList rows={rows}>
        {(r) => (
          <li
            key={r._id}
            className="flex items-center gap-3 border-t border-foreground/5 px-3 py-1.5 text-xs"
          >
            <span className="font-mono">{r.venueKey}</span>
            <span className="meta">→</span>
            <span className="font-medium">{r.sectionSlug}</span>
            {r.note ? <span className="meta">— {r.note}</span> : null}
            <DeleteIcon onClick={() => remove.mutate(r._id)} />
          </li>
        )}
      </RowList>
    </section>
  )
}

function HostsSection({
  rows,
  convex,
  refetch,
}: {
  rows: Array<{
    _id: Id<"taxonomyHosts">
    host: string
    sectionSlug: string
    note?: string
  }>
  convex: ReturnType<typeof useConvex>
  refetch: () => void
}) {
  const [host, setHost] = useState("")
  const [sectionSlug, setSectionSlug] = useState("")
  const [note, setNote] = useState("")
  const add = useMutation({
    mutationFn: async () => {
      await convex.mutation(api.taxonomy.addHost, {
        host,
        sectionSlug,
        note: note || undefined,
      })
    },
    onSuccess: () => {
      setHost("")
      setSectionSlug("")
      setNote("")
      refetch()
    },
  })
  const remove = useMutation({
    mutationFn: async (id: Id<"taxonomyHosts">) => {
      await convex.mutation(api.taxonomy.removeHost, { id })
    },
    onSuccess: refetch,
  })
  return (
    <section className="rounded-md border bg-card">
      <SectionHeader title="Hosts" caption="source hostname → section" />
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (host && sectionSlug) add.mutate()
        }}
        className="flex flex-wrap items-center gap-2 border-b bg-muted/50 px-3 py-2 text-xs"
      >
        <Input
          placeholder="host (e.g. arshtcenter.org)"
          value={host}
          onChange={setHost}
        />
        <Input
          placeholder="section slug"
          value={sectionSlug}
          onChange={setSectionSlug}
        />
        <Input
          placeholder="note (optional)"
          value={note}
          onChange={setNote}
          className="flex-1"
        />
        <Button size="xs" type="submit" disabled={add.isPending}>
          Add
        </Button>
      </form>
      <RowList rows={rows}>
        {(r) => (
          <li
            key={r._id}
            className="flex items-center gap-3 border-t border-foreground/5 px-3 py-1.5 text-xs"
          >
            <span className="font-mono">{r.host}</span>
            <span className="meta">→</span>
            <span className="font-medium">{r.sectionSlug}</span>
            {r.note ? <span className="meta">— {r.note}</span> : null}
            <DeleteIcon onClick={() => remove.mutate(r._id)} />
          </li>
        )}
      </RowList>
    </section>
  )
}

function KeywordsSection({
  rows,
  convex,
  refetch,
}: {
  rows: Array<{
    _id: Id<"taxonomyKeywords">
    pattern: string
    sectionSlug: string
    tags: ReadonlyArray<string>
    order: number
    note?: string
  }>
  convex: ReturnType<typeof useConvex>
  refetch: () => void
}) {
  const [pattern, setPattern] = useState("")
  const [sectionSlug, setSectionSlug] = useState("")
  const [tagsRaw, setTagsRaw] = useState("")
  const [order, setOrder] = useState("100")
  const add = useMutation({
    mutationFn: async () => {
      const tags = tagsRaw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
      await convex.mutation(api.taxonomy.addKeyword, {
        pattern,
        sectionSlug,
        tags,
        order: Number(order) || 100,
      })
    },
    onSuccess: () => {
      setPattern("")
      setSectionSlug("")
      setTagsRaw("")
      setOrder("100")
      refetch()
    },
  })
  const remove = useMutation({
    mutationFn: async (id: Id<"taxonomyKeywords">) => {
      await convex.mutation(api.taxonomy.removeKeyword, { id })
    },
    onSuccess: refetch,
  })
  return (
    <section className="rounded-md border bg-card">
      <SectionHeader
        title="Keywords"
        caption="title/body regex → section + tags"
      />
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (pattern && sectionSlug) add.mutate()
        }}
        className="flex flex-wrap items-center gap-2 border-b bg-muted/50 px-3 py-2 text-xs"
      >
        <Input
          placeholder="regex (e.g. \\b(book\\s+launch|author\\s+talk)\\b)"
          value={pattern}
          onChange={setPattern}
          className="flex-1 min-w-[20rem] font-mono"
        />
        <Input
          placeholder="section"
          value={sectionSlug}
          onChange={setSectionSlug}
        />
        <Input
          placeholder="tags (comma)"
          value={tagsRaw}
          onChange={setTagsRaw}
        />
        <Input placeholder="order" value={order} onChange={setOrder} />
        <Button size="xs" type="submit" disabled={add.isPending}>
          Add
        </Button>
      </form>
      {add.error ? (
        <p className="text-destructive px-3 py-1 text-xs">
          {(add.error as Error).message}
        </p>
      ) : null}
      <RowList rows={rows}>
        {(r) => (
          <li
            key={r._id}
            className="flex items-center gap-3 border-t border-foreground/5 px-3 py-1.5 text-xs"
          >
            <span className="meta tabular-nums">{r.order}</span>
            <span className="font-mono break-all">{r.pattern}</span>
            <span className="meta">→</span>
            <span className="font-medium">{r.sectionSlug}</span>
            {r.tags.length > 0 ? (
              <span className="meta">[{r.tags.join(", ")}]</span>
            ) : null}
            <DeleteIcon onClick={() => remove.mutate(r._id)} />
          </li>
        )}
      </RowList>
    </section>
  )
}

function AudienceBlocksSection({
  rows,
  convex,
  refetch,
}: {
  rows: Array<{
    _id: Id<"taxonomyAudienceBlocks">
    pattern: string
    note?: string
  }>
  convex: ReturnType<typeof useConvex>
  refetch: () => void
}) {
  const [pattern, setPattern] = useState("")
  const [note, setNote] = useState("")
  const add = useMutation({
    mutationFn: async () => {
      await convex.mutation(api.taxonomy.addAudienceBlock, {
        pattern,
        note: note || undefined,
      })
    },
    onSuccess: () => {
      setPattern("")
      setNote("")
      refetch()
    },
  })
  const remove = useMutation({
    mutationFn: async (id: Id<"taxonomyAudienceBlocks">) => {
      await convex.mutation(api.taxonomy.removeAudienceBlock, { id })
    },
    onSuccess: refetch,
  })
  return (
    <section className="rounded-md border bg-card">
      <SectionHeader
        title="Audience blocks"
        caption="drop event when matched (private / internal-only signals)"
      />
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (pattern) add.mutate()
        }}
        className="flex flex-wrap items-center gap-2 border-b bg-muted/50 px-3 py-2 text-xs"
      >
        <Input
          placeholder="regex (e.g. \\bgreek\\s+life\\b)"
          value={pattern}
          onChange={setPattern}
          className="flex-1 min-w-[20rem] font-mono"
        />
        <Input
          placeholder="note (optional)"
          value={note}
          onChange={setNote}
        />
        <Button size="xs" type="submit" disabled={add.isPending}>
          Add
        </Button>
      </form>
      {add.error ? (
        <p className="text-destructive px-3 py-1 text-xs">
          {(add.error as Error).message}
        </p>
      ) : null}
      <RowList rows={rows}>
        {(r) => (
          <li
            key={r._id}
            className="flex items-center gap-3 border-t border-foreground/5 px-3 py-1.5 text-xs"
          >
            <span className="font-mono break-all">{r.pattern}</span>
            {r.note ? <span className="meta">— {r.note}</span> : null}
            <DeleteIcon onClick={() => remove.mutate(r._id)} />
          </li>
        )}
      </RowList>
    </section>
  )
}

function SectionHeader({
  title,
  caption,
}: {
  title: string
  caption: string
}) {
  return (
    <div className="border-b px-3 py-2">
      <h2 className="font-sans text-sm font-semibold">{title}</h2>
      <p className="meta text-xs">{caption}</p>
    </div>
  )
}

function RowList<T>({
  rows,
  children,
}: {
  rows: ReadonlyArray<T>
  children: (row: T) => React.ReactNode
}) {
  if (rows.length === 0) {
    return (
      <p className="meta px-3 py-2 text-xs">
        No overrides yet — hardcoded baseline applies.
      </p>
    )
  }
  return <ul>{rows.map(children)}</ul>
}

function Input({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  className?: string
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={
        "rounded-md border bg-background px-2 py-1 text-xs " +
        (className ?? "")
      }
    />
  )
}

function DeleteIcon({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ml-auto text-muted-foreground hover:text-destructive"
      title="Delete"
      aria-label="Delete"
    >
      <Trash2 className="size-3.5" />
    </button>
  )
}
