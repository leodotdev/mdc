import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useConvex } from "convex/react"
import { useEffect, useState } from "react"

import { api } from "../../../convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { formatDateTime } from "@/lib/dates"

export const Route = createFileRoute("/_admin/admin/agents/$slug")({
  component: AgentDetailPage,
})

function AgentDetailPage() {
  const { slug } = Route.useParams()
  const convex = useConvex()
  const queryClient = useQueryClient()
  const { data: agent } = useQuery(
    convexQuery(api.agentsData.getBySlug, { slug }),
  )
  const { data: runs } = useQuery({
    ...convexQuery(api.agentRuns.recentForAgent, {
      agentId: agent?._id ?? ("" as never),
      limit: 20,
    }),
    enabled: !!agent,
  })

  const [systemPrompt, setSystemPrompt] = useState("")
  const [model, setModel] = useState("")
  const [lookback, setLookback] = useState(24)
  const [maxItems, setMaxItems] = useState(30)
  const [maxDrafts, setMaxDrafts] = useState(4)

  useEffect(() => {
    if (agent) {
      setSystemPrompt(agent.systemPrompt)
      setModel(agent.model)
      setLookback(agent.lookbackHours)
      setMaxItems(agent.maxItemsPerRun)
      setMaxDrafts(agent.maxDraftsPerRun)
    }
  }, [agent])

  const save = useMutation({
    mutationFn: async () => {
      if (!agent) return
      await convex.mutation(api.agentsData.updatePrompt, {
        agentId: agent._id,
        systemPrompt,
        model,
        lookbackHours: lookback,
        maxItemsPerRun: maxItems,
        maxDraftsPerRun: maxDrafts,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: convexQuery(api.agentsData.getBySlug, { slug }).queryKey,
      })
    },
  })

  if (!agent) return <p className="meta">Loading…</p>

  return (
    <div className="flex flex-col gap-8">
      <header>
        <Link to="/admin/agents" className="meta hover:underline">
          ← All desks
        </Link>
        <h1 className="font-sans mt-2 text-3xl font-semibold">
          {agent.name}
        </h1>
      </header>

      <section className="rounded-md border bg-card p-5">
        <h2 className="kicker mb-3">Configuration</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label>Model</Label>
            <Input value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Lookback (hours)</Label>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={720}
              value={lookback}
              onChange={(e) => setLookback(Number(e.target.value))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Max items / run</Label>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={500}
              value={maxItems}
              onChange={(e) => setMaxItems(Number(e.target.value))}
            />
          </div>
          <div className="flex flex-col gap-1.5 md:col-span-3">
            <Label>System prompt</Label>
            <Textarea
              rows={10}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Max drafts / run</Label>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={20}
              value={maxDrafts}
              onChange={(e) => setMaxDrafts(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="mt-4">
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </section>

      <section>
        <h2 className="kicker mb-3">Recent runs</h2>
        {!runs || runs.length === 0 ? (
          <p className="meta">No runs yet.</p>
        ) : (
          <ul className="divide-y border-t border-b">
            {runs.map((r) => (
              <li key={r._id} className="py-3">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-xs text-muted-foreground tabular-nums">
                    {formatDateTime(r.startedAt)}
                  </p>
                  <span
                    className={
                      r.status === "succeeded"
                        ? "text-sm"
                        : r.status === "failed"
                          ? "text-sm text-destructive"
                          : "text-sm text-muted-foreground"
                    }
                  >
                    {r.status}
                  </span>
                </div>
                <p className="text-sm">
                  Considered {r.itemsConsidered}, drafted {r.draftsCreated}
                </p>
                {r.errorMessage ? (
                  <p className="mt-1 text-sm text-destructive">
                    {r.errorMessage}
                  </p>
                ) : null}
                {r.log.length > 0 ? (
                  <details className="mt-1 text-xs">
                    <summary className="meta cursor-pointer">Log</summary>
                    <pre className="mt-2 overflow-x-auto rounded bg-muted p-3 font-mono text-[0.7rem]">
                      {r.log.join("\n")}
                    </pre>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
