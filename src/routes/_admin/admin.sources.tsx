import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useConvex } from "convex/react"
import {
  ExternalLink,
  Loader2,
  Plus,
  Power,
  RefreshCw,
  Trash2,
} from "lucide-react"
import { useMemo, useState } from "react"

import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { NEIGHBORHOODS } from "../../../convex/lib/neighborhoods"
import { TableLoadingRows } from "@/components/editorial/story-card-skeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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

export const Route = createFileRoute("/_admin/admin/sources")({
  component: SourcesPage,
})

// Visual classification — the data model has lastFetchStatus + item
// counts; this collapses them to four buckets the editor can act on:
//  - "working"   : healthy fetch AND at least one item came through
//  - "silent"    : healthy fetch but ZERO items (page exists, no
//                   structured event data → can't feed the pipeline)
//  - "errored"   : last fetch threw
//  - "untested"  : never fetched (just seeded)
type SourceState = "working" | "silent" | "errored" | "untested"

function classify(s: {
  lastFetchStatus?: string
  lastFetchItemCount?: number
}): SourceState {
  if (!s.lastFetchStatus) return "untested"
  if (s.lastFetchStatus === "error") return "errored"
  if ((s.lastFetchItemCount ?? 0) > 0) return "working"
  return "silent"
}

function StatusDot({ state }: { state: SourceState }) {
  const map = {
    working: { bg: "var(--primary)", label: "Working — fetching events" },
    silent: { bg: "#facc15", label: "Silent — fetch OK but 0 events" },
    errored: { bg: "var(--destructive)", label: "Errored" },
    untested: { bg: "color-mix(in oklab, var(--muted-foreground) 40%, transparent)", label: "Never fetched" },
  } as const
  return (
    <span
      aria-label={map[state].label}
      title={map[state].label}
      className="inline-block size-2 shrink-0 rounded-full"
      style={{ background: map[state].bg }}
    />
  )
}

