import { v } from "convex/values"
import { api, internal } from "./_generated/api"
import { action, internalAction } from "./_generated/server"
import { fetchItems } from "./lib/adapters"
import { cronsEnabled } from "./lib/cronGate"
import { requireEditorInAction } from "./lib/guard"
import { firstSentence } from "./lib/firstSentence"
import { defaultFreeForSourceUrl } from "./lib/priceExtract"
import type { Id } from "./_generated/dataModel"

// Tags that add no signal (every story is local to Miami-Dade by definition).
// Stripped from every draft before insert so they never reach the public site
// even if the LLM ignores the prompt instruction.
// Stored in canonical (post-`normalizeTag`) form so the lookup is a
// simple `Set.has` after the input is normalized.
const REDUNDANT_TAGS = new Set([
  "miami",
  "miami-dade",
  "miamidade",
])

// Canonical tag form: lowercase, hyphen-separated, no leading/trailing
// or repeated hyphens, no other punctuation. Applied at every write
// path so the tag set stays consistent across the schema regardless of
// what the LLM emits or what an editor types into the form. Empty
// inputs return "".
export function normalizeTag(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

// Apply `normalizeTag` to every entry, drop empties + duplicates +
// known-redundant terms (Miami-Dade etc. — covered by the section
// metadata, no need to tag every story with them).
export function cleanTags(tags: ReadonlyArray<string>): Array<string> {
  const seen = new Set<string>()
  const out: Array<string> = []
  for (const raw of tags) {
    const t = normalizeTag(raw)
    if (!t) continue
    if (REDUNDANT_TAGS.has(t)) continue
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

// ============================================================================
// Event ingest — single agent ("miami-desk") owns the deterministic
// fetch → filter → insert pipeline. No LLM rewrite; the per-event
// Haiku enrichment + ES translation hooks run separately and are
// budget-gated. The agent slug is kept to preserve agentRuns history
// and the admin "Run desk" entry point.
// ============================================================================

const MEGA_DESK_SLUG = "miami-desk"
// Item firehose cap per ingest tick. Bounds how many ingestedItems
// the deterministic loop scans before stopping.
const MEGA_MAX_ITEMS = 50
// Default ingest lookback window — 12h focuses on truly fresh items;
// older unconsumed ones get drained on subsequent ticks.
const MEGA_DEFAULT_LOOKBACK_HOURS = 12
// Deterministic event-ingest pipeline — no LLM rewrite. Reads
// structured event fields from `ingestedItems` (populated by ICS /
// JSON-LD / sitemap adapters), copies them verbatim into the events
// table, and assigns the source's first declared section as the home.
//
// What's gone vs. the mega-desk:
// - No title / description / dek / body LLM rewrite — text is the
//   venue's own copy.
// - No LLM section / tag / neighborhood inference — section comes
//   from the source's sectionIds[], tags + neighborhoods start empty
//   and get filled by the bulkEnrichEventsInternal backfill cron.
// - No related-event LLM linking, no rubric grader, no hero search.
//   Hero is the source's `mediaUrl` if it shipped one, otherwise none.
//
// Items lacking `startsAt` (no "when") OR `locationName` /
// `locationAddress` (no "where") get marked consumed and skipped —
// they're news-shaped, not event-shaped.
//
// Budget: this pass is FREE (no LLM call). The downstream
// translation + enrichment crons are budget-gated and gracefully
// degrade — events still ingest with empty tags / no ES when the cap
// hits; next day's backfill catches up.
export const runEventIngestInternal = internalAction({
  args: { lookbackHoursOverride: v.optional(v.number()) },
  handler: async (
    ctx,
    { lookbackHoursOverride },
  ): Promise<{
    runId: Id<"agentRuns"> | null
    itemsConsidered: number
    eventsCreated: number
    skipped: number
    error?: string
  }> => {
    const agent = await ctx.runQuery(api.agentsData.getBySlug, {
      slug: MEGA_DESK_SLUG,
    })
    if (!agent) {
      throw new Error(
        `Mega desk "${MEGA_DESK_SLUG}" not found — run seed:seedMegaDesk to install it.`,
      )
    }
    const lookbackHours =
      lookbackHoursOverride ?? agent.lookbackHours ?? MEGA_DEFAULT_LOOKBACK_HOURS
    const runId = await ctx.runMutation(api.agentsData.startRun, {
      agentId: agent._id,
    })
    const log = (line: string) =>
      ctx.runMutation(api.agentsData.appendLog, { runId, line })

    let itemsConsidered = 0
    let eventsCreated = 0
    let skipped = 0

    try {
      // 1. Refresh every enabled source. Same logic as the mega-desk —
      //    network IO only, no LLM, so we always tick every source.
      const sources = await ctx.runQuery(internal.sourcesData.listInternal, {})
      const enabled = sources.filter((s) => s.enabled)
      const sourceById = new Map(enabled.map((s) => [s._id as string, s]))
      await log(`Refreshing ${enabled.length} sources`)
      for (const src of enabled) {
        if (src.type === "data") continue
        try {
          const items = await fetchItems({
            type: src.type,
            url: src.url,
            config: src.config,
          })
          const result = await ctx.runMutation(api.sourcesData.recordFetch, {
            sourceId: src._id,
            items,
            status: "ok",
          })
          await log(
            `[${src.name}] fetched ${items.length}, new ${result.inserted}`,
          )
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          await ctx.runMutation(api.sourcesData.recordFetch, {
            sourceId: src._id,
            items: [],
            status: "error",
            error: msg,
          })
          await log(`[${src.name}] FAILED: ${msg}`)
        }
      }

      // 2. Pull unconsumed items + filter to event-shaped only.
      const sinceMs = Date.now() - lookbackHours * 3_600_000
      const candidates = await ctx.runQuery(
        api.agentsData.unconsumedItemsAll,
        { sinceMs, limit: MEGA_MAX_ITEMS },
      )
      itemsConsidered = candidates.length
      await log(`Selected ${candidates.length} unconsumed items`)

      // 3. Section fallback when the source declared no sectionIds.
      const allSections = await ctx.runQuery(api.sections.list, {})
      const fallbackSectionId =
        allSections.find((s) => s.slug === "politics")?._id ??
        allSections[0]?._id
      if (!fallbackSectionId) {
        throw new Error("No sections configured — cannot insert events")
      }

      const consumedIds: Array<Id<"ingestedItems">> = []
      for (const c of candidates) {
        consumedIds.push(c.item._id)
        // Event-shape filter: must have both a "when" and a "where".
        // Adapters that yield news-shaped content (RSS, reddit) leave
        // these undefined; those items get marked consumed below
        // without producing an event.
        const startsAt = c.item.startsAt
        const where = c.item.locationName ?? c.item.locationAddress
        if (!startsAt || !where) {
          skipped += 1
          continue
        }
        const src = sourceById.get(c.item.sourceId as unknown as string)
        const sectionId =
          (src?.sectionIds && src.sectionIds[0]) ?? fallbackSectionId

        try {
          await ctx.runMutation(internal.events.insertExtracted, {
            event: {
              slug: slugify(c.item.title),
              title: c.item.title,
              // Single 1-sentence dek replaces the long description.
              // Renderer reads `dek`; `description` is kept empty for
              // schema compatibility (still a required field) until a
              // future narrow can drop it entirely.
              description: "",
              dek: firstSentence(c.item.snippet ?? c.item.body),
              kind: "scheduled",
              startsAt,
              endsAt: c.item.endsAt,
              allDay: c.item.allDay ?? false,
              locationName: c.item.locationName,
              locationAddress: c.item.locationAddress,
              // Adapter-provided price wins; otherwise default to
              // "Free" when the source URL is a known-free venue
              // pattern (.gov / library / school district).
              price:
                c.item.price ?? defaultFreeForSourceUrl(src?.url),
              recurrenceRule: c.item.recurrenceRule,
              url: c.item.url,
              heroImage: c.item.mediaUrl,
              heroSource: c.item.mediaUrl ? "source" : "none",
              sectionId,
              tags: [],
              neighborhoods: [],
              citations: [
                {
                  url: c.item.url,
                  title: c.item.title,
                  publisher: c.sourceName,
                  fetchedAt: c.item.fetchedAt,
                  snippet: c.item.snippet,
                },
              ],
            },
            agentSlug: MEGA_DESK_SLUG,
            agentRunId: runId,
            derivedFromItems: [c.item._id],
          })
          eventsCreated += 1
        } catch (e) {
          await log(
            `Skipped "${c.item.title}": ${e instanceof Error ? e.message : String(e)}`,
          )
        }
      }
      // Mark every candidate consumed — whether it became an event
      // or got skipped as news-shaped. They don't recycle on the queue.
      if (consumedIds.length > 0) {
        await ctx.runMutation(api.agentsData.markItemsConsumed, {
          itemIds: consumedIds,
        })
      }
      await log(
        `Created ${eventsCreated} events, skipped ${skipped} non-event items`,
      )

      await ctx.runMutation(api.agentsData.finishRun, {
        runId,
        status: "succeeded",
        itemsConsidered,
        draftsCreated: eventsCreated,
      })
      return { runId, itemsConsidered, eventsCreated, skipped }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await log(`FAILED: ${msg}`)
      await ctx.runMutation(api.agentsData.finishRun, {
        runId,
        status: "failed",
        itemsConsidered,
        draftsCreated: eventsCreated,
        errorMessage: msg,
      })
      return {
        runId,
        itemsConsidered,
        eventsCreated,
        skipped,
        error: msg,
      }
    }
  },
})

// Public mega-desk action — editor-triggered "Run desk" button.
// Editor-gated, not just authenticated: any signed-in user could
// otherwise force an Opus call and burn the daily budget.
export const runMegaDesk = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    runId: Id<"agentRuns"> | null
    itemsConsidered: number
    draftsCreated: number
    eventsCreated: number
    error?: string
  }> => {
    await requireEditorInAction(ctx)
    const r = await ctx.runAction(internal.agents.runEventIngestInternal, {})
    // Map the deterministic pipeline's return shape onto the legacy
    // mega-desk shape so the admin dashboard's "Run desk" button +
    // toasts keep working without a frontend change. `draftsCreated`
    // mirrors `eventsCreated` (no draft/event split any more).
    return {
      runId: r.runId,
      itemsConsidered: r.itemsConsidered,
      draftsCreated: r.eventsCreated,
      eventsCreated: r.eventsCreated,
      error: r.error,
    }
  },
})

