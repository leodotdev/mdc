import { getAuthUserId } from "@convex-dev/auth/server"
import { v } from "convex/values"
import { api, internal } from "./_generated/api"
import { action, internalAction } from "./_generated/server"
import {  fetchItems } from "./lib/adapters"
import { fetchDataMetrics } from "./lib/dataAdapters"
import { estimatedCallCents } from "./lib/budget"
import { cronsEnabled } from "./lib/cronGate"
import { generateDrafts } from "./lib/llm"
import { resolveHero } from "./lib/media"
import { filterNeighborhoodSlugs } from "./lib/neighborhoods"
import type {SourceForAdapter} from "./lib/adapters";
import type { DraftItem, RelatedCandidate } from "./lib/llm"
import type { Id } from "./_generated/dataModel"
import type { FunctionReturnType } from "convex/server"

type Candidates = FunctionReturnType<
  typeof api.agentsData.unconsumedItemsForAgent
>

// Model tiering for the $20/month budget:
//   - Drafts: Sonnet 4.6 across the board (~$0.014/draft). Investigations
//     desk overrides via `agent.model` to opt up to Opus for the
//     hardest-to-write copy.
//   - Translation: Sonnet 4.6 (overridden in articles.ts / events.ts).
// Per-desk overrides are honored from the `agents.model` column when set;
// blank/missing → DEFAULT_MODEL.
const DEFAULT_MODEL = "claude-sonnet-4-6"

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

