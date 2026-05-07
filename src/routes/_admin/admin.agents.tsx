import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import { useConvex } from "convex/react"
import { Loader2, Pencil, Play } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { TableLoadingRows } from "@/components/editorial/story-card-skeleton"
import { Badge } from "@/components/ui/badge"
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

export const Route = createFileRoute("/_admin/admin/agents")({
  component: AgentsPage,
})

function AgentsPage() {
  const convex = useConvex()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { data } = useQuery(convexQuery(api.agentsData.list, {}))
  // Per-desk pending state so multiple desks can run in parallel.
  const [running, setRunning] = useState<Set<string>>(new Set())

  const visibleIds = useMemo(
    () => (data ?? []).map((a) => a._id as string),
    [data],
  )
  const { selected, allSelected, someSelected, toggleAll, toggleOne, clear } =
    useBulkSelection(visibleIds)

  const refetch = () => {
    queryClient.invalidateQueries({
      queryKey: convexQuery(api.agentsData.list, {}).queryKey,
    })
    queryClient.invalidateQueries({
      queryKey: convexQuery(api.articles.latest, { limit: 6 }).queryKey,
    })
  }

  const runDesk = useMutation({
    mutationFn: async (slug: string) => {
      setRunning((prev) => new Set(prev).add(slug))
      try {
        const result = await convex.action(api.agents.runDesk, {
          agentSlug: slug,
        })
        return { ...result, slug }
      } finally {
        setRunning((prev) => {
          const next = new Set(prev)
          next.delete(slug)
          return next
        })
      }
    },
    onSuccess: (result) => {
      refetch()
      const deskName =
        data?.find((a) => a.slug === result.slug)?.name ?? result.slug
      if (result.error) {
        toast.error(`${deskName} failed`, { description: result.error })
        return
      }
      if (result.draftsCreated === 0) {
        toast(`${deskName}: no drafts produced`, {
          description: `Considered ${result.itemsConsidered} items. Try expanding the lookback window.`,
        })
        return
      }
      toast.success(
        `${deskName} drafted ${result.draftsCreated} ${
          result.draftsCreated === 1 ? "story" : "stories"
        }`,
        {
          description: `From ${result.itemsConsidered} candidate items.`,
          action: {
            label: "View queue →",
            onClick: () => navigate({ to: "/admin/published" }),
          },
        },
      )
    },
    onError: (err) => {
      toast.error("Run failed", {
        description: err instanceof Error ? err.message : String(err),
      })
    },
  })

  const bulkRun = useMutation({
    mutationFn: async () => {
      const slugs =
        data?.filter((a) => selected.has(a._id)).map((a) => a.slug) ??
        []
      setRunning((prev) => new Set([...prev, ...slugs]))
      try {
        const results = await Promise.all(
          slugs.map(async (slug) => {
            try {
              const r = await convex.action(api.agents.runDesk, {
                agentSlug: slug,
              })
              return { slug, ok: true, drafts: r.draftsCreated, error: r.error }
            } catch (e) {
              return {
                slug,
                ok: false,
                drafts: 0,
                error: e instanceof Error ? e.message : String(e),
              }
            }
          }),
        )
        return results
      } finally {
        setRunning((prev) => {
          const next = new Set(prev)
          slugs.forEach((s) => next.delete(s))
          return next
        })
      }
    },
    onSuccess: (results) => {
      clear()
      refetch()
      const totalDrafts = results.reduce((n, r) => n + r.drafts, 0)
      const failures = results.filter((r) => !r.ok || r.error).length
      if (failures > 0) {
        toast.warning(
          `${results.length - failures}/${results.length} desks ran`,
          { description: `${totalDrafts} drafts · ${failures} failed` },
        )
      } else {
        toast.success(
          `${results.length} ${results.length === 1 ? "desk" : "desks"} ran`,
          {
            description: `${totalDrafts} drafts created.`,
            action: {
              label: "View queue →",
              onClick: () => navigate({ to: "/admin/published" }),
            },
          },
        )
      }
    },
  })

  const bulkSetEnabled = useMutation({
    mutationFn: async (enabled: boolean) => {
      const ids = Array.from(selected) as Array<Id<"agents">>
      await runOnAll(ids, (agentId) =>
        convex.mutation(api.agentsData.updatePrompt, { agentId, enabled }),
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
            Desks
          </h1>
          <p className="meta mt-1">
            Run a desk; drafts land in the review queue.
          </p>
        </div>
        {someSelected ? (
          <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 animate-in fade-in-0 slide-in-from-top-1 duration-200 ease-out">
            <span className="meta text-xs">{selected.size} selected</span>
            <Button
              size="sm"
              variant="default"
              disabled={bulkRun.isPending}
              onClick={() => bulkRun.mutate()}
            >
              {bulkRun.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Play />
              )}{" "}
              Run desks
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

      {data && data.length === 0 ? (
        <p className="meta">No desks configured.</p>
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
                <TableHead>Desk</TableHead>
                <TableHead className="hidden md:table-cell">Section</TableHead>
                <TableHead className="hidden lg:table-cell">Model</TableHead>
                <TableHead className="hidden lg:table-cell text-right">
                  Lookback
                </TableHead>
                <TableHead className="hidden md:table-cell">Last run</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data === undefined ? (
                <TableLoadingRows rows={6} cols={8} />
              ) : (
                data.map((agent) => {
                  const id = agent._id as string
                  const isSelected = selected.has(id)
                  const isRunning = running.has(agent.slug)
                  return (
                    <TableRow
                      key={agent._id}
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
                          to: "/admin/agents/$slug",
                          params: { slug: agent.slug },
                        })
                      }}
                    >
                      <TableCell>
                        <Checkbox
                          aria-label={`Select ${agent.name}`}
                          checked={isSelected}
                          onCheckedChange={() => toggleOne(id)}
                        />
                      </TableCell>
                      <TableCell>
                        <Link
                          to="/admin/agents/$slug"
                          params={{ slug: agent.slug }}
                          className="font-medium hover:underline"
                        >
                          {agent.name}
                        </Link>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {agent.section ? (
                          <span
                            className="kicker text-[0.65rem]"
                            style={{ color: agent.section.accentColor }}
                          >
                            {agent.section.name}
                          </span>
                        ) : (
                          <span className="meta">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell font-mono text-xs">
                        {agent.model}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-right tabular-nums text-xs">
                        {agent.lookbackHours}h
                      </TableCell>
                      <TableCell className="hidden md:table-cell meta text-xs tabular-nums">
                        {agent.lastRunAt ? relativeTime(agent.lastRunAt) : "Never"}
                      </TableCell>
                      <TableCell>
                        {agent.enabled ? (
                          <Badge className="text-[0.65rem]">enabled</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[0.65rem]">
                            disabled
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Run desk"
                            title="Run desk — pulls fresh items, drafts new stories"
                            disabled={isRunning}
                            onClick={() => runDesk.mutate(agent.slug)}
                          >
                            {isRunning ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <Play />
                            )}
                          </Button>
                          <Link
                            to="/admin/agents/$slug"
                            params={{ slug: agent.slug }}
                            aria-label="Edit desk"
                            title="Edit desk"
                            className={buttonVariants({
                              size: "icon-sm",
                              variant: "ghost",
                            })}
                          >
                            <Pencil />
                          </Link>
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
