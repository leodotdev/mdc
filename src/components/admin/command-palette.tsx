import { useNavigate } from "@tanstack/react-router"
import { useConvex } from "convex/react"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"

import { api } from "../../../convex/_generated/api"

// Cmd+K palette across /admin. Common operator workflows boiled down
// to one keystroke + a typed query: fetch silent sources, approve
// high-confidence events, delete blocked sources, jump to any admin
// route. Each command is a thin shim over the backend mutations
// already shipped in adminOps.ts + the existing public APIs.

type Command = {
  id: string
  label: string
  hint?: string
  run: () => Promise<void> | void
}

export function AdminCommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const navigate = useNavigate()
  const convex = useConvex()
  const queryClient = useQueryClient()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isCmd = e.metaKey || e.ctrlKey
      if (isCmd && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((v) => !v)
        setQuery("")
        return
      }
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Toast auto-clear so completion messages don't linger.
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const runner = async (
    id: string,
    label: string,
    fn: () => Promise<unknown>,
  ) => {
    setBusy(id)
    try {
      const result = await fn()
      setToast(`${label} — ${formatResult(result)}`)
      // Most ops change source/event state; invalidate everything so
      // visible queries pick up the changes immediately.
      void queryClient.invalidateQueries()
    } catch (err) {
      setToast(
        `${label} failed: ${
          err instanceof Error ? err.message.slice(0, 100) : String(err)
        }`,
      )
    } finally {
      setBusy(null)
      setOpen(false)
    }
  }

  const commands = useMemo<Array<Command>>(() => {
    return [
      {
        id: "fetch-silent",
        label: "Fetch all silent sources",
        hint: "Re-runs the adapter on every enabled source with 0 last-fetch items",
        run: () =>
          runner("fetch-silent", "Fetch silent", () =>
            convex.action(api.adminOps.fetchAllSilent, {}),
          ),
      },
      {
        id: "delete-blocked",
        label: "Delete blocked sources",
        hint: "Removes every source whose last fetch hit a Cloudflare / anti-bot wall",
        run: () =>
          runner("delete-blocked", "Delete blocked", () =>
            convex.action(api.adminOps.deleteBlocked, {}),
          ),
      },
      {
        id: "reclassify",
        label: "Re-classify all events",
        hint: "Re-runs the section classifier (picks up new taxonomy rules)",
        run: () =>
          runner("reclassify", "Re-classify", () =>
            convex.action(api.adminOps.reclassifyAll, {}),
          ),
      },
      {
        id: "run-ingest",
        label: "Run ingest now",
        hint: "Force-fires cronRunMegaDesk — fans out source refreshes + drain",
        run: () =>
          runner("run-ingest", "Run ingest", () =>
            convex.action(api.adminOps.runIngestNow, {}),
          ),
      },
      // Navigation
      ...(
        [
          ["go-dashboard", "Go to Dashboard", "/admin"],
          ["go-sources", "Go to Sources", "/admin/sources"],
          ["go-taxonomy", "Go to Taxonomy", "/admin/taxonomy"],
          ["go-runs", "Go to Runs", "/admin/runs"],
          ["go-published", "Go to Published", "/admin/published"],
        ] as const
      ).map(([id, label, to]) => ({
        id,
        label,
        hint: to,
        run: () => {
          setOpen(false)
          void navigate({ to })
        },
      })),
    ]
  }, [convex, navigate, queryClient])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((c) => c.label.toLowerCase().includes(q))
  }, [commands, query])

  return (
    <>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-24 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-xl overflow-hidden rounded-lg border border-foreground/15 bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && filtered[0]) {
                  void filtered[0].run()
                }
              }}
              placeholder="Type a command (or filter)…"
              className="w-full border-b bg-transparent px-4 py-3 text-sm outline-none"
            />
            <ul className="max-h-[60vh] overflow-y-auto">
              {filtered.length === 0 ? (
                <li className="px-4 py-3 text-sm text-muted-foreground">
                  No matching commands.
                </li>
              ) : (
                filtered.map((c) => {
                  const isBusy = busy === c.id
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          if (!isBusy) void c.run()
                        }}
                        disabled={isBusy}
                        className="flex w-full items-center justify-between gap-4 px-4 py-2.5 text-left text-sm hover:bg-muted disabled:opacity-50"
                      >
                        <span className="font-medium">{c.label}</span>
                        {c.hint ? (
                          <span className="meta truncate text-xs">
                            {isBusy ? "running…" : c.hint}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  )
                })
              )}
            </ul>
            <div className="border-t bg-muted/30 px-4 py-2 text-[0.65rem] text-muted-foreground">
              ↵ to run · Esc to close · ⌘K toggles
            </div>
          </div>
        </div>
      ) : null}
      {toast ? (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 max-w-md rounded-md border border-foreground/15 bg-card px-4 py-2 text-sm shadow-lg">
          {toast}
        </div>
      ) : null}
    </>
  )
}

function formatResult(result: unknown): string {
  if (!result || typeof result !== "object") return "done"
  const r = result as Record<string, unknown>
  const parts: Array<string> = []
  if (typeof r.refreshed === "number") parts.push(`${r.refreshed} refreshed`)
  if (typeof r.deleted === "number") parts.push(`${r.deleted} deleted`)
  if (typeof r.approved === "number") parts.push(`${r.approved} approved`)
  if (typeof r.moved === "number") parts.push(`${r.moved} moved`)
  if (typeof r.scanned === "number" && parts.length === 0)
    parts.push(`${r.scanned} scanned`)
  if (typeof r.summary === "string") parts.push(r.summary)
  return parts.length > 0 ? parts.join(", ") : "done"
}
