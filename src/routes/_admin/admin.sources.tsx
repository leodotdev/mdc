import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useConvex } from "convex/react"
import {
  ExternalLink,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react"
import { useMemo, useState } from "react"

import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { TableLoadingRows } from "@/components/editorial/event-card-skeleton"
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
import { cn } from "@/lib/utils"

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
  // Cumulative events-per-source. Drives the "Events gathered" column.
  // Cached server-side; refetches on the same triggers as the source
  // list so adding/disabling a source doesn't desync the numbers.
  const eventCounts = useQuery(convexQuery(api.sourcesData.eventCounts, {}))

  // Filters — section binding was retired with the classifier (#1),
  // so only status + free-text search remain.
  const [statusFilter, setStatusFilter] =
    useState<SourceState | "all">("all")
  const [search, setSearch] = useState("")

  // Apply filters
  const filtered = useMemo(() => {
    const rows = sources.data ?? []
    const needle = search.trim().toLowerCase()
    return rows.filter((s) => {
      const state = classify(s)
      if (statusFilter !== "all" && state !== statusFilter) return false
      if (needle) {
        const hay = `${s.name} ${s.url}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [sources.data, statusFilter, search])

  // Click-to-sort state. Default sort = Name ASC. Clicking the same
  // column twice flips direction; clicking a different column resets
  // to ASC for the new key.
  type SortKey = "name" | "type" | "events" | "lastFetch" | "status"
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "name",
    dir: "asc",
  })
  const toggleSort = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    )

  // Sorted flat row list. Name is the tie-breaker so the table stays
  // stable when the primary sort key is coarse (Type / Status).
  const sortedRows = useMemo(() => {
    const decorated = filtered.map((s) => ({
      row: s,
      nameKey: s.name.toLowerCase(),
      typeKey: s.type,
      eventsKey: eventCounts.data?.[s._id as string] ?? 0,
      lastFetchKey: s.lastFetchedAt ?? 0,
      statusKey: classify(s),
    }))
    decorated.sort((a, b) => {
      let cmp = 0
      switch (sort.key) {
        case "name":
          cmp = a.nameKey.localeCompare(b.nameKey)
          break
        case "type":
          cmp = a.typeKey.localeCompare(b.typeKey)
          break
        case "events":
          cmp = a.eventsKey - b.eventsKey
          break
        case "lastFetch":
          cmp = a.lastFetchKey - b.lastFetchKey
          break
        case "status":
          cmp = a.statusKey.localeCompare(b.statusKey)
          break
      }
      if (cmp === 0) cmp = a.nameKey.localeCompare(b.nameKey)
      return sort.dir === "asc" ? cmp : -cmp
    })
    return decorated.map((d) => d.row)
  }, [filtered, sort, eventCounts.data])

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

  // Add-source form state. Single URL field; server probes the page,
  // picks the adapter type, derives a name, and runs an initial
  // fetch + drain. Status surfaces inline so the editor sees "added
  // with 12 items" / "blocked (Cloudflare)" / "fetched 0" without
  // bouncing to the row.
  const [addUrl, setAddUrl] = useState("")
  const [addResult, setAddResult] = useState<{
    name: string
    adapter: string
    blocked: boolean
    fetched: number
    error?: string
  } | null>(null)
  const smartAdd = useMutation({
    mutationFn: async (url: string) =>
      await convex.action(api.sources.smartAdd, { url }),
    onSuccess: (data) => {
      setAddResult({
        name: data.name,
        adapter: data.adapter,
        blocked: data.blocked,
        fetched: data.fetched,
        error: data.error,
      })
      setAddUrl("")
      refetch()
    },
  })

  const suggestions = useQuery(
    convexQuery(api.discovery.listSuggestions, {}),
  )

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

  const bulkRemove = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selected) as Array<Id<"sources">>
      await runOnAll(ids, (sourceId) =>
        convex.mutation(api.sourcesData.remove, { sourceId }),
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
              Fetch now
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={bulkRemove.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `Delete ${selected.size} source${
                      selected.size === 1 ? "" : "s"
                    }? Permanent.`,
                  )
                ) {
                  bulkRemove.mutate()
                }
              }}
            >
              <Trash2 /> Delete
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
            editing.
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

      {/* Add source — single URL input. Server probes the page, picks
          the adapter type, derives the name, then runs a test fetch
          so the new row shows up populated. */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const u = addUrl.trim()
          if (!u) return
          setAddResult(null)
          smartAdd.mutate(u)
        }}
        className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2"
      >
        <label className="meta text-xs">Add source</label>
        <input
          type="url"
          value={addUrl}
          onChange={(e) => setAddUrl(e.target.value)}
          placeholder="https://venue.example.com/events"
          className="flex-1 min-w-[16rem] rounded-md border bg-background px-2 py-1 text-sm"
          disabled={smartAdd.isPending}
        />
        <Button
          type="submit"
          size="sm"
          disabled={smartAdd.isPending || addUrl.trim().length === 0}
        >
          {smartAdd.isPending ? "Probing…" : "Add"}
        </Button>
        {addResult ? (
          <span className="meta text-xs">
            <span className="font-medium text-foreground">
              {addResult.name}
            </span>{" "}
            · <code className="font-mono">{addResult.adapter}</code> ·{" "}
            {addResult.blocked ? (
              <span className="text-destructive">
                blocked (try browser-extract)
              </span>
            ) : addResult.error ? (
              <span className="text-destructive">
                error: {addResult.error.slice(0, 60)}
              </span>
            ) : addResult.fetched > 0 ? (
              <span className="text-primary">
                fetched {addResult.fetched} items
              </span>
            ) : (
              <span className="text-muted-foreground">
                fetched 0 — check adapter
              </span>
            )}
          </span>
        ) : null}
      </form>

      {/* Discovery suggestions — domains we've seen in event citations
          that aren't yet on the sources table. One-click install via
          smartAdd; dismiss to hide. Pending only. */}
      {suggestions.data && suggestions.data.length > 0 ? (
        <details className="rounded-md border bg-card px-3 py-2 text-sm">
          <summary className="cursor-pointer">
            <span className="font-medium">
              {suggestions.data.length} discovered domain
              {suggestions.data.length === 1 ? "" : "s"}
            </span>{" "}
            <span className="meta text-xs">
              — citation URLs we've seen but haven't installed
            </span>
          </summary>
          <ul className="mt-2 space-y-1.5">
            {suggestions.data.slice(0, 20).map((s) => (
              <li
                key={s._id}
                className="flex flex-wrap items-center gap-2 border-t border-foreground/5 pt-1.5"
              >
                <span className="font-medium">{s.domain}</span>
                <span className="meta text-xs">
                  {s.eventCount} event{s.eventCount === 1 ? "" : "s"}
                </span>
                <a
                  href={s.sampleUrls[0]}
                  target="_blank"
                  rel="noreferrer"
                  className="meta text-xs hover:underline"
                >
                  preview ↗
                </a>
                <Button
                  size="xs"
                  variant="outline"
                  className="ml-auto"
                  disabled={smartAdd.isPending}
                  onClick={async () => {
                    smartAdd.mutate(`https://${s.domain}/`)
                  }}
                >
                  Install
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={async () => {
                    await convex.mutation(
                      api.discovery.dismissSuggestion,
                      { suggestionId: s._id },
                    )
                    queryClient.invalidateQueries({
                      queryKey: convexQuery(
                        api.discovery.listSuggestions,
                        {},
                      ).queryKey,
                    })
                  }}
                >
                  Dismiss
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

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
        <span className="meta ml-auto text-xs">
          Showing {filtered.length} of {totals.all}
        </span>
      </div>

      {sources.data === undefined ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableBody>
              <TableLoadingRows rows={6} cols={7} />
            </TableBody>
          </Table>
        </div>
      ) : sortedRows.length === 0 ? (
        <p className="meta">No sources match these filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all sources"
                    checked={allSelected}
                    onCheckedChange={() => toggleAll()}
                  />
                </TableHead>
                <SortableHead
                  className="w-8"
                  sortKey="status"
                  current={sort}
                  onSort={toggleSort}
                  ariaLabel="Sort by status"
                />
                <SortableHead
                  sortKey="name"
                  current={sort}
                  onSort={toggleSort}
                >
                  Source
                </SortableHead>
                <SortableHead
                  className="hidden md:table-cell"
                  sortKey="type"
                  current={sort}
                  onSort={toggleSort}
                >
                  Type
                </SortableHead>
                <SortableHead
                  className="hidden md:table-cell text-right"
                  sortKey="events"
                  current={sort}
                  onSort={toggleSort}
                >
                  Events
                </SortableHead>
                <SortableHead
                  className="hidden md:table-cell"
                  sortKey="lastFetch"
                  current={sort}
                  onSort={toggleSort}
                >
                  Last fetch
                </SortableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.map((s) => {
                    const id = s._id as string
                    const isSelected = selected.has(id)
                    const isPending =
                      testFetch.isPending && testFetch.variables === s._id
                    const state = classify(s)
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
                            href={
                              s.url.startsWith("http") ? s.url : undefined
                            }
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
                        <TableCell className="hidden md:table-cell text-right tabular-nums text-xs">
                          {eventCounts.data === undefined ? (
                            <span className="meta text-muted-foreground/60">
                              …
                            </span>
                          ) : (
                            <span
                              className={cn(
                                "font-medium",
                                (eventCounts.data[id] ?? 0) === 0
                                  ? "text-muted-foreground/60"
                                  : "text-foreground",
                              )}
                            >
                              {eventCounts.data[id] ?? 0}
                            </span>
                          )}
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
                              aria-label="Fetch now"
                              title="Fetch now — pulls items and immediately drains them into events"
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
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

// Clickable column header. Renders the label, an indicator arrow
// when this column is the active sort, and toggles direction on
// click. Pure presentational — the parent owns the `sort` state.
function SortableHead<K extends string>({
  sortKey,
  current,
  onSort,
  className,
  children,
  ariaLabel,
}: {
  sortKey: K
  current: { key: K; dir: "asc" | "desc" }
  onSort: (key: K) => void
  className?: string
  children?: React.ReactNode
  ariaLabel?: string
}) {
  const isActive = current.key === sortKey
  const arrow = isActive ? (current.dir === "asc" ? "▲" : "▼") : ""
  return (
    <TableHead className={className}>
      <button
        type="button"
        aria-label={ariaLabel ?? `Sort by ${String(sortKey)}`}
        aria-sort={
          isActive
            ? current.dir === "asc"
              ? "ascending"
              : "descending"
            : "none"
        }
        onClick={() => onSort(sortKey)}
        className="-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-muted focus-visible:bg-muted"
      >
        {children}
        {arrow ? (
          <span className="text-[0.65rem] text-muted-foreground">
            {arrow}
          </span>
        ) : null}
      </button>
    </TableHead>
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