// Stories ship as exactly one paragraph. If the LLM ignores the prompt
// instruction and returns multiple paragraphs (separated by blank lines),
// keep only the first non-empty one and strip Markdown structural noise.
function toSingleParagraph(body: string): string {
  const firstBlock = body
    .split(/\n\s*\n+/)
    .map((s) => s.trim())
    .find((s) => s.length > 0)
  if (!firstBlock) return body.trim()
  // Collapse any single newlines inside the paragraph into spaces so we
  // really do return one continuous paragraph.
  return firstBlock.replace(/\s*\n\s*/g, " ").trim()
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

// Internal version — no auth check. Called by:
//   - The public `runDesk` action (after editor auth check), and
//   - The cron tick that fires every few hours.
// The cron path runs without an authenticated user, so the auth check
// lives one layer up in the public wrapper instead of here.
export const runDeskInternal = internalAction({
  args: {
    agentSlug: v.string(),
    // Optional override for the desk's `lookbackHours`. The 30-day
    // backfill uses this to widen the window without mutating the
    // agent row. Falls back to `agent.lookbackHours` when omitted.
    lookbackHoursOverride: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { agentSlug, lookbackHoursOverride },
  ): Promise<{
    runId: Id<"agentRuns">
    itemsConsidered: number
    draftsCreated: number
    error?: string
  }> => {

    const agent = await ctx.runQuery(api.agentsData.getBySlug, {
      slug: agentSlug,
    })
    if (!agent) throw new Error(`Agent "${agentSlug}" not found`)
    const effectiveLookbackHours =
      lookbackHoursOverride ?? agent.lookbackHours

    const runId = await ctx.runMutation(api.agentsData.startRun, {
      agentId: agent._id,
    })

    const log = (line: string) =>
      ctx.runMutation(api.agentsData.appendLog, { runId, line })

    let itemsConsidered = 0
    let draftsCreated = 0

    try {
      // 1. Fetch all enabled sources for this desk (refresh ingestedItems)
      const sources = await ctx.runQuery(
        api.agentsData.enabledSourcesForAgent,
        { agentId: agent._id },
      )
      await log(`Refreshing ${sources.length} sources`)
      for (const src of sources) {
        try {
          const adapterInput: SourceForAdapter = {
            type: src.type,
            url: src.url,
            config: src.config,
          }
          const items = await fetchItems(adapterInput)
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

      // 2. Pull unconsumed items
      const sinceMs = Date.now() - effectiveLookbackHours * 60 * 60 * 1000
      const candidates: Candidates = await ctx.runQuery(
        api.agentsData.unconsumedItemsForAgent,
        {
          agentId: agent._id,
          sinceMs,
          limit: agent.maxItemsPerRun,
        },
      )
      itemsConsidered = candidates.length
      await log(`Selected ${candidates.length} unconsumed items`)

      // Skip the LLM call when there's too little to draft from. One or two
      // items rarely yield a story worth the round-trip; the items stay
      // unconsumed for the next run when more accumulate.
      const MIN_CANDIDATES_FOR_DRAFT = 3
      if (candidates.length < MIN_CANDIDATES_FOR_DRAFT) {
        await log(
          `Skipped LLM call — ${candidates.length} candidates is below the ${MIN_CANDIDATES_FOR_DRAFT}-item threshold`,
        )
        await ctx.runMutation(api.agentsData.finishRun, {
          runId,
          status: "succeeded",
          itemsConsidered,
          draftsCreated,
        })
        return { runId, itemsConsidered, draftsCreated }
      }

      // 3. Build prompt items + recent-articles candidate set + call LLM
      const draftItems: Array<DraftItem> = candidates.map((c, idx) => ({
        index: idx,
        source: c.sourceName,
        url: c.item.url,
        title: c.item.title,
        publishedAt: c.item.publishedAt
          ? new Date(c.item.publishedAt).toISOString().slice(0, 10)
          : undefined,
        body: (c.item.body ?? c.item.snippet ?? "").slice(0, 3000),
      }))

      // Sections this desk can file under: primary + every direct child.
      // Lets the LLM pick a sub-section per draft (e.g. Arts desk → music
      // for a concert review) while staying within the desk's tree.
      const allowedSections = await ctx.runQuery(
        api.agentsData.allowedSectionsForAgent,
        { agentId: agent._id },
      )
      const sectionIdBySlug = new Map<string, Id<"sections">>()
      for (const s of allowedSections) sectionIdBySlug.set(s.slug, s._id)
      const sectionChoices = allowedSections.map((s) => ({
        slug: s.slug,
        name: s.name,
        description: s.description,
      }))

      const relatedPool = await ctx.runQuery(api.articles.recentForLinking, {
        sectionId: agent.sectionId,
        limit: 15,
        lookbackHours: 336, // 14 days — long enough to catch follow-ups
      })
      const relatedCandidates: Array<RelatedCandidate> = relatedPool.map(
        (a, idx) => ({
          index: idx,
          section: a.section?.name ?? "—",
          title: a.title,
          dek: a.dek,
          publishedAt: a.publishedAt
            ? new Date(a.publishedAt).toISOString().slice(0, 10)
            : undefined,
        }),
      )

      const model = agent.model && agent.model.length > 0
        ? agent.model
        : DEFAULT_MODEL

      // Daily budget gate. Bails the desk when the day's cap is hit so
      // the system stays within ~$20/month even on burst-y news days.
      const reservation = await ctx.runMutation(internal.budget.reserve, {
        estimatedCents: estimatedCallCents(model),
        label: `runDesk:${agent.slug}`,
      })
      if (!reservation.allowed) {
        await log(
          `Skipped LLM call — daily budget hit (${reservation.centsSpent}¢ / ${reservation.capCents}¢)`,
        )
        await ctx.runMutation(api.agentsData.finishRun, {
          runId,
          status: "succeeded",
          itemsConsidered,
          draftsCreated,
        })
        return { runId, itemsConsidered, draftsCreated }
      }

      await log(`Calling ${model} (${reservation.centsSpent}¢ today)`)
      const { drafts, events } = await generateDrafts({
        systemPrompt: agent.systemPrompt,
        model,
        items: draftItems,
        maxDrafts: agent.maxDraftsPerRun,
        relatedCandidates,
        sectionChoices,
      })
      // Per-section runDeskInternal is the legacy fan-out path; mega
      // desk handles metrics in its own section. Discarding the
      // metrics array from this older call site is intentional.
      await log(
        `LLM returned ${drafts.length} drafts, ${events.length} events`,
      )

      // 4. Insert each draft (track positional index → article id so events
      // can deep-link via relatedDraftIndex).
      const draftToArticleId = new Map<number, Id<"articles">>()
      let draftIndex = -1
      let augmentedCount = 0
      for (const draft of drafts) {
        draftIndex += 1
        const validIndices = draft.citationItemIndices.filter(
          (i) => i >= 0 && i < candidates.length,
        )
        if (validIndices.length === 0) {
          await log(`Skipped draft "${draft.title}" — no valid citations`)
          continue
        }
        const citedCandidates = validIndices.map((i) => candidates[i])
        const citations = citedCandidates.map((c) => ({
          url: c.item.url,
          title: c.item.title,
          publisher: c.sourceName,
          fetchedAt: c.item.fetchedAt,
          snippet: c.item.snippet,
        }))

        // Dedup path: when the LLM flags this as the same story we already
        // covered, augment the existing article instead of inserting a new
        // one. Citations + source items get merged; pending-review content
        // can be refreshed; published content stays editor-approved.
        if (
          draft.updateOfRelatedIndex !== undefined &&
          draft.updateOfRelatedIndex >= 0 &&
          draft.updateOfRelatedIndex < relatedPool.length
        ) {
          const target = relatedPool[draft.updateOfRelatedIndex]
          const result = await ctx.runMutation(
            api.articles.augmentArticle,
            {
              articleId: target._id,
              newCitations: citations,
              newSourceItems: citedCandidates.map((c) => c.item._id),
              patch: {
                title: draft.title,
                dek: draft.dek,
                body: toSingleParagraph(draft.body),
              },
              agentSlug: agent.slug,
              agentRunId: runId,
            },
          )
          if (result.merged) {
            await ctx.runMutation(api.agentsData.markItemsConsumed, {
              itemIds: citedCandidates.map((c) => c.item._id),
            })
            augmentedCount += 1
            await log(
              `Augmented "${target.title}" (+${result.citationsAdded} citations${
                result.contentUpdated ? ", content refreshed" : ""
              })`,
            )
            continue
          }
          // result.merged === false (target was rejected/archived) → fall
          // through to normal insert path so the story gets coverage.
        }

        const hero = await resolveHero(
          citations.map((c) => c.url),
          draft.title,
        )

        // Resolve the LLM's per-draft section choice. Falls back to the
        // desk's primary section when the LLM omits it or picks something
        // outside the allowed tree.
        const chosenSectionId =
          (draft.sectionSlug
            ? sectionIdBySlug.get(draft.sectionSlug)
            : undefined) ?? agent.sectionId

        const article = {
          slug: slugify(draft.suggestedSlug || draft.title),
          title: draft.title,
          dek: draft.dek,
          body: toSingleParagraph(draft.body),
          sectionId: chosenSectionId,
          tags: cleanTags(draft.tags),
          neighborhoods: filterNeighborhoodSlugs(draft.neighborhoodSlugs ?? []),
          heroImage: hero.source !== "none" ? hero.url : undefined,
          heroCaption:
            hero.source === "source"
              ? `Image: ${hostname(citations[0].url)}`
              : hero.source === "wikimedia"
                ? hero.caption
                : undefined,
          heroSource: hero.source,
          citations,
          agentSlug: agent.slug,
          agentRunId: runId,
          derivedFromItems: citedCandidates.map((c) => c.item._id),
          publishedAt:
            citedCandidates
              .map((c) => c.item.publishedAt)
              .filter((d): d is number => d != null)
              .sort((a, b) => b - a)[0] ?? undefined,
        }

        const relatedIds = (draft.relatedArticleIndices ?? [])
          .filter((i) => i >= 0 && i < relatedPool.length)
          .map((i) => relatedPool[i]._id)

        const articleId: Id<"articles"> = await ctx.runMutation(
          api.agentsData.insertDraft,
          {
            article,
            authorIds: [agent.authorId],
            relatedIds: relatedIds.length > 0 ? relatedIds : undefined,
          },
        )
        draftToArticleId.set(draftIndex, articleId)

        await ctx.runMutation(api.agentsData.markItemsConsumed, {
          itemIds: citedCandidates.map((c) => c.item._id),
        })

        draftsCreated += 1
        await log(`Drafted "${draft.title}"`)
      }

      // 5. Insert extracted events — auto-approved on the way in, same
      // policy as articles. Strict gate: drop any event whose ISO start
      // time can't be parsed or whose citations don't resolve to a real
      // source item. Quality issues are caught after the fact via
      // `events.recentAnomalies` on the admin dashboard, mirroring the
      // article anomaly flow. Events carry the same data shape as
      // articles: slug, sectionId, tags, citations, neighborhoods, hero
      // triplet, related links.
      let eventsCreated = 0
      for (const ev of events) {
        const validIndices = ev.citationItemIndices.filter(
          (i) => i >= 0 && i < candidates.length,
        )
        if (validIndices.length === 0) continue
        const startsAt = new Date(ev.startsAtIso).getTime()
        if (Number.isNaN(startsAt)) continue
        const endsAt = ev.endsAtIso
          ? new Date(ev.endsAtIso).getTime()
          : undefined
        const directDraftLink =
          ev.relatedDraftIndex !== undefined
            ? draftToArticleId.get(ev.relatedDraftIndex)
            : undefined
        const llmRelated = (ev.relatedArticleIndices ?? [])
          .filter((i) => i >= 0 && i < relatedPool.length)
          .map((i) => relatedPool[i]._id)
        const relatedArticleIds = Array.from(
          new Set<Id<"articles">>(
            [
              ...(directDraftLink ? [directDraftLink] : []),
              ...llmRelated,
            ],
          ),
        )
        const sourceItemIds = validIndices.map(
          (i) => candidates[i].item._id,
        )
        const citedCandidates = validIndices.map((i) => candidates[i])
        const eventCitations = citedCandidates.map((c) => ({
          url: c.item.url,
          title: c.item.title,
          publisher: c.sourceName,
          fetchedAt: c.item.fetchedAt,
          snippet: c.item.snippet,
        }))
        // Resolve a hero image: prefer OG image from the citation source,
        // then the event's own URL, then Unsplash fallback. Same pipeline
        // as articles so events read as visually rich.
        const eventCitationUrls = [
          ...(ev.url ? [ev.url] : []),
          ...validIndices.map((i) => candidates[i].item.url),
        ]
        const eventHero = await resolveHero(
          eventCitationUrls,
          `Miami ${ev.title}`,
        )
        // Resolve the LLM's per-event section pick from the desk's allowed
        // tree (same map as drafts). Falls back to the desk's primary.
        const eventSectionId =
          (ev.sectionSlug
            ? sectionIdBySlug.get(ev.sectionSlug)
            : undefined) ?? agent.sectionId
        try {
          await ctx.runMutation(internal.events.insertExtracted, {
            event: {
              slug: slugify(ev.suggestedSlug || ev.title),
              title: ev.title,
              description: ev.description,
              startsAt,
              endsAt: Number.isFinite(endsAt) ? endsAt : undefined,
              allDay: ev.allDay,
              locationName: ev.locationName,
              neighborhoods: filterNeighborhoodSlugs(
                ev.neighborhoodSlugs ?? [],
              ),
              url: ev.url,
              price: ev.price,
              heroImage:
                eventHero.source !== "none" ? eventHero.url : undefined,
              heroSource: eventHero.source,
              heroCaption:
                eventHero.source === "source"
                  ? `Image: ${hostname(eventCitations[0]?.url ?? "")}`
                  : eventHero.source === "wikimedia"
                    ? eventHero.caption
                    : undefined,
              sectionId: eventSectionId,
              tags: cleanTags(ev.tags ?? []),
              relatedArticleIds:
                relatedArticleIds.length > 0 ? relatedArticleIds : undefined,
              citations: eventCitations,
            },
            agentSlug: agent.slug,
            agentRunId: runId,
            derivedFromItems: sourceItemIds,
          })
          eventsCreated += 1
        } catch (e) {
          await log(
            `Skipped event "${ev.title}": ${e instanceof Error ? e.message : String(e)}`,
          )
        }
      }
      if (eventsCreated > 0) {
        await log(`Queued ${eventsCreated} events for review`)
      }

      await ctx.runMutation(api.agentsData.finishRun, {
        runId,
        status: "succeeded",
        itemsConsidered,
        draftsCreated,
      })
      return { runId, itemsConsidered, draftsCreated }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await log(`FAILED: ${msg}`)
      await ctx.runMutation(api.agentsData.finishRun, {
        runId,
        status: "failed",
        itemsConsidered,
        draftsCreated,
        errorMessage: msg,
      })
      return { runId, itemsConsidered, draftsCreated, error: msg }
    }
  },
})

// Public action — editor-triggered "Run all" / "Run desk" button. Wraps
// the internal action so the cron path can call without auth.
export const runDesk = action({
  args: { agentSlug: v.string() },
  handler: async (
    ctx,
    { agentSlug },
  ): Promise<{
    runId: Id<"agentRuns">
    itemsConsidered: number
    draftsCreated: number
    error?: string
  }> => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error("Unauthenticated")
    return await ctx.runAction(internal.agents.runDeskInternal, {
      agentSlug,
    })
  },
})

// ============================================================================
// Mega-desk — single agent that handles every section in one pass.
//
// One agent slug ("miami-desk") replaces the per-section desk fan-out.
// Pipeline: refresh every enabled source → pull the firehose of unconsumed
// items (capped) → call Opus once with every section as a routing choice.
// The LLM decides which items are noise (skipped silently), which become
// drafts, which become events, and which section each lands in.
//
// Cost shape: ~one Opus call per cron tick. Item cap (`MEGA_MAX_ITEMS`)
// keeps input tokens bounded so a single call stays under ~15¢ on a
// busy day. Budget gate still applies — the action bails cleanly when
// the cap is hit.
//
// No per-desk persona, no per-section voice rows. Voice lives in the
// system prompt and the section pick steers tone via section description.
// ============================================================================

const MEGA_DESK_SLUG = "miami-desk"
// Item firehose cap. 100 means more freshness gets considered each
// run, especially during news bursts when a single source can dump
// Items per run. 50 keeps each Sonnet call's input under ~25KB and
// keeps the model's attention focused. Mirrors seed's
// `maxItemsPerRun: 50` on the agent record.
const MEGA_MAX_ITEMS = 50
// Articles per run.
const MEGA_MAX_DRAFTS = 20
// Lookback window. 12h forces focus on truly recent items — anything
// older that wasn't drafted on a previous run probably wasn't going
// to be drafted anyway.
const MEGA_DEFAULT_LOOKBACK_HOURS = 12

const MEGA_SYSTEM_PROMPT = `You are the editorial brain of miami.community — the AI-edited local paper for Miami-Dade.

Your job each run: read a batch of source items pulled from local outlets, museum calendars, gov feeds, sports clubs, and broad aggregators. **Publish a short article for every Miami-Dade item that isn't already covered.** Articles you submit go LIVE IMMEDIATELY — there's no editor approval queue, no "draft" workflow. The maxArticles cap is a CEILING, not a target, but most runs should get close to it. The mistake to avoid is over-filtering, not over-publishing.

PUBLISH AGGRESSIVELY. If you have N items in your input, the expected number of published articles is N minus only (a) items already covered by an existing article on the site (use updateOfRelatedIndex to fold those in), and (b) items that are clearly not Miami-Dade-relevant (national/global wire copy that just happens to be carried by a local feed). Everything else gets published. "I'm not sure if this rises to news" is NOT a reason to skip — short factual coverage of small things (a new opening, a local arrest, a school-board vote, a Heat schedule announcement, a feature on a Miami YouTuber) is exactly what this paper is for. When in doubt, publish. **An empty articles array is almost always wrong: if you returned 0 articles from 50+ items, you've over-filtered.**

Voice across every section: matter-of-fact, plainly written, shorter than the source. The reader has 30 seconds. Lead with what happened. Skip cliché ("amid", "as", "after", "in a sign that"). No headlinese, no questions in headlines, no clickbait. State only what the cited sources support.

You will be told what sections exist and which one each draft should file under. Pick the most specific section that fits. Tone shifts subtly by section (urgent for breaking news, sensory for food, even-handed for politics) but voice stays one — the smart-friend register, no AI tells, no PR speak.

Beyond drafts and events, you also surface FIRST-CLASS METRICS — numerical or statistical artifacts about Miami that deserve their own widget on the homepage and inline embeds in articles. Use the \`metrics\` tool field for these. Only promote a number when:
- The cited source EXPLICITLY states it (never compute, estimate, or aggregate across sources)
- It's locally relevant (Miami-Dade, Miami metro, South Florida, sometimes statewide)
- It's a number a reader might actually want to see — population counts, median home prices, unemployment rates, ranking-list mentions, demographic breakdowns, climate readings, attendance figures
- A stable slug captures it (so re-runs that find updated values upsert in place: 'miami-dade-population', 'miami-median-home-price', 'miami-cost-of-living-rank')

Pick the right \`kind\`: number for one value, number-with-delta when source gives YoY/QoQ change, line/bars for time series, rank for "Miami ranks #N out of M", compare for two-sided splits. Always cite — every metric carries its source items.

Most runs will produce 0 metrics. That's fine. A typical eligible source: a census release, BLS report, NAR/Redfin price update, a "Miami ranks #X" mention in any wire story.`

// Internal mega-desk run. Idempotent enough to call from a cron tick or
// the editor's "Run desk" button. Returns a small summary so the caller
// can toast / log without re-querying.
export const runMegaDeskInternal = internalAction({
  args: {
    lookbackHoursOverride: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { lookbackHoursOverride },
  ): Promise<{
    runId: Id<"agentRuns"> | null
    itemsConsidered: number
    draftsCreated: number
    eventsCreated: number
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
    let draftsCreated = 0
    let eventsCreated = 0

    try {
      // 1. Refresh every enabled source on every tick. The earlier
      //    poll-interval gate starved the LLM of local content — at
      //    hourly cadence, only TV-wire sources fetch on each tick
      //    (because their poll interval is shorter), so the candidate
      //    queue was dominated by national wire copy and Sonnet
      //    correctly skipped most of it. Cost of always fetching is
      //    just network IO; no LLM per source. Worth it for queue
      //    diversity.
      const sources = await ctx.runQuery(internal.sourcesData.listInternal, {})
      const enabled = sources.filter((s) => s.enabled)
      await log(`Refreshing ${enabled.length} sources`)
      for (const src of enabled) {
        // `data` sources bypass the article pipeline entirely — they
        // emit metric records straight into the metrics table. The
        // mega-desk LLM never sees them, so they don't compete with
        // article items for the input budget. Failures are recorded
        // on the source row the same way as article-source errors.
        if (src.type === "data") {
          try {
            const dataMetrics = await fetchDataMetrics({ url: src.url })
            for (const m of dataMetrics) {
              await ctx.runMutation(internal.metrics.upsertFromAgent, {
                slug: m.slug,
                title: m.title,
                subtitle: m.subtitle,
                kind: m.kind,
                data: m.data,
                unit: m.unit,
                citations: m.citations,
                relatedTags: m.relatedTags,
                relatedSectionSlugs: m.relatedSectionSlugs,
              })
            }
            await ctx.runMutation(api.sourcesData.recordFetch, {
              sourceId: src._id,
              items: [],
              status: "ok",
            })
            await log(
              `[${src.name}] data adapter upserted ${dataMetrics.length} metrics`,
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
          continue
        }
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

      // 2. Pull the firehose — every unconsumed item across every source,
      //    capped to keep Opus input bounded.
      const sinceMs = Date.now() - lookbackHours * 3_600_000
      const candidates = await ctx.runQuery(
        api.agentsData.unconsumedItemsAll,
        { sinceMs, limit: MEGA_MAX_ITEMS },
      )
      itemsConsidered = candidates.length
      await log(`Selected ${candidates.length} unconsumed items`)
      // Sample of what's actually in the candidate pool — surfaces
      // whether items are local Miami stories or generic feed noise.
      // Bounded log lines so we don't blow up the run record.
      const sample = candidates
        .slice(0, 5)
        .map((c, i) => `  ${i + 1}. [${c.sourceName}] ${c.item.title.slice(0, 100)}`)
        .join("\n")
      if (sample) {
        await log(`Top candidates:\n${sample}`)
      }

      const MIN_CANDIDATES = 3
      if (candidates.length < MIN_CANDIDATES) {
        await log(
          `Skipped LLM call — ${candidates.length} candidates below ${MIN_CANDIDATES}-item threshold`,
        )
        await ctx.runMutation(api.agentsData.finishRun, {
          runId,
          status: "succeeded",
          itemsConsidered,
          draftsCreated,
        })
        return { runId, itemsConsidered, draftsCreated, eventsCreated }
      }

      // 3. Build prompt items, related-pool, full section list.
      const draftItems: Array<DraftItem> = candidates.map((c, idx) => ({
        index: idx,
        source: c.sourceName,
        url: c.item.url,
        title: c.item.title,
        publishedAt: c.item.publishedAt
          ? new Date(c.item.publishedAt).toISOString().slice(0, 10)
          : undefined,
        body: (c.item.body ?? c.item.snippet ?? "").slice(0, 3000),
      }))

      // Every section is a routing choice — both top-level and children
      // so the mega-desk can land directly in the most specific bucket
      // (e.g. food vs the broader news, or marlins vs sports).
      const allSections = await ctx.runQuery(api.sections.list, {})
      const sectionIdBySlug = new Map<string, Id<"sections">>()
      for (const s of allSections) sectionIdBySlug.set(s.slug, s._id)
      const sectionChoices = allSections.map((s) => ({
        slug: s.slug,
        name: s.name,
        description: s.description,
      }))

      // Related pool spans all sections too — the mega-desk needs to
      // dedupe against the whole catalog, not one beat.
      const relatedPool = await ctx.runQuery(api.articles.recentForLinking, {
        limit: 25,
        lookbackHours: 336,
      })
      const relatedCandidates: Array<RelatedCandidate> = relatedPool.map(
        (a, idx) => ({
          index: idx,
          section: a.section?.name ?? "—",
          title: a.title,
          dek: a.dek,
          publishedAt: a.publishedAt
            ? new Date(a.publishedAt).toISOString().slice(0, 10)
            : undefined,
        }),
      )

      // 4. Budget gate. Opus is ~7-15¢ per call depending on item count;
      //    we estimate from the model name.
      const model = agent.model
      const reservation = await ctx.runMutation(internal.budget.reserve, {
        estimatedCents: estimatedCallCents(model),
        label: `runMegaDesk`,
      })
      if (!reservation.allowed) {
        await log(
          `Skipped LLM call — daily budget hit (${reservation.centsSpent}¢ / ${reservation.capCents}¢)`,
        )
        await ctx.runMutation(api.agentsData.finishRun, {
          runId,
          status: "skipped",
          itemsConsidered,
          draftsCreated,
          skippedReason: "budget-cap",
        })
        return { runId, itemsConsidered, draftsCreated, eventsCreated }
      }

      // Metric catalog — passed to the LLM so it can drop
      // `[[metric:slug]]` tokens into draft bodies whose tags overlap.
      const metricCatalogRows = await ctx.runQuery(api.metrics.list, {
        limit: 24,
      })
      const metricCatalog = metricCatalogRows.map((m) => ({
        slug: m.slug,
        title: m.title,
        unit: m.unit,
        relatedTags: m.relatedTags,
      }))

      await log(`Calling ${model} (${reservation.centsSpent}¢ today)`)
      const { drafts, events, metrics, rawDraftCount, stopReason, rawInputSnippet } = await generateDrafts({
        systemPrompt: MEGA_SYSTEM_PROMPT,
        model,
        items: draftItems,
        maxDrafts: MEGA_MAX_DRAFTS,
        relatedCandidates,
        sectionChoices,
        metricCatalog,
      })
      const dropped = rawDraftCount - drafts.length
      await log(
        `LLM returned ${drafts.length} articles (${rawDraftCount} raw, ${dropped} dropped in validation), ${events.length} events, ${metrics.length} metrics`,
      )
      if (rawDraftCount === 0) {
        await log(`Empty articles diagnostic — stop_reason=${stopReason} input=${rawInputSnippet}`)
      }

      // Mark every candidate the LLM saw as consumed — whether it made
      // it into a draft or not. Without this, items the LLM rejects
      // (national wire copy, generic feed noise, items that just
      // weren't a fit) recycle endlessly on the unconsumed queue and
      // crowd out fresh items. The mega-desk has now seen them; if
      // they were drafts, they'll get consumed below as part of the
      // draft-insertion loop too (idempotent patch). If they weren't,
      // we're saying "we considered these and passed."
      await ctx.runMutation(api.agentsData.markItemsConsumed, {
        itemIds: candidates.map((c) => c.item._id),
      })

      // 5. Insert drafts (same dedup-via-augment + hero-resolve flow as
      //    runDeskInternal). No author IDs — bylines moved to "From sources"
      //    in the article header per the rip-and-replace plan.
      const draftToArticleId = new Map<number, Id<"articles">>()
      let draftIndex = -1
      for (const draft of drafts) {
        draftIndex += 1
        const validIndices = draft.citationItemIndices.filter(
          (i) => i >= 0 && i < candidates.length,
        )
        if (validIndices.length === 0) {
          await log(`Skipped draft "${draft.title}" — no valid citations`)
          continue
        }
        const citedCandidates = validIndices.map((i) => candidates[i])
        const citations = citedCandidates.map((c) => ({
          url: c.item.url,
          title: c.item.title,
          publisher: c.sourceName,
          fetchedAt: c.item.fetchedAt,
          snippet: c.item.snippet,
        }))

        if (
          draft.updateOfRelatedIndex !== undefined &&
          draft.updateOfRelatedIndex >= 0 &&
          draft.updateOfRelatedIndex < relatedPool.length
        ) {
          const target = relatedPool[draft.updateOfRelatedIndex]
          const result = await ctx.runMutation(api.articles.augmentArticle, {
            articleId: target._id,
            newCitations: citations,
            newSourceItems: citedCandidates.map((c) => c.item._id),
            patch: {
              title: draft.title,
              dek: draft.dek,
              body: toSingleParagraph(draft.body),
            },
            agentSlug: MEGA_DESK_SLUG,
            agentRunId: runId,
          })
          if (result.merged) {
            await ctx.runMutation(api.agentsData.markItemsConsumed, {
              itemIds: citedCandidates.map((c) => c.item._id),
            })
            await log(
              `Augmented "${target.title}" (+${result.citationsAdded} citations${
                result.contentUpdated ? ", content refreshed" : ""
              })`,
            )
            continue
          }
        }

        const hero = await resolveHero(
          citations.map((c) => c.url),
          draft.title,
        )

        // Section pick falls back to "news" for any draft the LLM doesn't
        // route — every site has a news section by convention.
        const fallbackSectionId =
          sectionIdBySlug.get("news") ?? allSections[0]?._id
        if (!fallbackSectionId) {
          throw new Error("No sections configured — cannot insert draft")
        }
        const chosenSectionId =
          (draft.sectionSlug
            ? sectionIdBySlug.get(draft.sectionSlug)
            : undefined) ?? fallbackSectionId

        const article = {
          slug: slugify(draft.suggestedSlug || draft.title),
          title: draft.title,
          dek: draft.dek,
          body: toSingleParagraph(draft.body),
          sectionId: chosenSectionId,
          tags: cleanTags(draft.tags),
          neighborhoods: filterNeighborhoodSlugs(draft.neighborhoodSlugs ?? []),
          heroImage: hero.source !== "none" ? hero.url : undefined,
          heroCaption:
            hero.source === "source"
              ? `Image: ${hostname(citations[0].url)}`
              : hero.source === "wikimedia"
                ? hero.caption
                : undefined,
          heroSource: hero.source,
          citations,
          agentSlug: MEGA_DESK_SLUG,
          agentRunId: runId,
          derivedFromItems: citedCandidates.map((c) => c.item._id),
          publishedAt:
            citedCandidates
              .map((c) => c.item.publishedAt)
              .filter((d): d is number => d != null)
              .sort((a, b) => b - a)[0] ?? undefined,
        }

        const relatedIds = (draft.relatedArticleIndices ?? [])
          .filter((i) => i >= 0 && i < relatedPool.length)
          .map((i) => relatedPool[i]._id)

        const articleId: Id<"articles"> = await ctx.runMutation(
          api.agentsData.insertDraft,
          {
            article,
            authorIds: [],
            relatedIds: relatedIds.length > 0 ? relatedIds : undefined,
          },
        )
        draftToArticleId.set(draftIndex, articleId)

        await ctx.runMutation(api.agentsData.markItemsConsumed, {
          itemIds: citedCandidates.map((c) => c.item._id),
        })
        draftsCreated += 1
        await log(`Drafted "${draft.title}"`)
      }

      // 6. Insert events — same flow as runDeskInternal. Every event
      //    must land in a real section: prefer News as the fallback,
      //    then any other section. Things-to-do isn't a section anymore.
      const fallbackEventSectionId =
        sectionIdBySlug.get("news") ?? allSections[0]?._id
      for (const ev of events) {
        const validIndices = ev.citationItemIndices.filter(
          (i) => i >= 0 && i < candidates.length,
        )
        if (validIndices.length === 0) continue
        const startsAt = new Date(ev.startsAtIso).getTime()
        if (Number.isNaN(startsAt)) continue
        const endsAt = ev.endsAtIso
          ? new Date(ev.endsAtIso).getTime()
          : undefined
        const directDraftLink =
          ev.relatedDraftIndex !== undefined
            ? draftToArticleId.get(ev.relatedDraftIndex)
            : undefined
        const llmRelated = (ev.relatedArticleIndices ?? [])
          .filter((i) => i >= 0 && i < relatedPool.length)
          .map((i) => relatedPool[i]._id)
        const relatedArticleIds = Array.from(
          new Set<Id<"articles">>(
            [
              ...(directDraftLink ? [directDraftLink] : []),
              ...llmRelated,
            ],
          ),
        )
        const sourceItemIds = validIndices.map((i) => candidates[i].item._id)
        const citedCandidates = validIndices.map((i) => candidates[i])
        const eventCitations = citedCandidates.map((c) => ({
          url: c.item.url,
          title: c.item.title,
          publisher: c.sourceName,
          fetchedAt: c.item.fetchedAt,
          snippet: c.item.snippet,
        }))
        const eventCitationUrls = [
          ...(ev.url ? [ev.url] : []),
          ...validIndices.map((i) => candidates[i].item.url),
        ]
        const eventHero = await resolveHero(
          eventCitationUrls,
          `Miami ${ev.title}`,
        )
        const eventSectionId =
          (ev.sectionSlug
            ? sectionIdBySlug.get(ev.sectionSlug)
            : undefined) ?? fallbackEventSectionId
        if (!eventSectionId) continue
        try {
          await ctx.runMutation(internal.events.insertExtracted, {
            event: {
              slug: slugify(ev.suggestedSlug || ev.title),
              title: ev.title,
              description: ev.description,
              startsAt,
              endsAt: Number.isFinite(endsAt) ? endsAt : undefined,
              allDay: ev.allDay,
              locationName: ev.locationName,
              neighborhoods: filterNeighborhoodSlugs(
                ev.neighborhoodSlugs ?? [],
              ),
              url: ev.url,
              price: ev.price,
              heroImage:
                eventHero.source !== "none" ? eventHero.url : undefined,
              heroSource: eventHero.source,
              heroCaption:
                eventHero.source === "source"
                  ? `Image: ${hostname(eventCitations[0]?.url ?? "")}`
                  : eventHero.source === "wikimedia"
                    ? eventHero.caption
                    : undefined,
              sectionId: eventSectionId,
              tags: cleanTags(ev.tags ?? []),
              relatedArticleIds:
                relatedArticleIds.length > 0 ? relatedArticleIds : undefined,
              citations: eventCitations,
            },
            agentSlug: MEGA_DESK_SLUG,
            agentRunId: runId,
            derivedFromItems: sourceItemIds,
          })
          eventsCreated += 1
        } catch (e) {
          await log(
            `Skipped event "${ev.title}": ${e instanceof Error ? e.message : String(e)}`,
          )
        }
      }
      if (eventsCreated > 0) {
        await log(`Queued ${eventsCreated} events`)
      }

      // 7. Persist metrics — slug-keyed upsert. New numbers from this
      // run replace prior values. Citations are mapped from
      // candidate-item indices to URL/publisher records (same shape
      // articles + events use). Skips metrics whose citationItemIndices
      // resolve to zero candidates or whose data shape fails the
      // schema's `v.any()` validator at insert time.
      let metricsCreated = 0
      for (const metric of metrics) {
        const validIndices = metric.citationItemIndices.filter(
          (i) => i >= 0 && i < candidates.length,
        )
        if (validIndices.length === 0) continue
        const citedCandidates = validIndices.map((i) => candidates[i])
        const citations = citedCandidates.map((c) => ({
          url: c.item.url,
          title: c.item.title,
          publisher: c.sourceName,
          fetchedAt: c.item.fetchedAt,
        }))
        try {
          await ctx.runMutation(internal.metrics.upsertFromAgent, {
            slug: metric.slug,
            title: metric.title,
            subtitle: metric.subtitle,
            kind: metric.kind,
            data: metric.data,
            unit: metric.unit,
            citations,
            relatedTags: metric.relatedTags,
            relatedSectionSlugs: metric.relatedSectionSlugs,
          })
          metricsCreated += 1
        } catch (err) {
          await log(
            `Skipped metric "${metric.slug}": ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
      if (metricsCreated > 0) {
        await log(`Recorded ${metricsCreated} metrics`)
      }

      await ctx.runMutation(api.agentsData.finishRun, {
        runId,
        status: "succeeded",
        itemsConsidered,
        draftsCreated,
      })
      return { runId, itemsConsidered, draftsCreated, eventsCreated }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await log(`FAILED: ${msg}`)
      await ctx.runMutation(api.agentsData.finishRun, {
        runId,
        status: "failed",
        itemsConsidered,
        draftsCreated,
        errorMessage: msg,
      })
      return {
        runId,
        itemsConsidered,
        draftsCreated,
        eventsCreated,
        error: msg,
      }
    }
  },
})

// Public mega-desk action — editor-triggered "Run desk" button.
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
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error("Unauthenticated")
    return await ctx.runAction(internal.agents.runMegaDeskInternal, {})
  },
})

// Cron tick — fires on the cron schedule (every 1 hour). Gated by
// `CRONS_ENABLED` so the dev deployment doesn't double-bill the
// Anthropic key. Manual "Run now" through /admin uses `runMegaDesk`
// (the public action) and bypasses this gate.
export const cronRunMegaDesk = internalAction({
  args: {},
  handler: async (ctx): Promise<{ summary: string }> => {
    if (!cronsEnabled()) {
      return { summary: "mega-desk: skipped — CRONS_ENABLED not set" }
    }
    const r = await ctx.runAction(internal.agents.runMegaDeskInternal, {})
    if (r.error) return { summary: `mega-desk: ERROR ${r.error}` }
    return {
      summary: `mega-desk: ${r.draftsCreated} drafts, ${r.eventsCreated} events from ${r.itemsConsidered} items`,
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
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error("Unauthenticated")
    const totalDays = Math.max(1, Math.min(days ?? 30, 90))
    const r = await ctx.runAction(internal.agents.runMegaDeskInternal, {
      lookbackHoursOverride: totalDays * 24,
    })
    return {
      days: totalDays,
      draftsCreated: r.draftsCreated,
      eventsCreated: r.eventsCreated,
      itemsConsidered: r.itemsConsidered,
      error: r.error,
    }
  },
})
