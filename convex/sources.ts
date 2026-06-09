import { v } from "convex/values"
import { getAuthUserId } from "@convex-dev/auth/server"
import {  fetchItems } from "./lib/adapters"
import { action } from "./_generated/server"
import { api, internal } from "./_generated/api"
import { probeUrl } from "./lib/sourceProbe"
import type {SourceForAdapter} from "./lib/adapters";

// Editor-facing wrapper around `probeUrl`. Used by the admin
// inline-URL edit form to pick the correct adapter type after a URL
// change, and by the smart-add form (#10) to install a source in one
// step. Auth-gated; SSRF guard runs in sourcesData.create / update
// before any source is persisted, so this action is only invoked
// with already-vetted URLs.
export const probe = action({
  args: { url: v.string() },
  handler: async (_ctx, { url }) => {
    return await probeUrl(url)
  },
})

// One-shot smart-add. Probes the URL, derives a name (probe's
// og:site_name → <title> → hostname), persists the source with the
// matched adapter, then runs a test fetch so the new row arrives
// pre-populated with last-fetch stats. Returns enough signal for the
// admin UI to surface "added but blocked" / "added but 0 items" /
// "added cleanly with N items" without a second round trip.
export const smartAdd = action({
  args: { url: v.string(), nameOverride: v.optional(v.string()) },
  handler: async (
    ctx,
    { url, nameOverride },
  ): Promise<{
    sourceId: string
    name: string
    adapter: string
    blocked: boolean
    fetched: number
    inserted: number
    error?: string
  }> => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error("Unauthenticated")
    const probed = await probeUrl(url)
    const name =
      nameOverride?.trim() ||
      probed.suggestedName?.trim() ||
      (() => {
        try {
          return new URL(url).hostname.replace(/^www\./, "")
        } catch {
          return url
        }
      })()
    const installed = await ctx.runMutation(
      api.sourcesData.installSourceEditor,
      {
        url,
        name,
        type: probed.adapter,
      },
    )
    const test = await ctx.runAction(api.sources.testFetch, {
      sourceId: installed.sourceId,
    })
    return {
      sourceId: installed.sourceId as string,
      name,
      adapter: probed.adapter,
      blocked: probed.blocked,
      fetched: test.fetched,
      inserted: test.inserted,
      error: test.error,
    }
  },
})

// Real fetch — fetches the source, records items, then immediately
// drains the ingest queue so the fetched items become live events.
// Same shape as the per-row admin action that used to be called
// `testFetch`: editors click and the new events land within seconds
// instead of waiting for the next cron tick. Internal name kept as
// `testFetch` so existing callers don't break; the UI relabels.
export const testFetch = action({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }): Promise<{
    fetched: number
    inserted: number
    eventsCreated: number
    error?: string
  }> => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error("Unauthenticated")

    const source = await ctx.runQuery(api.sourcesData.getForAdapter, {
      sourceId,
    })
    if (!source) throw new Error("Source not found")

    const adapterInput: SourceForAdapter = {
      type: source.type,
      url: source.url,
      config: source.config,
    }

    let fetched = 0
    let inserted = 0
    let error: string | undefined
    try {
      const items = await fetchItems(adapterInput)
      fetched = items.length
      const result = await ctx.runMutation(api.sourcesData.recordFetch, {
        sourceId,
        items,
        status: "ok",
      })
      inserted = result.inserted
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      await ctx.runMutation(api.sourcesData.recordFetch, {
        sourceId,
        items: [],
        status: "error",
        error,
      })
      return { fetched: 0, inserted: 0, eventsCreated: 0, error }
    }

    // Drain the ingest queue → events. Skips the source-fetch loop
    // since we just did the fetch ourselves.
    let eventsCreated = 0
    try {
      const drain = await ctx.runAction(
        internal.agents.runEventIngestInternal,
        { skipSourceFetch: true },
      )
      eventsCreated = drain.eventsCreated
    } catch (err) {
      // Surface the drain error but don't lose the fetch result —
      // items are already in the queue, the next cron will pick
      // them up if this drain failed.
      error = err instanceof Error ? err.message : String(err)
    }
    return { fetched, inserted, eventsCreated, error }
  },
})
