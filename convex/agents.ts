import { getAuthUserId } from "@convex-dev/auth/server"
import { v } from "convex/values"
import { api, internal } from "./_generated/api"
import { action } from "./_generated/server"
import {  fetchItems } from "./lib/adapters"
import { generateDrafts, generateEnrichment } from "./lib/llm"
import { resolveHero } from "./lib/media"
import { filterNeighborhoodSlugs } from "./lib/neighborhoods"
import type {SourceForAdapter} from "./lib/adapters";
import type { DraftItem, RelatedCandidate } from "./lib/llm"
import type { Id } from "./_generated/dataModel"
import type { ActionCtx } from "./_generated/server"
import type { FunctionReturnType } from "convex/server"

type RelatedPool = FunctionReturnType<typeof api.articles.recentForLinking>
type EnrichableArticle = FunctionReturnType<
  typeof api.articles.enrichableForAgent
>[number]

type Candidates = FunctionReturnType<
  typeof api.agentsData.unconsumedItemsForAgent
>

// Single editorial model across every desk. The agents table still has a
// `model` column for future per-desk overrides, but for now the runtime
// always uses Opus 4.7 — most capable model in the current Claude family.
const DEFAULT_MODEL = "claude-opus-4-7"

// Tags that add no signal (every story is local to Miami-Dade by definition).
// Stripped from every draft before insert so they never reach the public site
// even if the LLM ignores the prompt instruction.
const REDUNDANT_TAGS = new Set([
  "miami",
  "miami-dade",
  "miamidade",
  "miami dade",
])