function SourcesPage() {
  const convex = useConvex()
  const queryClient = useQueryClient()
  const sources = useQuery(convexQuery(api.sourcesData.list, {}))
  const sectionsQuery = useQuery(convexQuery(api.sections.list, {}))

  // Filters
  const [statusFilter, setStatusFilter] =
    useState<SourceState | "all">("all")
  const [sectionFilter, setSectionFilter] = useState<string>("all")
  const [hoodFilter, setHoodFilter] = useState<string>("all")
  const [search, setSearch] = useState("")

  const sectionById = useMemo(() => {
    const map = new Map<string, { slug: string; name: string }>()
    for (const s of sectionsQuery.data ?? []) {
      map.set(s._id as string, { slug: s.slug, name: s.name })
    }
    return map
  }, [sectionsQuery.data])

  // Build the neighborhood filter options as the UNION of the canonical
  // NEIGHBORHOODS list AND every slug actually tagged on a source. The
  // migration uses Miami-Dade municipality slugs (doral, hialeah,
  // aventura, little-havana, allapattah, overtown...) that aren't in
  // the canonical 10-item list — without this union, filtering by
  // those tags is impossible because they never appear in the dropdown.
  const hoodOptions = useMemo(() => {
    const seen = new Map<string, string>() // slug → display
    for (const n of NEIGHBORHOODS) seen.set(n.slug, n.name)
    for (const s of sources.data ?? []) {
      for (const slug of s.neighborhoodSlugs ?? []) {
        if (!seen.has(slug)) {
          // Title-case the slug for display ("little-havana" → "Little Havana").
          const display = slug
            .split("-")
            .map((w) => w[0].toUpperCase() + w.slice(1))
            .join(" ")
          seen.set(slug, display)
        }
      }
    }
    return Array.from(seen.entries())
      .map(([slug, name]) => ({ slug, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [sources.data])

  // Apply filters
  const filtered = useMemo(() => {
    const rows = sources.data ?? []
    const needle = search.trim().toLowerCase()
    return rows.filter((s) => {
      const state = classify(s)
      if (statusFilter !== "all" && state !== statusFilter) return false
      if (sectionFilter !== "all") {
        const primary = s.sectionIds[0] as unknown as string | undefined
        if (sectionById.get(primary ?? "")?.slug !== sectionFilter) return false
      }
      if (hoodFilter !== "all") {
        if (hoodFilter === "_none") {
          if (s.neighborhoodSlugs && s.neighborhoodSlugs.length > 0) return false
        } else if (!s.neighborhoodSlugs?.includes(hoodFilter)) return false
      }
      if (needle) {
        const hay = `${s.name} ${s.url}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [sources.data, statusFilter, sectionFilter, hoodFilter, search, sectionById])

  // Group filtered rows by primary section, sorted alphabetically by
  // section name. Sources with no primary section land under "Other".
  const grouped = useMemo(() => {
    const groups = new Map<string, { name: string; rows: typeof filtered }>()
    for (const s of filtered) {
      const primaryId = s.sectionIds[0] as unknown as string | undefined
      const meta = primaryId ? sectionById.get(primaryId) : null
      const key = meta?.slug ?? "_other"
      const name = meta?.name ?? "Other"
      if (!groups.has(key)) groups.set(key, { name, rows: [] })
      groups.get(key)!.rows.push(s)
    }
    return Array.from(groups.entries()).sort((a, b) =>
      a[1].name.localeCompare(b[1].name),
    )
  }, [filtered, sectionById])

  // Coverage counts across the unfiltered dataset — what the row
  // counts at the top of the page show.
  const totals = useMemo(() => {
    const buckets = { all: 0, working: 0, silent: 0, errored: 0, untested: 0 }
    for (const s of sources.data ?? []) {
      buckets.all += 1
      buckets[classify(s)] += 1
    }
    return buckets
  }, [sources.data])

  const visibleIds = useMemo(
    () => filtered.map((s) => s._id as string),
    [filtered],
  )
  const { selected, allSelected, someSelected, toggleAll, toggleOne, clear } =
    useBulkSelection(visibleIds)

  const refetch = () =>
    queryClient.invalidateQueries({
      queryKey: convexQuery(api.sourcesData.list, {}).queryKey,
    })

  const testFetch = useMutation({
    mutationFn: async (sourceId: Id<"sources">) =>
      convex.action(api.sources.testFetch, { sourceId }),
    onSuccess: () => refetch(),
  })

  const removeSource = useMutation({
    mutationFn: async (sourceId: Id<"sources">) => {
      await convex.mutation(api.sourcesData.remove, { sourceId })
    },
    onSuccess: () => refetch(),
  })

  const setEnabled = useMutation({
    mutationFn: async ({
      sourceId,
      enabled,
    }: {
      sourceId: Id<"sources">
      enabled: boolean
    }) => {
      await convex.mutation(api.sourcesData.update, { sourceId, enabled })
    },
    onSuccess: () => refetch(),
  })

  const bulkTestFetch = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selected) as Array<Id<"sources">>
      await runOnAll(ids, (sourceId) =>
        convex.action(api.sources.testFetch, { sourceId }),
      )
    },
    onSuccess: () => {
      clear()
      refetch()
    },
  })

  const bulkSetEnabled = useMutation({
    mutationFn: async (enabled: boolean) => {
      const ids = Array.from(selected) as Array<Id<"sources">>
      await runOnAll(ids, (sourceId) =>
        convex.mutation(api.sourcesData.update, { sourceId, enabled }),
      )
    },
    onSuccess: () => {
      clear()
      refetch()
    },
  })

  return (
    <div className="flex flex-col gap-6">
      {/* Floating bulk-action bar — sticky at the top of the viewport
          when any rows are selected. Pinned z-40 with a backdrop blur
          so it sits cleanly over content the user is scrolling past. */}
      {someSelected ? (
        <div className="sticky top-0 z-40 -mx-4 sm:-mx-6 lg:-mx-8 xl:-mx-12 border-b border-foreground/10 bg-background/85 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/65 sm:px-6 lg:px-8 xl:px-12">
          <div className="flex flex-wrap items-center gap-2">
            <span className="meta text-xs">{selected.size} selected</span>
            <Button
              size="sm"
              variant="default"
              disabled={bulkTestFetch.isPending}
              onClick={() => bulkTestFetch.mutate()}
            >
              {bulkTestFetch.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RefreshCw />
              )}{" "}
              Test fetch
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={bulkSetEnabled.isPending}
              onClick={() => bulkSetEnabled.mutate(true)}
            >
              Enable
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={bulkSetEnabled.isPending}
              onClick={() => bulkSetEnabled.mutate(false)}
            >
              Disable
            </Button>
            <Button size="sm" variant="ghost" onClick={clear}>
              Clear
            </Button>
          </div>
        </div>
      ) : null}

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-sans text-3xl font-semibold tracking-[-0.02em]">
            Sources
          </h1>
          <p className="meta mt-1">
            Defined in <code className="font-mono">convex/seed.ts</code> — run{" "}
            <code className="font-mono">npx convex run seed:run</code> after
            editing. Sources are grouped by primary section.
          </p>
          {/* Quick counts strip */}
          <div className="meta mt-2 flex flex-wrap items-center gap-x-3 text-xs">
            <span>
              {totals.all} total
            </span>
            <span className="text-primary">● {totals.working} working</span>
            <span style={{ color: "#facc15" }}>● {totals.silent} silent</span>
            <span className="text-destructive">● {totals.errored} errored</span>
            <span className="text-muted-foreground">● {totals.untested} untested</span>
          </div>
        </div>
      </header>

      {/* Quick-add form — paste any event-rich URL and we auto-pick
          the right adapter type. Source is saved enabled so the next
          ingest tick fetches it. */}
      <AddSourceForm
        sections={sectionsQuery.data ?? []}
        onAdded={() =>
          queryClient.invalidateQueries({
            queryKey: convexQuery(api.sourcesData.list, {}).queryKey,
          })
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-md border bg-card px-3 py-2">
        <label className="flex flex-1 min-w-[14rem] items-center gap-2">
          <span className="meta text-xs">Search</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or URL…"
            className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
          />
        </label>
        <FilterSelect
          label="Status"
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as never)}
          options={[
            { value: "all", label: "All" },
            { value: "working", label: `Working (${totals.working})` },
            { value: "silent", label: `Silent (${totals.silent})` },
            { value: "errored", label: `Errored (${totals.errored})` },
            { value: "untested", label: `Untested (${totals.untested})` },
          ]}
        />
        <FilterSelect
          label="Section"
          value={sectionFilter}
          onChange={setSectionFilter}
          options={[
            { value: "all", label: "All sections" },
            ...(sectionsQuery.data ?? [])
              .filter((s) => !s.parentId)
              .map((s) => ({ value: s.slug, label: s.name })),
          ]}
        />
        <FilterSelect
          label="Neighborhood"
          value={hoodFilter}
          onChange={setHoodFilter}
          options={[
            { value: "all", label: "All" },
            { value: "_none", label: "(Untagged / citywide)" },
            ...hoodOptions.map((n) => ({ value: n.slug, label: n.name })),
          ]}
        />
        <span className="meta ml-auto text-xs">
          Showing {filtered.length} of {totals.all}
        </span>
      </div>

      {sources.data === undefined ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableBody>
              <TableLoadingRows rows={6} cols={6} />
            </TableBody>
          </Table>
        </div>
      ) : grouped.length === 0 ? (
        <p className="meta">No sources match these filters.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {grouped.map(([slug, group]) => (
            <div key={slug} className="overflow-x-auto rounded-md border">
              <div className="flex items-baseline justify-between bg-muted/50 px-3 py-2 border-b">
                <h2 className="font-sans text-sm font-semibold">{group.name}</h2>
                <span className="meta text-xs">{group.rows.length}</span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label={`Select all ${group.name}`}
                        checked={
                          group.rows.length > 0 &&
                          group.rows.every((s) => selected.has(s._id as string))
                        }
                        onCheckedChange={(v) => {
                          for (const s of group.rows) {
                            const id = s._id as string
                            const isSel = selected.has(id)
                            if (v && !isSel) toggleOne(id)
                            if (!v && isSel) toggleOne(id)
                          }
                        }}
                      />
                    </TableHead>
                    <TableHead className="w-8" />
                    <TableHead>Source</TableHead>
                    <TableHead className="hidden md:table-cell">Type</TableHead>
                    <TableHead className="hidden lg:table-cell">
                      Neighborhood
                    </TableHead>
                    <TableHead className="hidden md:table-cell">Last fetch</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.rows.map((s) => {
                    const id = s._id as string
                    const isSelected = selected.has(id)
                    const isPending =
                      testFetch.isPending && testFetch.variables === s._id
                    const isToggling =
                      setEnabled.isPending &&
                      setEnabled.variables?.sourceId === s._id
                    const state = classify(s)
                    const hoods = s.neighborhoodSlugs ?? []
                    return (
                      <TableRow
                        key={s._id}
                        data-state={isSelected ? "selected" : undefined}
                        className="transition-colors duration-150 hover:bg-muted/50"
                      >
                        <TableCell>
                          <Checkbox
                            aria-label={`Select ${s.name}`}
                            checked={isSelected}
                            onCheckedChange={() => toggleOne(id)}
                          />
                        </TableCell>
                        <TableCell>
                          <StatusDot state={state} />
                        </TableCell>
                        <TableCell className="max-w-md whitespace-normal">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{s.name}</span>
                            {!s.enabled ? (
                              <Badge
                                variant="secondary"
                                className="text-[0.6rem]"
                              >
                                disabled
                              </Badge>
                            ) : null}
                          </div>
                          <a
                            href={s.url.startsWith("http") ? s.url : undefined}
                            target="_blank"
                            rel="noreferrer"
                            className="meta text-xs break-words hover:underline block"
                          >
                            {s.url}
                          </a>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <Badge variant="outline" className="text-[0.65rem]">
                            {s.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <div className="flex flex-wrap gap-1">
                            {hoods.length === 0 ? (
                              <span className="meta text-xs">—</span>
                            ) : (
                              hoods.map((h) => (
                                <Badge
                                  key={h}
                                  variant="outline"
                                  className="text-[0.6rem]"
                                >
                                  {hoodOptions.find((n) => n.slug === h)
                                    ?.name ?? h}
                                </Badge>
                              ))
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell meta text-xs tabular-nums">
                          {s.lastFetchedAt ? (
                            <>
                              {relativeTime(s.lastFetchedAt)}
                              {s.lastFetchItemCount !== undefined ? (
                                <span className="ml-1 text-muted-foreground">
                                  · {s.lastFetchItemCount}
                                  {s.lastFetchNewCount &&
                                  s.lastFetchNewCount > 0 ? (
                                    <> ({s.lastFetchNewCount} new)</>
                                  ) : null}
                                </span>
                              ) : null}
                              {s.lastFetchError ? (
                                <span className="ml-1 text-destructive">
                                  — {s.lastFetchError.slice(0, 80)}
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <span className="meta">Never</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {s.url.startsWith("http") ? (
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label="Open source in new tab"
                                title="Open source"
                                render={
                                  <a
                                    href={s.url}
                                    target="_blank"
                                    rel="noreferrer"
                                  />
                                }
                              >
                                <ExternalLink />
                              </Button>
                            ) : null}
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label="Test fetch"
                              title="Test fetch"
                              disabled={isPending}
                              onClick={() => testFetch.mutate(s._id)}
                            >
                              {isPending ? (
                                <Loader2 className="animate-spin" />
                              ) : (
                                <RefreshCw />
                              )}
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={s.enabled ? "Disable" : "Enable"}
                              title={s.enabled ? "Disable" : "Enable"}
                              disabled={isToggling}
                              onClick={() =>
                                setEnabled.mutate({
                                  sourceId: s._id,
                                  enabled: !s.enabled,
                                })
                              }
                            >
                              <Power />
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label="Delete source"
                              title="Delete source"
                              disabled={removeSource.isPending}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Delete "${s.name}"? This is permanent.`,
                                  )
                                ) {
                                  removeSource.mutate(s._id)
                                }
                              }}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  {/* The first row's "select all" checkbox state is
                      handled above; the header checkbox below is for
                      keyboard tab order parity. */}
                  {group.rows.length === 0 ? null : null}
                </TableBody>
              </Table>
            </div>
          ))}
        </div>
      )}

      {/* Hidden cross-group "select all" indicator — kept for the
          parent allSelected accessor though we render per-group
          headers now. */}
      <span className="sr-only" aria-hidden>
        {allSelected ? "all selected" : ""}
      </span>
      <span className="hidden">{toggleAll.name}</span>
    </div>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: ReadonlyArray<{ value: string; label: string }>
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="meta text-xs">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border bg-background px-2 py-1 text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

// URL → most-likely adapter type. Auto-fills the dropdown so editors
// don't have to remember which scraper goes with which URL pattern.
type AdapterType = "ics" | "events-html" | "sitemap-events" | "miami-new-times"
function inferAdapterType(url: string): AdapterType {
  const u = url.toLowerCase()
  if (u.includes("miaminewtimes.com/eventsearch")) return "miami-new-times"
  if (
    u.includes("?ical=1") ||
    u.includes("&ical=1") ||
    u.endsWith(".ics") ||
    u.includes("icalendar.aspx") ||
    u.includes(".ics?") ||
    u.includes("feed=calendar")
  ) {
    return "ics"
  }
  if (u.endsWith("/sitemap.xml") || u.endsWith("/sitemap_index.xml")) {
    return "sitemap-events"
  }
  return "events-html"
}

// URL → most-likely Miami neighborhood. Mirrors the rules in the
// `forceCategorizeSources` migration so the form's default matches
// what we'd backfill. Returns "" when no obvious hit; editor can
// pick from the dropdown manually.
const NEIGHBORHOOD_HINTS: ReadonlyArray<{
  match: RegExp
  slug: string
}> = [
  { match: /miamifoundation|arshtcenter|olympiatheater|bayfrontpark|jlkc|frostscience|miamidda|miamigov\b/i, slug: "downtown" },
  { match: /theunderline|brickell/i, slug: "brickell" },
  { match: /icamiami|ocinema|thecitadel|manawynwood|wynwoodwalls|wynwoodmiami|\bgramps\b|thelabmiami|bacfl|lagniappemia|endeavormiami/i, slug: "wynwood-design-district" },
  { match: /rubellmuseum|elespacio23/i, slug: "allapattah" },
  { match: /youngarts/i, slug: "edgewater" },
  { match: /towertheater|carnavalmiami|cubaocho|ballandchain/i, slug: "little-havana" },
  { match: /lyrictheater/i, slug: "overtown" },
  { match: /thebass|nws\.edu|miaminewdrama|northbeachbandshell|wolfsonian|miamibeachfl|emergeamericas|timeoutmarket/i, slug: "miami-beach" },
  { match: /balharbour/i, slug: "bal-harbour" },
  { match: /townofsurfsidefl|\bsurfside\b/i, slug: "surfside" },
  { match: /sibfl|sunny.?isles/i, slug: "sunny-isles-beach" },
  { match: /biltmorehotel|coralgablesmuseum|gablestage|actorsplayhouse|booksandbooks|gablescinema|fairchildgarden|lowe\.miami\.edu|miamihurricanes|events\.miami\.edu|coralgables\.com/i, slug: "coral-gables" },
  { match: /vizcaya|deeringestate|cgsc|coconutgrove/i, slug: "coconut-grove" },
  { match: /keybiscayne/i, slug: "key-biscayne" },
  { match: /smdcac|southmiamifl/i, slug: "south-miami" },
  { match: /pinecrestgardens|pinecrest-fl/i, slug: "pinecrest" },
  { match: /miamishoresvillage|barry\.edu|mtcmiami/i, slug: "miami-shores" },
  { match: /cityofaventura/i, slug: "aventura" },
  { match: /cityofhomestead/i, slug: "homestead" },
  { match: /cityplacedoral|doralbotanical|cityofdoral/i, slug: "doral" },
  { match: /hialeahpark/i, slug: "hialeah" },
  { match: /northmiamifl/i, slug: "north-miami" },
  { match: /citynmb/i, slug: "north-miami-beach" },
  { match: /miamisprings-fl/i, slug: "miami-springs" },
]
function inferNeighborhood(url: string): string {
  for (const rule of NEIGHBORHOOD_HINTS) {
    if (rule.match.test(url)) return rule.slug
  }
  return ""
}

function AddSourceForm({
  sections,
  onAdded,
}: {
  sections: ReadonlyArray<{
    _id: string
    slug: string
    name: string
    parentId?: string
  }>
  onAdded: () => void
}) {
  const convex = useConvex()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState("")
  const [name, setName] = useState("")
  const [type, setType] = useState<AdapterType>("events-html")
  const [sectionId, setSectionId] = useState<string>("")
  const [hood, setHood] = useState<string>("")
  const [typeOverridden, setTypeOverridden] = useState(false)
  const [hoodOverridden, setHoodOverridden] = useState(false)

  // Top-level sections only (subsections inherit a parent's adapter
  // logic; routing to a sub-section is the desk's job at ingest time).
  const topLevel = sections.filter((s) => !s.parentId)

  // Default section once sections load.
  if (!sectionId && topLevel.length > 0) {
    setSectionId(topLevel[0]._id)
  }

  const add = useMutation({
    mutationFn: async () => {
      await convex.mutation(api.sourcesData.create, {
        name: name.trim() || url,
        type,
        url: url.trim(),
        sectionIds: [sectionId as Id<"sections">],
        enabled: true,
        neighborhoodSlugs: hood ? [hood] : undefined,
      })
    },
    onSuccess: () => {
      setUrl("")
      setName("")
      setHood("")
      setTypeOverridden(false)
      setHoodOverridden(false)
      onAdded()
    },
  })

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Plus />
          Add source
        </Button>
      </div>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!url.trim()) return
        add.mutate()
      }}
      className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-3"
    >
      <label className="flex min-w-[18rem] flex-1 flex-col gap-1">
        <span className="meta text-xs">URL</span>
        <input
          type="url"
          required
          placeholder="https://venue.com/events/?ical=1"
          value={url}
          onChange={(e) => {
            const v = e.target.value
            setUrl(v)
            if (!typeOverridden) setType(inferAdapterType(v))
            if (!hoodOverridden) setHood(inferNeighborhood(v))
          }}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex min-w-[10rem] flex-1 flex-col gap-1">
        <span className="meta text-xs">Name</span>
        <input
          type="text"
          placeholder="(defaults to URL)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="meta text-xs">Type</span>
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value as AdapterType)
            setTypeOverridden(true)
          }}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          <option value="ics">iCal (.ics / ?ical=1)</option>
          <option value="events-html">events-html (JSON-LD)</option>
          <option value="sitemap-events">sitemap-events</option>
          <option value="miami-new-times">miami-new-times</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="meta text-xs">Section</span>
        <select
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          {topLevel.map((s) => (
            <option key={s._id} value={s._id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="meta text-xs">Neighborhood</span>
        <select
          value={hood}
          onChange={(e) => {
            setHood(e.target.value)
            setHoodOverridden(true)
          }}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          <option value="">(citywide)</option>
          {NEIGHBORHOODS.map((n) => (
            <option key={n.slug} value={n.slug}>
              {n.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-2">
        <Button size="sm" type="submit" disabled={add.isPending || !url.trim()}>
          {add.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
          Add
        </Button>
        <Button
          size="sm"
          type="button"
          variant="ghost"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