// Cron tick — fires on the cron schedule (every 1 hour). Gated by:
//   - `CRONS_ENABLED` so the dev deployment doesn't double-bill the
//     Anthropic key.
//   - Quiet-hours window: 12am-5am Miami time (5 ticks/day) skips
//     because there's almost no fresh local content overnight and
//     each tick costs ~30¢. Saves ~20% of daily spend with negligible
//     editorial impact — the morning's first tick at 6am ET catches
//     anything that did publish overnight.
//
// Manual "Run now" through /admin uses `runMegaDesk` (public action)
// and bypasses both gates.
const QUIET_HOURS_START = 0 // 12am Miami time, inclusive
const QUIET_HOURS_END = 5 // 5am Miami time, exclusive

function miamiHour(): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
  )
}

export const cronRunMegaDesk = internalAction({
  args: {},
  handler: async (ctx): Promise<{ summary: string }> => {
    if (!cronsEnabled()) {
      return { summary: "ingest: skipped — CRONS_ENABLED not set" }
    }
    // Quiet hours don't really save money any more (the ingest pass is
    // LLM-free) but keeping the window lets translation backlog drain
    // overnight without competing for budget. Translation + enrichment
    // crons are separate and still tick during this window.
    const hour = miamiHour()
    if (hour >= QUIET_HOURS_START && hour < QUIET_HOURS_END) {
      return {
        summary: `ingest: skipped — quiet hours (${hour}:00 ET, resumes at ${QUIET_HOURS_END}:00 ET)`,
      }
    }
    const r = await ctx.runAction(internal.agents.runEventIngestInternal, {})
    if (r.error) return { summary: `ingest: ERROR ${r.error}` }
    return {
      summary: `ingest: ${r.eventsCreated} events from ${r.itemsConsidered} items (${r.skipped} non-event-shaped)`,
    }
  },
})

// Mega-desk backfill — widens lookback to N days for one run.
export const megaBackfill = action({
  args: { days: v.optional(v.number()) },
  handler: async (
    ctx,
    { days },
  ): Promise<{
    days: number
    draftsCreated: number
    eventsCreated: number
    itemsConsidered: number
    error?: string
  }> => {
    await requireEditorInAction(ctx)
    const totalDays = Math.max(1, Math.min(days ?? 30, 90))
    const r = await ctx.runAction(internal.agents.runEventIngestInternal, {
      lookbackHoursOverride: totalDays * 24,
    })
    return {
      days: totalDays,
      draftsCreated: r.eventsCreated,
      eventsCreated: r.eventsCreated,
      itemsConsidered: r.itemsConsidered,
      error: r.error,
    }
  },
})