function cleanTags(tags: ReadonlyArray<string>): Array<string> {
  return tags.filter((t) => !REDUNDANT_TAGS.has(t.toLowerCase().trim()))
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

    const agent = await ctx.runQuery(api.agentsData.getBySlug, {
      slug: agentSlug,
    })
    if (!agent) throw new Error(`Agent "${agentSlug}" not found`)

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
      const sinceMs = Date.now() - agent.lookbackHours * 60 * 60 * 1000
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

      if (candidates.length === 0) {
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

      await log(`Calling ${DEFAULT_MODEL}`)
      const { drafts, events } = await generateDrafts({
        systemPrompt: agent.systemPrompt,
        model: DEFAULT_MODEL,
        items: draftItems,
        maxDrafts: agent.maxDraftsPerRun,
        relatedCandidates,
        sectionChoices,
      })
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
            hero.source === "unsplash"
              ? hero.caption
              : hero.source === "source"
                ? `Image: ${hostname(citations[0].url)}`
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

      // 5. Insert extracted events (pending_review). Strict gate: drop any
      // event whose ISO start time can't be parsed or whose citations don't
      // resolve to a real source item.
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
        const linkedArticleId =
          ev.relatedDraftIndex !== undefined
            ? draftToArticleId.get(ev.relatedDraftIndex)
            : undefined
        const sourceItemIds = validIndices.map(
          (i) => candidates[i].item._id,
        )
        // Resolve a hero image: prefer OG image from the citation source,
        // then the event's own URL, then Unsplash fallback. Mirrors how
        // articles get hero images so events read as visually rich.
        const eventCitationUrls = [
          ...(ev.url ? [ev.url] : []),
          ...validIndices.map((i) => candidates[i].item.url),
        ]
        const eventHero = await resolveHero(
          eventCitationUrls,
          `Miami ${ev.kind} ${ev.title}`,
        )
        try {
          await ctx.runMutation(internal.events.insertExtracted, {
            event: {
              title: ev.title,
              description: ev.description,
              kind: ev.kind,
              startsAt,
              endsAt: Number.isFinite(endsAt) ? endsAt : undefined,
              allDay: ev.allDay,
              locationName: ev.locationName,
              neighborhood: ev.neighborhood,
              url: ev.url,
              price: ev.price,
              imageUrl:
                eventHero.source !== "none" ? eventHero.url : undefined,
              articleId: linkedArticleId,
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

// Run one article through the enrichment pipeline: ask the LLM for
// additive citations / related links / optional copy polish, re-resolve
// the hero image when missing, then apply via the enrichArticle mutation
// (which also writes the revision row). Returns whether any field
// changed so the caller can tally results. Re-used by both the bulk
// `enrichDesk` action and the per-story `enrichStory` action so they
// stay in lock-step.
async function enrichOneArticle(
  ctx: ActionCtx,
  args: {
    agent: { slug: string; systemPrompt: string }
    article: EnrichableArticle
    runId: Id<"agentRuns">
    candidatePool: Candidates
    relatedPool: RelatedPool
    log: (line: string) => Promise<unknown>
  },
): Promise<{
  changed: boolean
  changedFields?: Array<string>
  citationsAdded?: number
  relatedAdded?: number
}> {
  const { agent, article, runId, candidatePool, relatedPool, log } = args

  // Drop any items already cited / consumed by this article, then send
  // the rest to the LLM as new-item candidates. Cap at 12 to keep prompt
  // size bounded.
  const articleSourceIds = new Set(
    article.derivedFromItems.map((id) => id as string),
  )
  const articleCitationUrls = new Set(article.citations.map((c) => c.url))
  const newItemCandidates = candidatePool
    .filter(
      (c) =>
        !articleSourceIds.has(c.item._id as string) &&
        !articleCitationUrls.has(c.item.url),
    )
    .slice(0, 12)
  const draftItems: Array<DraftItem> = newItemCandidates.map((c, idx) => ({
    index: idx,
    source: c.sourceName,
    url: c.item.url,
    title: c.item.title,
    publishedAt: c.item.publishedAt
      ? new Date(c.item.publishedAt).toISOString().slice(0, 10)
      : undefined,
    body: (c.item.body ?? c.item.snippet ?? "").slice(0, 2000),
  }))

  // Drop the article itself + anything already linked.
  const existingRelated = new Set(
    (article.relatedArticleIds ?? []).map((id) => id as string),
  )
  const filteredRelated = relatedPool
    .filter(
      (r) =>
        (r._id as string) !== (article._id as string) &&
        !existingRelated.has(r._id as string),
    )
    .slice(0, 12)
  const relatedCandidates: Array<RelatedCandidate> = filteredRelated.map(
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

  // Re-resolve hero if missing — independent of the LLM call.
  let heroPatch: {
    heroImage?: string
    heroCaption?: string
    heroSource?: "source" | "unsplash" | "none"
  } = {}
  if (!article.heroImage || article.heroSource === "none") {
    const newHero = await resolveHero(
      article.citations.map((c) => c.url),
      article.title,
    )
    if (newHero.source !== "none") {
      heroPatch = {
        heroImage: newHero.url,
        heroSource: newHero.source,
        heroCaption:
          newHero.source === "unsplash"
            ? newHero.caption
            : `Image: ${hostname(article.citations[0]?.url ?? "")}`,
      }
    }
  }

  // Skip the LLM call entirely when there's nothing for it to consider.
  // The hero re-resolution still runs above.
  const hasAnyCandidates =
    draftItems.length > 0 || relatedCandidates.length > 0
  const llmPatch: {
    title?: string
    dek?: string
    body?: string
    tags?: Array<string>
    neighborhoods?: Array<string>
  } = {}
  let citationsToAdd: typeof article.citations = []
  let sourceItemsToAdd: Array<Id<"ingestedItems">> = []
  let relatedToAdd: Array<Id<"articles">> = []
  let note: string | undefined

  if (hasAnyCandidates) {
    try {
      const result = await generateEnrichment({
        systemPrompt: agent.systemPrompt,
        model: DEFAULT_MODEL,
        article: {
          title: article.title,
          dek: article.dek,
          body: article.body,
          tags: article.tags,
          sectionSlug: article.section?.slug ?? "",
          citations: article.citations,
          neighborhoodSlugs: article.neighborhoods,
        },
        newItems: draftItems,
        relatedCandidates,
      })
      if (result) {
        if (result.title) llmPatch.title = result.title
        if (result.dek) llmPatch.dek = result.dek
        if (result.body) llmPatch.body = toSingleParagraph(result.body)
        if (result.tags) llmPatch.tags = cleanTags(result.tags)
        if (result.neighborhoodSlugs)
          llmPatch.neighborhoods = filterNeighborhoodSlugs(
            result.neighborhoodSlugs,
          )
        note = result.rewriteJustification

        const validCiteIndices = result.citationItemIndicesToAdd.filter(
          (i) => i >= 0 && i < newItemCandidates.length,
        )
        const cited = validCiteIndices.map((i) => newItemCandidates[i])
        citationsToAdd = cited.map((c) => ({
          url: c.item.url,
          title: c.item.title,
          publisher: c.sourceName,
          fetchedAt: c.item.fetchedAt,
          snippet: c.item.snippet,
        }))
        sourceItemsToAdd = cited.map((c) => c.item._id)

        const validRelatedIndices = result.relatedArticleIndicesToLink.filter(
          (i) => i >= 0 && i < filteredRelated.length,
        )
        relatedToAdd = validRelatedIndices.map(
          (i) => filteredRelated[i]._id,
        )
      }
    } catch (e) {
      await log(
        `Enrichment LLM failed for "${article.title}": ${
          e instanceof Error ? e.message : String(e)
        }`,
      )
    }
  }

  const applied = await ctx.runMutation(api.articles.enrichArticle, {
    articleId: article._id,
    patch: { ...llmPatch, ...heroPatch },
    newCitations: citationsToAdd,
    newSourceItems: sourceItemsToAdd,
    newRelatedIds: relatedToAdd,
    agentSlug: agent.slug,
    agentRunId: runId,
    note,
  })
  if (applied.changed) {
    await log(
      `Enriched "${article.title}" — fields: ${
        (applied.changedFields ?? []).join(", ") || "(none)"
      }; +${applied.citationsAdded ?? 0} citations, +${
        applied.relatedAdded ?? 0
      } related`,
    )
    // Mark the items we cited as consumed so runDesk doesn't pick them
    // up again as candidates for fresh drafts.
    if (sourceItemsToAdd.length > 0) {
      await ctx.runMutation(api.agentsData.markItemsConsumed, {
        itemIds: sourceItemsToAdd,
      })
    }
  }
  return {
    changed: applied.changed,
    changedFields: applied.changedFields,
    citationsAdded: applied.citationsAdded,
    relatedAdded: applied.relatedAdded,
  }
}

// =====================================================================
// Bulk-enrichment pass — operates on QUEUED (pending_review) + PUBLISHED
// articles filed under this desk's section, plus future events. For
// each piece, the LLM is asked to: append new citations, link related
// stories, polish copy when warranted, and refresh metadata. Hero
// images are re-resolved server-side when missing. Every change writes
// a row in articleRevisions so the timeline shows what the desk touched
// and why. Rejected/archived items are skipped (intentional removals).
// =====================================================================
export const enrichDesk = action({
  args: {
    agentSlug: v.string(),
    maxArticles: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { agentSlug, maxArticles },
  ): Promise<{
    runId: Id<"agentRuns">
    articlesScanned: number
    articlesEnriched: number
    eventsEnriched: number
    error?: string
  }> => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error("Unauthenticated")

    const agent = await ctx.runQuery(api.agentsData.getBySlug, {
      slug: agentSlug,
    })
    if (!agent) throw new Error(`Agent "${agentSlug}" not found`)

    const cap = maxArticles ?? 8
    const runId = await ctx.runMutation(api.agentsData.startRun, {
      agentId: agent._id,
    })
    const log = (line: string) =>
      ctx.runMutation(api.agentsData.appendLog, { runId, line })

    let articlesScanned = 0
    let articlesEnriched = 0
    let eventsEnriched = 0

    try {
      // 1. Refresh source feeds first so the LLM sees the freshest items.
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
          await ctx.runMutation(api.sourcesData.recordFetch, {
            sourceId: src._id,
            items,
            status: "ok",
          })
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

      // 2. Pull recently-published articles to enrich, oldest-first so the
      // pieces with the longest accrual window get processed before fresh
      // ones (which are unlikely to have new follow-up coverage yet).
      const articles = await ctx.runQuery(
        api.articles.enrichableForAgent,
        { agentId: agent._id, limit: cap },
      )
      articlesScanned = articles.length
      const queued = articles.filter((a) => a.status === "pending_review").length
      const published = articles.length - queued
      await log(
        `Found ${articles.length} articles to scan (${published} published, ${queued} queued)`,
      )

      // 3. Pre-fetch a shared candidate pool of recent items + related
      // articles. Each per-article LLM call narrows it locally.
      const sinceMs = Date.now() - agent.lookbackHours * 60 * 60 * 1000
      const candidatePool = await ctx.runQuery(
        api.agentsData.unconsumedItemsForAgent,
        {
          agentId: agent._id,
          sinceMs,
          limit: agent.maxItemsPerRun * 2,
        },
      )
      const relatedPool = await ctx.runQuery(api.articles.recentForLinking, {
        sectionId: agent.sectionId,
        limit: 25,
        lookbackHours: 720, // 30 days — broader than runDesk's 14
      })

      // 4. Per-article enrichment loop.
      for (const article of articles) {
        const enriched = await enrichOneArticle(ctx, {
          agent,
          article,
          runId,
          candidatePool,
          relatedPool,
          log,
        })
        if (enriched.changed) articlesEnriched += 1
      }

      // 5. Future-event enrichment: re-resolve missing imageUrls.
      const events = await ctx.runQuery(api.events.futureForAgent, {
        agentId: agent._id,
        limit: 30,
      })
      for (const ev of events) {
        if (ev.imageUrl) continue
        const fallbackUrls = ev.url ? [ev.url] : []
        const hero = await resolveHero(
          fallbackUrls,
          `Miami ${ev.kind ?? "event"} ${ev.title}`,
        )
        if (hero.source === "none") continue
        const r = await ctx.runMutation(internal.events.enrichEvent, {
          id: ev._id,
          patch: { imageUrl: hero.url },
        })
        if (r.changed) eventsEnriched += 1
      }
      if (eventsEnriched > 0) {
        await log(`Enriched ${eventsEnriched} events with images`)
      }

      await ctx.runMutation(api.agentsData.finishRun, {
        runId,
        status: "succeeded",
        itemsConsidered: articlesScanned,
        draftsCreated: articlesEnriched,
      })
      return {
        runId,
        articlesScanned,
        articlesEnriched,
        eventsEnriched,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await log(`FAILED: ${msg}`)
      await ctx.runMutation(api.agentsData.finishRun, {
        runId,
        status: "failed",
        itemsConsidered: articlesScanned,
        draftsCreated: articlesEnriched,
        errorMessage: msg,
      })
      return {
        runId,
        articlesScanned,
        articlesEnriched,
        eventsEnriched,
        error: msg,
      }
    }
  },
})

// =====================================================================
// Per-story enrichment — same pipeline as enrichDesk, scoped to a single
// article. Picks the right desk via agentsData.deskForArticle (prefers
// the desk that drafted the piece, falls back to the section's primary
// desk). Surfaced in the admin queue editor so editors can refresh a
// specific story on demand instead of waiting for a bulk pass.
// =====================================================================
export const enrichStory = action({
  args: { articleId: v.id("articles") },
  handler: async (
    ctx,
    { articleId },
  ): Promise<{
    runId?: Id<"agentRuns">
    deskName?: string
    changed: boolean
    changedFields?: Array<string>
    citationsAdded?: number
    relatedAdded?: number
    error?: string
  }> => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error("Unauthenticated")

    const article = await ctx.runQuery(api.articles.getById, { id: articleId })
    if (!article) throw new Error("Article not found")
    if (article.status === "rejected" || article.status === "archived") {
      throw new Error(`Cannot enrich ${article.status} article`)
    }

    const desk = await ctx.runQuery(api.agentsData.deskForArticle, {
      articleId,
    })
    if (!desk) throw new Error("No desk found for this article's section")

    const runId = await ctx.runMutation(api.agentsData.startRun, {
      agentId: desk._id,
    })
    const log = (line: string) =>
      ctx.runMutation(api.agentsData.appendLog, { runId, line })

    try {
      // 1. Refresh sources so the LLM sees freshest items for this desk.
      const sources = await ctx.runQuery(
        api.agentsData.enabledSourcesForAgent,
        { agentId: desk._id },
      )
      await log(`Refreshing ${sources.length} sources before enrichment`)
      for (const src of sources) {
        try {
          const adapterInput: SourceForAdapter = {
            type: src.type,
            url: src.url,
            config: src.config,
          }
          const items = await fetchItems(adapterInput)
          await ctx.runMutation(api.sourcesData.recordFetch, {
            sourceId: src._id,
            items,
            status: "ok",
          })
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

      // 2. Pull a candidate pool + related pool, then run the same helper
      // the bulk pass uses so behavior stays in lock-step.
      const sinceMs = Date.now() - desk.lookbackHours * 60 * 60 * 1000
      const candidatePool = await ctx.runQuery(
        api.agentsData.unconsumedItemsForAgent,
        {
          agentId: desk._id,
          sinceMs,
          limit: desk.maxItemsPerRun * 2,
        },
      )
      const relatedPool = await ctx.runQuery(api.articles.recentForLinking, {
        sectionId: desk.sectionId,
        limit: 25,
        lookbackHours: 720,
      })

      const result = await enrichOneArticle(ctx, {
        agent: desk,
        article,
        runId,
        candidatePool,
        relatedPool,
        log,
      })

      await ctx.runMutation(api.agentsData.finishRun, {
        runId,
        status: "succeeded",
        itemsConsidered: candidatePool.length,
        draftsCreated: result.changed ? 1 : 0,
      })
      return {
        runId,
        deskName: desk.name,
        changed: result.changed,
        changedFields: result.changedFields,
        citationsAdded: result.citationsAdded,
        relatedAdded: result.relatedAdded,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await log(`FAILED: ${msg}`)
      await ctx.runMutation(api.agentsData.finishRun, {
        runId,
        status: "failed",
        itemsConsidered: 0,
        draftsCreated: 0,
        errorMessage: msg,
      })
      return { runId, deskName: desk.name, changed: false, error: msg }
    }
  },
})

// =====================================================================
// Bulk voice refresh — drain the backlog of stories drafted under the
// old (longer) prompt by re-rolling them through the current voice
// rules. Each call processes up to `maxStories` (default 10) bloated
// stories — the editor's "Re-roll voice" button on the dashboard kicks
// this and reports how many remain. Re-uses `enrichStory` per story
// so each gets its own run record and revision row.
// =====================================================================
export const bulkRefreshVoice = action({
  args: { maxStories: v.optional(v.number()) },
  handler: async (
    ctx,
    { maxStories },
  ): Promise<{
    processed: number
    changed: number
    skipped: number
    errors: number
  }> => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error("Unauthenticated")

    const cap = maxStories ?? 10
    const candidates = await ctx.runQuery(
      api.articles.needingVoiceRefresh,
      { limit: cap, scan: 200 },
    )
    let processed = 0
    let changed = 0
    let skipped = 0
    let errors = 0
    for (const c of candidates) {
      processed += 1
      try {
        const r = await ctx.runAction(api.agents.enrichStory, {
          articleId: c._id,
        })
        if (r.error) {
          errors += 1
          continue
        }
        if (r.changed) changed += 1
        else skipped += 1
      } catch {
        errors += 1
      }
    }
    return { processed, changed, skipped, errors }
  },
})
