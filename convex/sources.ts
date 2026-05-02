import { v } from "convex/values"
import { getAuthUserId } from "@convex-dev/auth/server"
import {  fetchItems } from "./lib/adapters"
import { action } from "./_generated/server"
import { api } from "./_generated/api"
import type {SourceForAdapter} from "./lib/adapters";

export const testFetch = action({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }): Promise<{
    fetched: number
    inserted: number
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

    try {
      const items = await fetchItems(adapterInput)
      const result = await ctx.runMutation(api.sourcesData.recordFetch, {
        sourceId,
        items,
        status: "ok",
      })
      return { fetched: items.length, inserted: result.inserted }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await ctx.runMutation(api.sourcesData.recordFetch, {
        sourceId,
        items: [],
        status: "error",
        error: message,
      })
      return { fetched: 0, inserted: 0, error: message }
    }
  },
})
