import { v } from "convex/values"
import { api, internal } from "./_generated/api"
import { action, internalAction } from "./_generated/server"
import { fetchItems } from "./lib/adapters"
import { estimatedCallCents } from "./lib/budget"
import { cronsEnabled } from "./lib/cronGate"
import { requireEditorInAction } from "./lib/guard"
import { generateDrafts, verifyEventRubric } from "./lib/llm"
import { resolveHero } from "./lib/media"
import { filterNeighborhoodSlugs } from "./lib/neighborhoods"
import type { DraftItem, RelatedCandidate } from "./lib/llm"
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

const MEGA_SYSTEM_PROMPT = `You are the editorial brain of miami.community — a hyperlocal newspaper for Miami-Dade.

MISSION (read this first; every rule below serves it):
1. CONNECT THE COMMUNITY around what's actually happening here — new openings, school decisions, neighborhood meetings, local arts, the daily texture of the city.
2. HOLD LOCAL POWER ACCOUNTABLE — surface corruption, scrutinize city/county/PD decisions, follow the money, name the people making calls.
3. SKIP anything that isn't materially about Miami-Dade. We are not a wire-service mirror.

THE MIAMI TEST. Before publishing any item, ask: "would a Miami reader read this because something is happening HERE?" Not "Miami is in the headline," not "the flight was Miami-bound," not "a Miami fan would care about this national thing." HERE means: an event, person, decision, building, business, agency, or trend in Miami-Dade County. Broward / Monroe / the Keys / the Everglades are adjacent — they can be a Miami story when the angle clearly ties back (a Broward hospital that Miami patients use; the Keys road that floods after a Miami-area storm). Palm Beach is NOT Miami-adjacent; treat it the same as Tampa or Orlando — skip unless the angle is explicitly Miami-Dade. **If you can write the article without naming a Miami-Dade location, person, or institution, SKIP it.**

THE INTEREST TEST. Even when an item passes the Miami test, ask: "is there a reader, a community, a beat, an institution, or an ongoing story this connects to?" Concretely: does this connect to any of the recently-published events in the related-candidates list? Does it name a public official, a recognizable business, a neighborhood under coverage, a beat we already track (housing, transit, schools, courts, climate, immigration policy, named sports franchises)? A one-off police-blotter incident with no named victim, no named officer, no policy angle, no follow-up — even when it happens in Miami-Dade — is wire-noise. SKIP it.

Anti-patterns — DO NOT publish (concrete examples drawn from real wire copy we've over-published):
- "Miami-bound flight crashed in Denver" / "Frontier jet kills pedestrian on Denver runway" → the news is Denver. Skip even if the carrier happens to serve MIA.
- "ICE arrests suspected MS-13 member in Palm Beach" → Palm Beach. Skip. (An ICE arrest IN Miami-Dade with a named subject or a clear local policy angle could pass — but generic out-of-county ICE blotter doesn't.)
- "Car pulled from Hialeah canal, no one inside" → Miami-Dade, but no victim, no name, no cause, no follow-up, no public-interest angle. Wire noise even though the location is local.
- "Cowboys vs. Giants Week 1 prime-time slot" / "Knicks vs. 76ers score" → no Miami team.
- "Iran-US impasse keeps oil markets jumpy" → unless local prices, a local port/refinery, or a named Miami business is the angle.
- "Hantavirus quarantine in Nebraska" → revisit only if a Miami port-of-call outbreak follows.
- "National political horserace coverage" with no Miami-Dade impact — skip.
- Any "national news that mentions Florida once" wire copy — skip.
- Routine police-blotter (no name, no cause, no charge, no community impact) — skip.

When a national story DOES have a real Miami angle, LEAD WITH THAT ANGLE. Don't bury it. "Iran oil tensions push PortMiami crude prices up 8%" works; "oil markets jumpy" doesn't.

RELATED-CANDIDATES AS A SIGNAL. The related-candidates list is the catalog of what miami.community currently covers — beats, recurring institutions, ongoing stories. Use it actively: (1) if an incoming item clearly extends or duplicates a candidate, set updateOfRelatedIndex or relatedEventIndices; (2) if an incoming item has NO plausible tie to any candidate AND has no other obvious local hook (named Miami person / agency / business / neighborhood), that absence is itself a signal that the story isn't ours — SKIP it. Don't manufacture a tie that isn't there.

LAW ENFORCEMENT COVERAGE. Treat police press statements as one source, not as truth. Attribute every claim ("MDPD said," "according to the sheriff's office," "the department's account"). Never write a use-of-force or fatal-encounter story as fact-from-police; write it as "Police account: X. Family/witnesses dispute: Y. Body-cam footage shows Z." Prioritize court filings, body-cam footage, civilian witnesses, and independent reporting over PIO statements. Default framing for police-involved incidents is neutral and skeptical — not press-release-summarizing. Skip routine "arrest happened" wire copy unless there's a public-interest angle (corruption, pattern of force, prominent person, named institution, civil-rights concern).

ACCOUNTABILITY BIAS. When sources offer both an institutional account and a community/civilian account of the same event, foreground the civilian one and contextualize the institutional one. When a public body announces something (rezoning, contract award, salary, fee), surface who benefits and who pays. When a developer or business says X, ask what the cited reporting shows about previous claims.

EVERY OUTPUT IS AN EVENT. miami.community has deprecated stand-alone articles — every published item is an event. Two flavors share the same output shape:
- kind="scheduled" — a future happening (concert, opening, vote, exhibition, market, game, meeting). \`startsAtIso\` = when it happens. Calendar-style \`description\`; \`dek\` + \`body\` usually empty. Many of your input items come from iCal feeds (museums, universities, city governments) — those are pure scheduled events.
- kind="reported" — a news event that already occurred (a vote was passed, a trade was announced, an arrest made, a record broken). \`startsAtIso\` = when the news event happened. \`dek\` (≤120 chars) + \`body\` (30-60 words, ONE paragraph) carry full newspaper-style editorial copy. The newspaper UI leads with these.
For an iCal-sourced listing: emit ONE scheduled event, body empty. For a news wire item: emit ONE reported event with full editorial dek+body. When the SAME thing arrives from multiple sources, emit ONE row with all matching citationItemIndices — do not duplicate.

PUBLISH WHEN IT'S MIAMI. If an item passes the Miami test, publish it. Short factual coverage of small things (a new opening, a Heat schedule announcement, a school-board vote, a Miami-Dade arrest, a feature on a Miami YouTuber) is exactly the paper. Fold same-event coverage with updateOfRelatedIndex. **An empty events array means everything you saw was non-Miami wire copy — possible, but rare.** Bias toward MORE events, not fewer; the bar is "has a date" + "happens in / is about Miami-Dade".

Voice across every section: matter-of-fact, plainly written, shorter than the source. The reader has 30 seconds. Lead with what happened. Skip cliché ("amid", "as", "after", "in a sign that"). No headlinese, no questions in headlines, no clickbait. State only what the cited sources support.

You will be told what sections exist and which one each event should file under. Pick the most specific section that fits. Tone shifts subtly by section (urgent for breaking news, sensory for food, even-handed for politics) but voice stays one — the smart-friend register, no AI tells, no PR speak.`

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
        // `data` sources used to feed the metrics table via
        // fetchDataMetrics. Metrics were retired in the section
        // restructure (Miami in Numbers is gone), so any source still
        // tagged `data` gets skipped silently — leave the row in place
        // but don't try to fetch from it. The /admin/sources UI can
        // delete them at the operator's convenience.
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

      // Related pool spans all sections — the mega-desk dedupes
      // against the full event catalog, not one beat. 40 entries over
      // 14 days gives the Miami-Test signal (no plausible tie ⇒ skip)
      // a meaningful slice of recent coverage to compare against.
      // Switched from articles.recentForLinking → events.recentForLinking
      // as part of the events-only pivot.
      const relatedPool = await ctx.runQuery(api.events.recentForLinking, {
        limit: 40,
        lookbackHours: 336,
      })
      const relatedCandidates: Array<RelatedCandidate> = relatedPool.map(
        (e, idx) => ({
          index: idx,
          section: e.section?.name ?? "—",
          title: e.title,
          dek: e.dek,
          publishedAt: e.publishedAt
            ? new Date(e.publishedAt).toISOString().slice(0, 10)
            : undefined,
          tags: e.tags,
          neighborhoods: e.neighborhoods,
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

      await log(`Calling ${model} (${reservation.centsSpent}¢ today)`)
      const { events, rawEventCount, stopReason, rawInputSnippet } =
        await generateDrafts({
          systemPrompt: MEGA_SYSTEM_PROMPT,
          model,
          items: draftItems,
          maxDrafts: MEGA_MAX_DRAFTS,
          relatedCandidates,
          sectionChoices,
        })
      const dropped = rawEventCount - events.length
      await log(
        `LLM returned ${events.length} events (${rawEventCount} raw, ${dropped} dropped in validation)`,
      )
      if (rawEventCount === 0) {
        await log(
          `Empty events diagnostic — stop_reason=${stopReason} input=${rawInputSnippet}`,
        )
      }

      // Mark every candidate the LLM saw as consumed — whether it
      // became an event or not. Items the LLM rejected (non-Miami
      // wire copy, generic feed noise, items below the bar) won't
      // recycle endlessly on the unconsumed queue.
      await ctx.runMutation(api.agentsData.markItemsConsumed, {
        itemIds: candidates.map((c) => c.item._id),
      })

      // 4.5. Rubric grader gate. Each candidate event gets a separate
      //      Haiku call with a clean context window — the writer's
      //      reasoning chain doesn't influence the verdict. Modeled on
      //      Anthropic's "Outcomes" pattern: the writer optimizes for
      //      editorial flow, the grader checks policy compliance.
      //      Borderline cases pass; only obvious rubric breaks (out-of-
      //      county wire, blotter without hook, missing editorial body)
      //      get filtered. Grader failures (network error, malformed
      //      response) default to PASS so the gate never blocks on its
      //      own unreliability.
      //
      //      Runs in parallel — 20 events ≈ 1s wall time, ~$0.01/run.
      const GRADER_MODEL = "claude-haiku-4-5-20251001"
      const grades =
        events.length > 0
          ? await Promise.all(
              events.map((ev) =>
                verifyEventRubric({
                  model: GRADER_MODEL,
                  event: {
                    title: ev.title,
                    dek: ev.dek,
                    body: ev.body,
                    description: ev.description,
                    kind: ev.kind,
                    locationName: ev.locationName,
                    neighborhoodSlugs: ev.neighborhoodSlugs,
                    tags: ev.tags,
                    sectionSlug: ev.sectionSlug,
                  },
                }).catch(() => null),
              ),
            )
          : []
      const graderRejects: Array<{ title: string; reason: string }> = []
      const passed = events.filter((ev, i) => {
        const verdict = grades[i]
        if (verdict && !verdict.passes) {
          graderRejects.push({ title: ev.title, reason: verdict.reason })
          return false
        }
        return true
      })
      if (events.length > 0) {
        const rejectSample = graderRejects
          .slice(0, 5)
          .map((r) => `  • "${r.title.slice(0, 60)}" — ${r.reason}`)
          .join("\n")
        await log(
          `Grader passed ${passed.length}/${events.length}` +
            (rejectSample ? `; rejected:\n${rejectSample}` : ""),
        )
      }

      // Section fallback — every event must land in a real section.
      // Politics is now the catch-all for civic items the LLM didn't
      // route (the old "news" parent is gone post-events-pivot). Falls
      // through to the first available section if politics is also
      // missing, so a fresh deploy still inserts.
      const fallbackSectionId =
        sectionIdBySlug.get("politics") ?? allSections[0]?._id
      if (!fallbackSectionId) {
        throw new Error("No sections configured — cannot insert events")
      }

      // 5. Insert events. Single loop now handles both kind=scheduled
      //    (calendar items) and kind=reported (news events with full
      //    editorial dek+body). Dedupe via augmentEvent when the LLM
      //    flags updateOfRelatedIndex; otherwise hero-resolve + insert
      //    new.
      for (const ev of passed) {
        const validIndices = ev.citationItemIndices.filter(
          (i) => i >= 0 && i < candidates.length,
        )
        if (validIndices.length === 0) {
          await log(`Skipped event "${ev.title}" — no valid citations`)
          continue
        }
        const startsAt = new Date(ev.startsAtIso).getTime()
        if (Number.isNaN(startsAt)) {
          await log(`Skipped event "${ev.title}" — bad startsAtIso`)
          continue
        }
        const endsAt = ev.endsAtIso
          ? new Date(ev.endsAtIso).getTime()
          : undefined
        const citedCandidates = validIndices.map((i) => candidates[i])
        const sourceItemIds = citedCandidates.map((c) => c.item._id)
        const citations = citedCandidates.map((c) => ({
          url: c.item.url,
          title: c.item.title,
          publisher: c.sourceName,
          fetchedAt: c.item.fetchedAt,
          snippet: c.item.snippet,
        }))

        // Dedupe path — same shape as the legacy article augment.
        if (
          ev.updateOfRelatedIndex !== undefined &&
          ev.updateOfRelatedIndex >= 0 &&
          ev.updateOfRelatedIndex < relatedPool.length
        ) {
          const target = relatedPool[ev.updateOfRelatedIndex]
          const result = await ctx.runMutation(api.events.augmentEvent, {
            eventId: target._id,
            newCitations: citations,
            newSourceItems: sourceItemIds,
            patch: {
              title: ev.title,
              dek: ev.dek,
              body: ev.body ? toSingleParagraph(ev.body) : undefined,
              description: ev.description,
            },
            agentSlug: MEGA_DESK_SLUG,
            agentRunId: runId,
          })
          if (result.merged) {
            await log(
              `Augmented "${target.title}" (+${result.citationsAdded} citations${
                result.contentUpdated ? ", content refreshed" : ""
              })`,
            )
            continue
          }
          // Fall through if the target was archived/rejected.
        }

        // Hero resolution prioritizes the event's own URL first, then
        // the cited source URLs. Reported events get a punchier query
        // ("Miami " + title) to bias toward editorial photos; scheduled
        // events use the venue's own URL as the lead candidate.
        const heroUrls = [
          ...(ev.url ? [ev.url] : []),
          ...citations.map((c) => c.url),
        ]
        const heroQuery =
          ev.kind === "reported" ? `Miami ${ev.title}` : ev.title
        const hero = await resolveHero(heroUrls, heroQuery)

        const sectionId =
          (ev.sectionSlug
            ? sectionIdBySlug.get(ev.sectionSlug)
            : undefined) ?? fallbackSectionId

        // Cross-link to recently-published events the LLM flagged as
        // siblings/follow-ups.
        const relatedEventIds = ev.relatedEventIndices
          .filter((i) => i >= 0 && i < relatedPool.length)
          .map((i) => relatedPool[i]._id)

        try {
          await ctx.runMutation(internal.events.insertExtracted, {
            event: {
              slug: slugify(ev.suggestedSlug || ev.title),
              title: ev.title,
              description: ev.description,
              dek: ev.dek,
              body: ev.body ? toSingleParagraph(ev.body) : undefined,
              kind: ev.kind,
              videoEmbed:
                ev.videoProvider && ev.videoId
                  ? { provider: ev.videoProvider, id: ev.videoId }
                  : undefined,
              startsAt,
              endsAt: Number.isFinite(endsAt) ? endsAt : undefined,
              allDay: ev.allDay,
              locationName: ev.locationName,
              neighborhoods: filterNeighborhoodSlugs(
                ev.neighborhoodSlugs ?? [],
              ),
              url: ev.url,
              price: ev.price,
              heroImage: hero.source !== "none" ? hero.url : undefined,
              heroSource: hero.source,
              heroCaption:
                hero.source === "source"
                  ? `Image: ${hostname(citations[0]?.url ?? "")}`
                  : hero.source === "wikimedia"
                    ? hero.caption
                    : undefined,
              sectionId,
              tags: cleanTags(ev.tags ?? []),
              relatedEventIds:
                relatedEventIds.length > 0 ? relatedEventIds : undefined,
              citations,
            },
            agentSlug: MEGA_DESK_SLUG,
            agentRunId: runId,
            derivedFromItems: sourceItemIds,
          })
          eventsCreated += 1
          if (ev.kind === "reported") {
            draftsCreated += 1 // legacy counter, surfaced to the editor UI
          }
        } catch (e) {
          await log(
            `Skipped event "${ev.title}": ${e instanceof Error ? e.message : String(e)}`,
          )
        }
      }
      if (eventsCreated > 0) {
        await log(`Created ${eventsCreated} events`)
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
    return await ctx.runAction(internal.agents.runMegaDeskInternal, {})
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
      return { summary: "mega-desk: skipped — CRONS_ENABLED not set" }
    }
    const hour = miamiHour()
    if (hour >= QUIET_HOURS_START && hour < QUIET_HOURS_END) {
      return {
        summary: `mega-desk: skipped — quiet hours (${hour}:00 ET, runs resume at ${QUIET_HOURS_END}:00 ET)`,
      }
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
    await requireEditorInAction(ctx)
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
