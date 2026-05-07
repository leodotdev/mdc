import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useConvex } from "convex/react"
import { Loader2, Power, RefreshCw } from "lucide-react"
import { useMemo } from "react"

import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
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

function StatusDot({ status }: { status: string | undefined }) {
  if (!status) {
    return (
      <span
        aria-label="Never fetched"
        title="Never fetched"
        className="inline-block size-2 shrink-0 rounded-full bg-muted-foreground/40"
      />
    )
  }
  const ok = status === "ok"
  return (
    <span
      aria-label={ok ? "Healthy" : `Error: ${status}`}
      title={ok ? "Healthy" : status}
      className="inline-block size-2 shrink-0 rounded-full"
      style={{
        background: ok ? "var(--primary)" : "var(--destructive)",
      }}
    />
  )
}

function SourcesPage() {
  const convex = useConvex()
  const queryClient = useQueryClient()
  const sources = useQuery(convexQuery(api.sourcesData.list, {}))

  const visibleIds = useMemo(
    () => (sources.data ?? []).map((s) => s._id as string),
    [sources.data],
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
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-sans text-3xl font-semibold tracking-[-0.02em]">
            Sources
          </h1>
          <p className="meta mt-1">
            Defined in <code className="font-mono">convex/seed.ts</code> — run{" "}
            <code className="font-mono">npx convex run seed:run</code> after
            editing. Use this page to verify each source fetches and to
            enable/disable on the fly.
          </p>
        </div>
        {someSelected ? (
          <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 animate-in fade-in-0 slide-in-from-top-1 duration-200 ease-out">
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
        ) : null}
      </header>

      {sources.data && sources.data.length === 0 ? (
        <p className="meta">No sources yet.</p>
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
                <TableHead className="w-8" />
                <TableHead>Source</TableHead>
                <TableHead className="hidden md:table-cell">Type</TableHead>
                <TableHead className="hidden md:table-cell">Status</TableHead>
                <TableHead className="hidden lg:table-cell">Last fetch</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.data === undefined ? (
                <TableLoadingRows rows={6} cols={7} />
              ) : (
                sources.data.map((s) => {
                  const id = s._id as string
                  const isSelected = selected.has(id)
                  const isPending =
                    testFetch.isPending && testFetch.variables === s._id
                  const isToggling =
                    setEnabled.isPending &&
                    setEnabled.variables?.sourceId === s._id
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
                        <StatusDot status={s.lastFetchStatus} />
                      </TableCell>
                      <TableCell className="max-w-md whitespace-normal">
                        <div className="font-medium">{s.name}</div>
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
                      <TableCell className="hidden md:table-cell">
                        {s.enabled ? (
                          <Badge className="text-[0.65rem]">enabled</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[0.65rem]">
                            disabled
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell meta text-xs tabular-nums">
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
                              <span className="ml-1 text-destructive ">
                                — {s.lastFetchError}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="meta">Never</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
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

