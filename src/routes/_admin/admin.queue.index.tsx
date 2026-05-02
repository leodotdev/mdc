import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import { useConvex } from "convex/react"
import {
  Archive,
  Check,
  CheckCheck,
  ImageOff,
  Pencil,
  X,
} from "lucide-react"
import { useMemo, useState } from "react"

import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { ImportanceGauge } from "@/components/editorial/importance-gauge"
import { TableRowSkeletonList } from "@/components/editorial/story-card-skeleton"
import { proxiedImageUrl } from "@/lib/image-proxy"
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

export const Route = createFileRoute("/_admin/admin/queue/")({
  component: QueueListPage,
})

function QueueListPage() {
  const navigate = useNavigate()
  const convex = useConvex()
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery(
    convexQuery(api.articles.reviewQueue, {}),
  )
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const visibleIds = useMemo(
    () => (data ?? []).map((a) => a._id as string),
    [data],
  )
  const allSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))
  const someSelected = visibleIds.some((id) => selected.has(id))

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(visibleIds))
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: convexQuery(api.articles.reviewQueue, {}).queryKey,
    })

  const publishOne = useMutation({
    mutationFn: async (id: Id<"articles">) =>
      convex.mutation(api.articles.publish, { id }),
    onSuccess: invalidate,
  })

  const rejectOne = useMutation({
    mutationFn: async (id: Id<"articles">) =>
      convex.mutation(api.articles.reject, { id }),
    onSuccess: invalidate,
  })

  const runBulk = (
    op: (id: Id<"articles">) => Promise<unknown>,
  ): (() => Promise<void>) => async () => {
    const ids = Array.from(selected) as Array<Id<"articles">>
    if (ids.length === 0) return
    await Promise.all(ids.map(op))
    setSelected(new Set())
    invalidate()
  }

  const bulkPublish = useMutation({
    mutationFn: runBulk((id) => convex.mutation(api.articles.publish, { id })),
  })
  const bulkReject = useMutation({
    mutationFn: runBulk((id) => convex.mutation(api.articles.reject, { id })),
  })
  const bulkArchive = useMutation({
    mutationFn: runBulk((id) => convex.mutation(api.articles.unpublish, { id })),
  })

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-[-0.02em]">
            Review queue
          </h1>
          <p className="meta mt-1">
            {data ? `${data.length} pending` : "Loading…"} · AI-drafted, awaiting your edit.
          </p>
        </div>
        {someSelected ? (
          <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 animate-in fade-in-0 slide-in-from-top-1 duration-200 ease-out">
            <span className="meta text-xs">{selected.size} selected</span>
            <Button
              size="sm"
              variant="default"
              disabled={bulkPublish.isPending}
              onClick={() => bulkPublish.mutate()}
            >
              <CheckCheck /> Publish
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={bulkArchive.isPending}
              onClick={() => bulkArchive.mutate()}
            >
              <Archive /> Archive
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={bulkReject.isPending}
              onClick={() => bulkReject.mutate()}
            >
              <X /> Reject
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </Button>
          </div>
        ) : null}
      </header>

      {isLoading ? (
        <TableRowSkeletonList rows={6} />
      ) : !data || data.length === 0 ? (
        <div className="rounded-md border bg-card p-6">
          <p className="font-editorial">The queue is empty.</p>
          <p className="meta mt-1">
            Trigger a desk run from{" "}
            <Link to="/admin/agents" className="underline">
              Agents
            </Link>
            .
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
                <TableHead>Story</TableHead>
                <TableHead className="hidden md:table-cell">Section</TableHead>
                <TableHead className="hidden lg:table-cell">Desk</TableHead>
                <TableHead className="hidden lg:table-cell">Sources</TableHead>
                <TableHead className="hidden md:table-cell">Importance</TableHead>
                <TableHead className="hidden md:table-cell">Drafted</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((article) => {
                const id = article._id as string
                const isSelected = selected.has(id)
                return (
                  <TableRow
                    key={id}
                    data-state={isSelected ? "selected" : undefined}
                    className="cursor-pointer transition-colors duration-150 hover:bg-muted/50"
                    onClick={(e) => {
                      // Don't navigate if the click landed on a control
                      const target = e.target as HTMLElement
                      if (target.closest("input, button, a, [role='checkbox']"))
                        return
                      void navigate({
                        to: "/admin/queue/$id",
                        params: { id },
                      })
                    }}
                  >
                    <TableCell>
                      <Checkbox
                        aria-label={`Select ${article.title}`}
                        checked={isSelected}
                        onCheckedChange={() => toggleOne(id)}
                      />
                    </TableCell>
                    <TableCell>
                      {article.heroImage ? (
                        <img
                          src={proxiedImageUrl(article.heroImage, { width: 200 })}
                          alt=""
                          loading="lazy"
                          className="h-12 w-16 rounded object-cover"
                        />
                      ) : (
                        <div className="flex h-12 w-16 items-center justify-center rounded bg-muted text-muted-foreground">
                          <ImageOff className="h-4 w-4" />
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="max-w-md whitespace-normal">
                      <div className="font-heading text-base font-semibold leading-tight">
                        {article.title}
                      </div>
                      <div className="font-editorial text-sm text-muted-foreground ">
                        {article.dek}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {article.section ? (
                        <span
                          className="kicker text-[0.65rem]"
                          style={{ color: article.section.accentColor }}
                        >
                          {article.section.name}
                        </span>
                      ) : (
                        <span className="meta">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {article.agentSlug ? (
                        <Badge variant="secondary" className="text-[0.65rem]">
                          {article.agentSlug}
                        </Badge>
                      ) : (
                        <span className="meta">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell meta text-xs">
                      {article.citations.length}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <ImportanceGauge
                        article={article}
                        accent={article.section?.accentColor}
                      />
                    </TableCell>
                    <TableCell className="hidden md:table-cell meta text-xs tabular-nums">
                      {relativeTime(article.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Edit"
                          title="Edit"
                          onClick={() =>
                            navigate({
                              to: "/admin/queue/$id",
                              params: { id },
                            })
                          }
                        >
                          <Pencil />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Publish"
                          title="Publish"
                          disabled={publishOne.isPending}
                          onClick={() =>
                            publishOne.mutate(article._id)
                          }
                        >
                          <Check />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Reject"
                          title="Reject"
                          disabled={rejectOne.isPending}
                          onClick={() => rejectOne.mutate(article._id)}
                        >
                          <X />
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
