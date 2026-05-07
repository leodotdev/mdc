import Anthropic from "@anthropic-ai/sdk"

import { NEIGHBORHOODS } from "./neighborhoods"

export type DraftItem = {
  index: number
  source: string
  url: string
  title: string
  publishedAt?: string
  body: string
}

// Candidate already-published article that the new draft might be related to.
// Indexed separately from source items so the LLM can return either-or both.
export type RelatedCandidate = {
  index: number
  section: string
  title: string
  dek: string
  publishedAt?: string
}

export type LlmDraft = {
  title: string
  dek: string
  body: string
  tags: Array<string>
  citationItemIndices: Array<number>
  // Indices into the relatedCandidates[] passed to the LLM. May be empty.
  relatedArticleIndices: Array<number>
  // Optional Miami-neighborhood slugs this story is tied to. Validated
  // against the allowed list at insert time.
  neighborhoodSlugs: Array<string>
  // Section the LLM picked for this draft — must be the desk's primary
  // section or one of its sub-sections (validated server-side; falls back
  // to the desk's primary on miss).
  sectionSlug?: string
  // When set: this draft is a follow-up on an EXISTING article rather than
  // a new story. Index points into relatedCandidates[]. The server merges
  // citations into that article (and updates content if it's still
  // pending review) instead of creating a new article.
  updateOfRelatedIndex?: number
  suggestedSlug: string
}

export type SectionChoice = {
  slug: string
  name: string
  description: string
}

// Standalone event extracted from source items. Lives alongside drafts
// because most events are mentioned in news copy; some are drafted into
// articles, others stand on their own (a public meeting, a holiday).
//
// Section parity with articles: every event belongs to a section. The
// desk's LLM picks the most specific section from its allowed tree,
// identical to how it picks `sectionSlug` for drafts.
export type LlmEvent = {
  title: string
  description: string
  startsAtIso: string
  endsAtIso?: string
  allDay: boolean
  locationName?: string
  url?: string
  price?: string
  /** kebab-case slug, ≤ 80 chars. */
  suggestedSlug: string
  tags: Array<string>
  /** Multi-slug neighborhoods, validated against lib/neighborhoods.ts. */
  neighborhoodSlugs: Array<string>
  /** Picked from the desk's allowed sections. Falls back to desk primary. */
  sectionSlug?: string
  citationItemIndices: Array<number>
  /** Indices into `relatedCandidates` for sibling articles. */
  relatedArticleIndices: Array<number>
  /** Optional index into `drafts[]` of this same response for cross-link. */
  relatedDraftIndex?: number
}

export type LlmMetric = {
  slug: string
  title: string
  subtitle?: string
  kind: "number" | "number-with-delta" | "line" | "bars" | "rank" | "compare"
  data: unknown
  unit?: string
  relatedTags: Array<string>
  relatedSectionSlugs: Array<string>
  citationItemIndices: Array<number>
}

export type DraftBatch = {
  drafts: Array<LlmDraft>
  events: Array<LlmEvent>
  metrics: Array<LlmMetric>
  /** Number of draft objects the LLM emitted before validation. When
   *  this is > drafts.length, drafts were dropped for missing/invalid
   *  required fields — the diagnostic helps distinguish "model produced
   *  nothing" from "model produced unusable output." */
  rawDraftCount: number
}

function buildDraftTool(sectionSlugs: Array<string>) {
  const draftProperties: Record<string, unknown> = {
    title: {
      type: "string",
      description:
        "Snappy local-newspaper headline. TARGET 6–10 words, HARD CAP 60 characters. Active voice. Lead with the news, not the institution. Do NOT mirror the source publication's headline — rewrite it shorter, clearer, more direct. No hedging words ('amid', 'as', 'after'), no headlinese clichés, no questions, no clickbait.",
    },
    dek: {
      type: "string",
      description:
        "One-sentence standfirst that adds new info beyond the headline (don't restate it). HARD CAP 120 characters / ~20 words. Concrete, not vague. No 'in a sign that…' / 'amid growing concerns…' / 'experts say'. Skip if a strong dek would just rephrase the headline.",
    },
    body: {
      type: "string",
      description:
        "Article body in plain prose: ONE paragraph, 40–80 words. The shortest version that gives the reader who/what/where/when and why it matters in Miami. Active voice, short sentences, no line breaks, no Markdown, no bullet points. Do NOT paraphrase the source paragraph-by-paragraph — distill it.",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description:
        "2-5 lowercase tags. Tags are **reusable taxonomy hooks** — only pick tags that other stories or events will plausibly share. Good: ongoing series ('formula-1', 'art-basel'), beats ('housing', 'transit'), institutions ('miami-dade-county', 'inter-miami', 'um'), named people, neighborhood slugs ('wynwood', 'little-havana'), recurring topics ('hurricane-season', 'algorithmic-bias'). BAD (do NOT use): single-event names ('fan-fest', 'opening-night-gala'), marketing slugs, ad-hoc descriptors that won't recur. NEVER use generic location tags ('miami', 'miami-dade', 'florida') — every story is local by definition. When in doubt, drop the tag.",
    },
    citationItemIndices: {
      type: "array",
      items: { type: "integer" },
      description: "Indices into the source items[] passed in. Must include ≥1.",
    },
    relatedArticleIndices: {
      type: "array",
      items: { type: "integer" },
      description:
        "Indices into the related candidate articles[] (if any were provided). Use this when this draft is a follow-up, background, or another angle on an existing article. 0–3 entries; leave empty if nothing is genuinely related.",
    },
    updateOfRelatedIndex: {
      type: "integer",
      description:
        "Use this ONLY when the source items are reporting on the SAME story we already published in one of the related candidate articles — not a follow-up, not background, but the same event from a different outlet. Set to the candidate's index. The system will merge your sources into the existing article. Leave unset for distinct stories or genuine follow-ups (use relatedArticleIndices instead for follow-ups).",
    },
    neighborhoodSlugs: {
      type: "array",
      items: { type: "string", enum: NEIGHBORHOODS.map((n) => n.slug) },
      description:
        "Miami neighborhood slugs this story is tied to. 0–3 entries. Only include a neighborhood when the story is genuinely about a specific place — leave empty for citywide / county-wide stories. Use ONLY slugs from the allowed list.",
    },
    suggestedSlug: { type: "string", description: "kebab-case slug (≤80 chars)" },
  }
  const draftRequired = [
    "title",
    "dek",
    "body",
    "tags",
    "citationItemIndices",
    "relatedArticleIndices",
    "neighborhoodSlugs",
    "suggestedSlug",
  ]
  // Only inject sectionSlug when the desk has multiple options to choose
  // from — keeps single-section desks unchanged and avoids a useless
  // 1-element enum.
  if (sectionSlugs.length > 1) {
    draftProperties.sectionSlug = {
      type: "string",
      enum: sectionSlugs,
      description:
        "Section to file this story under. Pick the MOST SPECIFIC match from the desk's allowed sections (primary + sub-sections). When in doubt, use the desk's primary section.",
    }
    draftRequired.push("sectionSlug")
  }

  return {
    name: "publish_articles",
    description:
      "Publish one or more short articles to miami.community. Articles go live immediately — there is no editor review queue. Each article must cite at least one source item by index.",
    input_schema: {
      type: "object",
      properties: {
        articles: {
          type: "array",
          items: {
            type: "object",
            properties: draftProperties,
            required: draftRequired,
          },
          description:
            "Articles to publish. This array should rarely be empty — when you have N items in the input, expect ~N articles back, minus duplicates of already-published stories and items not Miami-Dade-relevant.",
        },
        events: {
        type: "array",
        description:
          "Specific upcoming events mentioned in the cited source items. Include only events with a verifiable date and (where applicable) location. Leave the array empty when sources don't mention concrete events. NEVER invent dates, times, or locations.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short event title (≤100 chars)" },
            description: {
              type: "string",
              description:
                "Snappy 1–2 sentence description in our house voice (≤300 chars). Same register as article deks: lead with the news, no filler.",
            },
            suggestedSlug: {
              type: "string",
              description:
                "kebab-case slug for the event detail URL (≤80 chars). Should not include the date — the system disambiguates with timestamp when needed.",
            },
            startsAtIso: {
              type: "string",
              description:
                "Start time in ISO 8601 with Miami offset (e.g. 2026-05-15T19:00:00-04:00). REQUIRED.",
            },
            endsAtIso: {
              type: "string",
              description: "Optional end time in ISO 8601.",
            },
            allDay: {
              type: "boolean",
              description: "True for all-day events (holidays, multi-day festivals).",
            },
            locationName: { type: "string", description: "Venue or place name." },
            url: { type: "string", description: "Canonical event URL if mentioned." },
            price: { type: "string", description: "e.g. 'Free' or '$15-30'." },
            tags: {
              type: "array",
              items: { type: "string" },
              description:
                "2–5 lowercase reusable taxonomy tags. Pick tags that OTHER events or stories will share — ongoing series ('formula-1', 'art-basel', 'calle-ocho'), beats ('public-art', 'live-music'), institutions, named people, neighborhood slugs. NEVER one-off event names ('fan-fest', 'opening-gala'), marketing slugs, or ad-hoc descriptors. NEVER 'miami' / 'miami-dade' / 'florida'. When in doubt, drop the tag.",
            },
            neighborhoodSlugs: {
              type: "array",
              items: { type: "string", enum: NEIGHBORHOODS.map((n) => n.slug) },
              description:
                "Miami neighborhood slugs the event ties to. 0–3 entries. Use ONLY slugs from the allowed list.",
            },
            sectionSlug: {
              type: "string",
              description:
                "Section to file this event under. Pick from the desk's allowed sections (same list as drafts). Default to the desk's primary section if no sub-section fits.",
            },
            citationItemIndices: {
              type: "array",
              items: { type: "integer" },
              description:
                "Source item indices that mention this event. Must include ≥1.",
            },
            relatedArticleIndices: {
              type: "array",
              items: { type: "integer" },
              description:
                "Indices into the related candidate articles[] for sibling stories. 0–3 entries. Empty is fine.",
            },
            relatedDraftIndex: {
              type: "integer",
              description:
                "Optional index into drafts[] of this same response, when the event is the subject of a draft.",
            },
          },
          required: [
            "title",
            "description",
            "suggestedSlug",
            "startsAtIso",
            "allDay",
            "tags",
            "neighborhoodSlugs",
            "citationItemIndices",
            "relatedArticleIndices",
          ],
        },
      },
      metrics: {
        type: "array",
        description:
          "Promote a number from the cited sources to a first-class Miami metric. ONLY when the source explicitly states the number — never estimate or compute. Examples: census population counts, BLS unemployment rates, NAR median home prices, ranking-list mentions ('Miami ranks #4 in cost of living'). The number must be locally relevant (Miami-Dade, Miami metro, South Florida, Florida statewide for big-picture stats). Empty array is the default. Each metric must cite at least one source item.",
        items: {
          type: "object",
          properties: {
            slug: {
              type: "string",
              description:
                "kebab-case slug, ≤80 chars. Pick a stable identifier so re-runs that find a fresher version of the same metric upsert in place. Example slugs: 'miami-dade-population', 'miami-metro-unemployment', 'miami-median-home-price', 'miami-cost-of-living-rank'.",
            },
            title: {
              type: "string",
              description:
                "Short label (≤60 chars). Reads as a stat headline: 'Miami-Dade population', 'Median home price', 'Cost of living rank'.",
            },
            subtitle: {
              type: "string",
              description:
                "Optional 1-line context (≤80 chars). Period covered, source agency, vintage. Example: 'Census ACS 2024 5-year', 'BLS, Apr 2026'.",
            },
            kind: {
              type: "string",
              enum: [
                "number",
                "number-with-delta",
                "line",
                "bars",
                "rank",
                "compare",
              ],
              description:
                "Shape of the data. `number` = single value. `number-with-delta` = value plus YoY/QoQ change. `line` = time series. `bars` = categorical breakdown. `rank` = position on a list. `compare` = two values side by side.",
            },
            data: {
              type: "object",
              description:
                "Payload — shape varies by kind. number/number-with-delta: { value, delta?: { value, period } }. line/bars: { points: [{ label, value }] }. rank: { value, outOf, list }. compare: { left: { label, value }, right: { label, value } }.",
            },
            unit: {
              type: "string",
              description:
                "Display unit, e.g. 'people', '%', '$', 'rank of 50'. Optional.",
            },
            relatedTags: {
              type: "array",
              items: { type: "string" },
              description:
                "Tags that signal which articles this metric is relevant to. The renderer can auto-embed when an article shares these tags. Lowercase, reusable.",
            },
            relatedSectionSlugs: {
              type: "array",
              items: { type: "string" },
              description:
                "Section slugs this metric belongs to (e.g. ['real-estate', 'business']). Empty = homepage-eligible.",
            },
            citationItemIndices: {
              type: "array",
              items: { type: "integer" },
              description:
                "Source item indices that supplied this metric. Must include ≥1 — never invent numbers.",
            },
          },
          required: [
            "slug",
            "title",
            "kind",
            "data",
            "relatedTags",
            "relatedSectionSlugs",
            "citationItemIndices",
          ],
        },
      },
    },
      required: ["articles", "events"],
    },
  } as const
}

function validateDraft(raw: unknown): LlmDraft | null {
  if (!raw || typeof raw !== "object") return null
  const d = raw as Record<string, unknown>
  if (typeof d.title !== "string") return null
  if (typeof d.dek !== "string") return null
  if (typeof d.body !== "string") return null
  if (!Array.isArray(d.tags)) return null
  if (!d.tags.every((t) => typeof t === "string")) return null
  if (!Array.isArray(d.citationItemIndices)) return null
  if (!d.citationItemIndices.every((i) => Number.isInteger(i))) return null
  if (d.citationItemIndices.length === 0) return null
  if (typeof d.suggestedSlug !== "string") return null
  // relatedArticleIndices is optional in legacy responses; default to [].
  const related = Array.isArray(d.relatedArticleIndices)
    ? (d.relatedArticleIndices as Array<unknown>).filter((i) =>
        Number.isInteger(i),
      ).slice(0, 3) as Array<number>
    : []
  const neighborhoods = Array.isArray(d.neighborhoodSlugs)
    ? (d.neighborhoodSlugs as Array<unknown>)
        .filter((s): s is string => typeof s === "string")
        .slice(0, 3)
    : []
  const sectionSlug =
    typeof d.sectionSlug === "string" ? d.sectionSlug : undefined
  const updateOfRelatedIndex = Number.isInteger(d.updateOfRelatedIndex)
    ? (d.updateOfRelatedIndex as number)
    : undefined
  return {
    title: d.title.slice(0, 200),
    dek: d.dek.slice(0, 400),
    body: d.body,
    tags: d.tags,
    citationItemIndices: d.citationItemIndices as Array<number>,
    relatedArticleIndices: related,
    neighborhoodSlugs: neighborhoods,
    sectionSlug,
    updateOfRelatedIndex,
    suggestedSlug: d.suggestedSlug,
  }
}

export type MetricCatalogEntry = {
  slug: string
  title: string
  unit?: string
  /** Tags that should trigger an inline embed when matched on a draft's tags. */
  relatedTags: ReadonlyArray<string>
}

export async function generateDrafts(opts: {
  systemPrompt: string
  model: string
  items: Array<DraftItem>
  maxDrafts: number
  relatedCandidates?: Array<RelatedCandidate>
  /** Sections the desk can file stories under (primary + children). */
  sectionChoices?: Array<SectionChoice>
  /** Current metric catalog. The LLM may drop `[[metric:slug]]` tokens
   *  into the body of any draft whose tags match the metric's
   *  relatedTags — the article renderer expands them inline. */
  metricCatalog?: ReadonlyArray<MetricCatalogEntry>
}): Promise<DraftBatch> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set in Convex env")
  const client = new Anthropic({ apiKey })

  const itemsText = opts.items
    .map((item) => {
      const date = item.publishedAt ? ` (${item.publishedAt})` : ""
      return `[${item.index}] ${item.source} — ${item.title}${date}\nURL: ${item.url}\n${item.body}\n`
    })
    .join("\n---\n")

  const relatedText =
    opts.relatedCandidates && opts.relatedCandidates.length > 0
      ? opts.relatedCandidates
          .map((c) => {
            const date = c.publishedAt ? ` (${c.publishedAt})` : ""
            return `[${c.index}] ${c.section} — ${c.title}${date}\n  ${c.dek}`
          })
          .join("\n")
      : ""

  const sectionChoices = opts.sectionChoices ?? []
  const sectionSlugs = sectionChoices.map((s) => s.slug)
  const sectionsText =
    sectionChoices.length > 1
      ? sectionChoices
          .map((s, i) => {
            const tag = i === 0 ? " (primary)" : ""
            return `- ${s.slug}${tag} — ${s.name}: ${s.description}`
          })
          .join("\n")
      : ""

  const userPrompt = [
    `You may produce up to ${opts.maxDrafts} short articles.`,
    `Return your articles ONLY by calling the \`publish_articles\` tool. Do not return article copy in your textual response.`,
    `Articles publish IMMEDIATELY when you submit them — there is no editor review queue. This isn't a "draft" workflow; what you submit goes straight to readers.`,
    `Each article MUST cite at least one source item by its bracket index above.`,
    ``,
    `EDITORIAL VOICE — read this twice.`,
    `miami.community is the AI-edited local paper that reads like a smart friend telling you what happened in plain English. Source publications write at length for general audiences; we don't. Our job is to take their reporting and make it SHORTER, SNAPPIER, CLEARER for a busy Miami reader. If your article reads like the source headline / lede with light edits, rewrite it.`,
    ``,
    `Hard rules:`,
    `- Headline: 6–10 words, ≤ 60 chars. Active voice. Lead with the news. Never copy or near-copy the source publication's headline.`,
    `- Dek: ≤ 120 chars / ~20 words. ADDS information the headline doesn't carry — don't restate. If you'd just be rewording the headline, write a shorter dek with one concrete fact (a number, a place, a name).`,
    `- Body: ONE paragraph, 40–80 words. The shortest version that answers who/what/where/when + why a Miamian should care. Distill, don't paraphrase. Cut every sentence that doesn't add a fact.`,
    `- State only facts present in the cited items. Do not fabricate quotes, names, dates, or numbers. If something's missing, omit it.`,
    `- Never reproduce source text verbatim — re-express in our voice.`,
    `- No headlinese / hedging clichés ("amid", "as", "after", "in a sign that", "experts say", "comes as", "raises concerns"). Cut them.`,
    `- No clickbait. No questions in headlines. No "you'll never believe", "here's what", etc.`,
    `- The ONLY reasons to omit an item from your articles array: (i) it's a duplicate of an existing article on the site (use updateOfRelatedIndex), or (ii) it's clearly not Miami-Dade-relevant (e.g. a Trump/EU trade deal headline carried by Local 10's wire). "Maybe not interesting enough" is NOT a reason to skip — publish it.`,
    relatedText
      ? `- For each article, look at the "Recently published articles" list below. If your article is a follow-up, background context, or another angle on one of those, include its bracket index in \`relatedArticleIndices\`. 0–3 entries. Empty is fine — only link when the connection is real.`
      : `- Leave \`relatedArticleIndices\` empty (no recent articles available).`,
    relatedText
      ? `- DEDUPE — BE AGGRESSIVE. If your incoming sources cover the same NEWS EVENT, INCIDENT, PERSON, or specific TOPIC as one of the candidate articles, set \`updateOfRelatedIndex\` to that candidate's bracket index instead of publishing a new article. Two stories about the same person/place/incident are the same news. Two stories quoting the same officials about the same matter are the same news. Two stories listing the same upcoming concert / opening / closure are the same news. Two stories about the same legal case, the same vote, the same arrest, the same death, the same charge — ALL the same news. The system will merge your incoming sources into the existing article and re-render the body with the broader citation set. Only use \`relatedArticleIndices\` (not updateOfRelatedIndex) for clearly distinct angles or clear follow-ups (the day-after analysis, a profile of someone tangentially involved, a sidebar).`
      : "",
    sectionsText
      ? `- For each article, set \`sectionSlug\` to the most specific section from this desk's allowed list (below). Default to the desk's primary section if no sub-section is a clearer fit.`
      : "",
    `- ALSO populate \`events\`: extract any specific upcoming events mentioned in the source items. Required fields: title, description, suggestedSlug, startsAtIso (ISO 8601 with Miami offset), allDay, tags, neighborhoodSlugs, citationItemIndices, relatedArticleIndices. STRICT: only include events with an explicit date in the source — never invent dates. Pick \`sectionSlug\` from the desk's allowed sections (same options as articles) so the event files under the right section. Empty array is fine when sources mention no concrete events.`,
    (opts.metricCatalog ?? []).length > 0
      ? `- INLINE METRIC EMBEDS: when an article's tags overlap with a metric's relatedTags below, drop a \`[[metric:slug]]\` token into the body on its own line where the metric's number would naturally appear. The renderer expands the token into a compact widget. Use sparingly — at most one embed per article, and only when the metric directly supports the story's claim. Example: a story about cost of living that overlaps with the 'miami-cost-of-living-rank' metric → drop \`[[metric:miami-cost-of-living-rank]]\` near the relevant sentence.`
      : "",
    ``,
    `Source items:`,
    itemsText,
    ...(sectionsText
      ? ["", `Allowed sections for this desk (use the slug for sectionSlug):`, sectionsText]
      : []),
    ...(relatedText
      ? ["", `Recently published articles (for relatedArticleIndices):`, relatedText]
      : []),
    ...((opts.metricCatalog ?? []).length > 0
      ? [
          "",
          `Available metrics for inline embeds (slug — title — relatedTags):`,
          ...(opts.metricCatalog ?? []).map(
            (m) =>
              `- ${m.slug} — ${m.title}${m.unit ? ` (${m.unit})` : ""} — tags: ${m.relatedTags.length > 0 ? m.relatedTags.join(", ") : "(none)"}`,
          ),
        ]
      : []),
  ]
    .filter(Boolean)
    .join("\n")

  const response = await client.messages.create({
    model: opts.model,
    max_tokens: 4096,
    system: [
      {
        type: "text",
        text: opts.systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [buildDraftTool(sectionSlugs)],
    tool_choice: { type: "tool", name: "publish_articles" },
    messages: [{ role: "user", content: userPrompt }],
  })

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  )
  if (!toolUse) throw new Error("LLM did not return a tool_use block")
  const input = toolUse.input as {
    articles?: unknown
    /** Legacy property name — kept so older deployments mid-rename
     *  don't drop everything. Read whichever is present. */
    drafts?: unknown
    events?: unknown
    metrics?: unknown
  }
  // The model occasionally calls the tool with no drafts array — usually
  // when it found nothing draft-worthy this batch but still wanted to
  // emit events or metrics. Treat the absence as an empty array rather
  // than failing the run.
  const rawDrafts = Array.isArray(input.articles)
    ? input.articles
    : Array.isArray(input.drafts)
      ? input.drafts
      : []
  const drafts = rawDrafts
    .map(validateDraft)
    .filter((d): d is LlmDraft => d !== null)
  const droppedDrafts = rawDrafts.length - drafts.length
  if (droppedDrafts > 0) {
    // Dump the raw shape of the first invalid draft so we can see
    // which required field the model omitted.
    const firstInvalid = rawDrafts.find((r) => validateDraft(r) === null)
    console.warn(
      `[generateDrafts] dropped ${droppedDrafts}/${rawDrafts.length} drafts during validation. First invalid raw object:`,
      JSON.stringify(firstInvalid)?.slice(0, 600),
    )
  }
  const events = Array.isArray(input.events)
    ? input.events
        .map(validateEvent)
        .filter((e): e is LlmEvent => e !== null)
    : []
  const metrics = Array.isArray(input.metrics)
    ? input.metrics
        .map(validateMetric)
        .filter((m): m is LlmMetric => m !== null)
    : []
  return {
    drafts,
    events,
    metrics,
    rawDraftCount: rawDrafts.length,
  }
}

function validateMetric(raw: unknown): LlmMetric | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (typeof r.slug !== "string" || !r.slug) return null
  if (typeof r.title !== "string" || !r.title) return null
  if (
    r.kind !== "number" &&
    r.kind !== "number-with-delta" &&
    r.kind !== "line" &&
    r.kind !== "bars" &&
    r.kind !== "rank" &&
    r.kind !== "compare"
  ) {
    return null
  }
  if (!r.data || typeof r.data !== "object") return null
  if (!Array.isArray(r.citationItemIndices) || r.citationItemIndices.length === 0) {
    return null
  }
  const citationItemIndices = r.citationItemIndices.filter(
    (n): n is number => typeof n === "number" && Number.isInteger(n),
  )
  if (citationItemIndices.length === 0) return null
  const relatedTags = Array.isArray(r.relatedTags)
    ? r.relatedTags.filter((t): t is string => typeof t === "string")
    : []
  const relatedSectionSlugs = Array.isArray(r.relatedSectionSlugs)
    ? r.relatedSectionSlugs.filter((t): t is string => typeof t === "string")
    : []
  return {
    slug: r.slug.slice(0, 80),
    title: r.title.slice(0, 80),
    subtitle: typeof r.subtitle === "string" ? r.subtitle.slice(0, 100) : undefined,
    kind: r.kind,
    data: r.data,
    unit: typeof r.unit === "string" ? r.unit.slice(0, 32) : undefined,
    relatedTags,
    relatedSectionSlugs,
    citationItemIndices,
  }
}

function validateEvent(raw: unknown): LlmEvent | null {
  if (!raw || typeof raw !== "object") return null
  const e = raw as Record<string, unknown>
  if (typeof e.title !== "string" || !e.title.trim()) return null
  if (typeof e.description !== "string") return null
  if (typeof e.startsAtIso !== "string") return null
  if (Number.isNaN(new Date(e.startsAtIso).getTime())) return null
  if (typeof e.allDay !== "boolean") return null
  if (!Array.isArray(e.citationItemIndices)) return null
  if (!e.citationItemIndices.every((i) => Number.isInteger(i))) return null
  if (e.citationItemIndices.length === 0) return null
  const suggestedSlug =
    typeof e.suggestedSlug === "string" && e.suggestedSlug.trim().length > 0
      ? e.suggestedSlug
      : e.title.slice(0, 80)
  const tags = Array.isArray(e.tags)
    ? (e.tags as Array<unknown>)
        .filter((t): t is string => typeof t === "string" && t.length > 0)
        .slice(0, 6)
    : []
  const neighborhoodSlugs = Array.isArray(e.neighborhoodSlugs)
    ? (e.neighborhoodSlugs as Array<unknown>)
        .filter((s): s is string => typeof s === "string")
        .slice(0, 3)
    : []
  const relatedArticleIndices = Array.isArray(e.relatedArticleIndices)
    ? (e.relatedArticleIndices as Array<unknown>)
        .filter((i) => Number.isInteger(i))
        .slice(0, 3) as Array<number>
    : []
  const sectionSlug =
    typeof e.sectionSlug === "string" ? e.sectionSlug : undefined
  return {
    title: e.title.slice(0, 200),
    description: e.description.slice(0, 600),
    startsAtIso: e.startsAtIso,
    endsAtIso:
      typeof e.endsAtIso === "string" &&
      !Number.isNaN(new Date(e.endsAtIso).getTime())
        ? e.endsAtIso
        : undefined,
    allDay: e.allDay,
    locationName:
      typeof e.locationName === "string" ? e.locationName : undefined,
    url: typeof e.url === "string" ? e.url : undefined,
    price: typeof e.price === "string" ? e.price : undefined,
    suggestedSlug,
    tags,
    neighborhoodSlugs,
    sectionSlug,
    citationItemIndices: e.citationItemIndices as Array<number>,
    relatedArticleIndices,
    relatedDraftIndex: Number.isInteger(e.relatedDraftIndex)
      ? (e.relatedDraftIndex as number)
      : undefined,
  }
}

// =====================================================================
// Translation — re-writes a published article's title/dek/body into
// Spanish with the same house voice rules. Not a literal translation:
// the LLM is asked to produce ES copy that reads as snappy as the EN
// did, preserving the ≤60 char title / ≤120 char dek / 40–80 word body
// constraints. Optional heroCaption translates alongside.
//
// Voice anchors: Miami Spanish, conversational, comfortable mixing in
// natural anglicisms (e.g. "el county commission" reads fine here).
// Local proper nouns stay in their original form.
// =====================================================================

export type TranslationOutput = {
  title: string
  dek: string
  body: string
  heroCaption?: string
}

const TRANSLATE_TOOL = {
  name: "translate_article",
  description:
    "Translate a published article into Spanish, preserving the house voice. NOT a literal translation — you are re-writing in the same snappy local-paper register, in Spanish. Hard caps: title ≤ 60 chars, dek ≤ 120 chars, body ONE paragraph 40–80 words. Miami Spanish is the target dialect; mixing in natural anglicisms is fine. Proper nouns (place names, institution names, person names) stay in their original form.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description:
          "Spanish headline. ≤ 60 chars / ~6–10 words. Active voice. Same news lead as the EN, never a literal word-for-word translation.",
      },
      dek: {
        type: "string",
        description:
          "Spanish standfirst. ≤ 120 chars / ~20 words. Adds a fact the headline doesn't carry; doesn't restate it.",
      },
      body: {
        type: "string",
        description:
          "Spanish body. ONE paragraph, 40–80 words, no line breaks, no Markdown. Distill the EN — every sentence carries a fact.",
      },
      heroCaption: {
        type: "string",
        description:
          "Spanish image caption when an English caption was provided. Omit when no EN caption.",
      },
    },
    required: ["title", "dek", "body"],
  },
} as const

function validateTranslation(raw: unknown): TranslationOutput | null {
  if (!raw || typeof raw !== "object") return null
  const t = raw as Record<string, unknown>
  if (typeof t.title !== "string" || !t.title.trim()) return null
  if (typeof t.dek !== "string") return null
  if (typeof t.body !== "string" || !t.body.trim()) return null
  return {
    title: t.title.slice(0, 200),
    dek: t.dek.slice(0, 400),
    body: t.body,
    heroCaption:
      typeof t.heroCaption === "string" && t.heroCaption.trim().length > 0
        ? t.heroCaption
        : undefined,
  }
}

// =====================================================================
// Event translation — same house-voice rewrite for the events table.
// Events store `title` + `description` (no separate dek/body), so the
// tool schema is shorter than the article one. Voice rules mirror the
// LLM extraction: ≤60 char title, ≤300 char description, optional ES
// heroCaption when an EN one exists.
// =====================================================================

export type EventTranslationOutput = {
  title: string
  description: string
  heroCaption?: string
}

const TRANSLATE_EVENT_TOOL = {
  name: "translate_event",
  description:
    "Translate a published event into Spanish, preserving the house voice. NOT a literal translation — re-write in the same snappy local-paper register, in Spanish. Hard caps: title ≤ 60 chars, description ≤ 300 chars / 1–2 sentences. Miami Spanish; mixing in natural anglicisms is fine. Proper nouns (venues, place names, person names) stay in their original form.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description:
          "Spanish event title. ≤ 60 chars. Active voice. Lead with what the event IS, not its publisher / sponsor.",
      },
      description: {
        type: "string",
        description:
          "Spanish description. 1–2 sentences, ≤ 300 chars. Same register as the EN: punchy, factual, concrete.",
      },
      heroCaption: {
        type: "string",
        description:
          "Spanish image caption when an English caption was provided. Omit when no EN caption.",
      },
    },
    required: ["title", "description"],
  },
} as const

function validateEventTranslation(
  raw: unknown,
): EventTranslationOutput | null {
  if (!raw || typeof raw !== "object") return null
  const t = raw as Record<string, unknown>
  if (typeof t.title !== "string" || !t.title.trim()) return null
  if (typeof t.description !== "string" || !t.description.trim()) return null
  return {
    title: t.title.slice(0, 200),
    description: t.description.slice(0, 600),
    heroCaption:
      typeof t.heroCaption === "string" && t.heroCaption.trim().length > 0
        ? t.heroCaption
        : undefined,
  }
}

export async function generateEventTranslation(opts: {
  model: string
  event: {
    title: string
    description: string
    heroCaption?: string
    sectionSlug?: string
    tags: ReadonlyArray<string>
    locationName?: string
  }
}): Promise<EventTranslationOutput | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set in Convex env")
  const client = new Anthropic({ apiKey })

  const userPrompt = [
    `You are translating a published event listing from miami.community — Miami's AI-edited local paper — into Spanish.`,
    `The EN copy is in our house voice: punchy, short, conversational, no headlinese. Reproduce that voice in Spanish, NOT a literal word-for-word translation.`,
    ``,
    `Hard rules:`,
    `- Title: ≤ 60 chars. Active voice.`,
    `- Description: 1–2 sentences, ≤ 300 chars. Concrete facts only.`,
    `- Miami Spanish (Cuban / South-American influences). OK to mix in natural anglicisms.`,
    `- Proper nouns stay in their original form (venue names, neighborhood names, person names).`,
    `- Don't add facts. Don't drop facts. Don't invent dates or prices.`,
    ``,
    `Section: ${opts.event.sectionSlug ?? "—"}`,
    `Tags: ${opts.event.tags.join(", ") || "(none)"}`,
    opts.event.locationName ? `Venue: ${opts.event.locationName}` : "",
    ``,
    `=== EN ===`,
    `Title: ${opts.event.title}`,
    `Description: ${opts.event.description}`,
    opts.event.heroCaption
      ? `Hero caption: ${opts.event.heroCaption}`
      : "",
  ]
    .filter(Boolean)
    .join("\n")

  const response = await client.messages.create({
    model: opts.model,
    max_tokens: 1024,
    messages: [{ role: "user", content: userPrompt }],
    tools: [TRANSLATE_EVENT_TOOL],
    tool_choice: { type: "tool", name: "translate_event" },
  })

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  )
  if (!toolUse) return null
  return validateEventTranslation(toolUse.input)
}

export async function generateTranslation(opts: {
  model: string
  article: {
    title: string
    dek: string
    body: string
    heroCaption?: string
    sectionSlug?: string
    tags: ReadonlyArray<string>
  }
}): Promise<TranslationOutput | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set in Convex env")
  const client = new Anthropic({ apiKey })

  const userPrompt = [
    `You are translating a published article from miami.community — Miami's AI-edited local paper — into Spanish.`,
    `The EN copy is in our house voice: punchy, short, conversational, no headlinese. Reproduce that voice in Spanish, NOT a literal word-for-word translation.`,
    ``,
    `Hard rules:`,
    `- Headline: ≤ 60 chars. Active voice. Same news lead.`,
    `- Dek: ≤ 120 chars / ~20 words. Adds info the headline doesn't carry.`,
    `- Body: ONE paragraph, 40–80 words, no line breaks.`,
    `- Miami Spanish (Cuban, South-American influences). OK to mix in natural anglicisms.`,
    `- Proper nouns stay in their original form (e.g. Miami-Dade County, Inter Miami, Calle Ocho).`,
    `- Don't add facts. Don't drop facts.`,
    ``,
    `Section: ${opts.article.sectionSlug ?? "—"}`,
    `Tags: ${opts.article.tags.join(", ") || "(none)"}`,
    ``,
    `=== EN ===`,
    `Title: ${opts.article.title}`,
    `Dek: ${opts.article.dek}`,
    `Body: ${opts.article.body}`,
    opts.article.heroCaption
      ? `Hero caption: ${opts.article.heroCaption}`
      : "",
  ]
    .filter(Boolean)
    .join("\n")

  const response = await client.messages.create({
    model: opts.model,
    max_tokens: 2048,
    messages: [{ role: "user", content: userPrompt }],
    tools: [TRANSLATE_TOOL],
    tool_choice: { type: "tool", name: "translate_article" },
  })

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  )
  if (!toolUse) return null
  return validateTranslation(toolUse.input)
}

// =====================================================================
// Daily widget content generation. One Opus call produces five entries
// (one per widget kind) for the right rail. Cron fires once a day at
// 04:00 ET; cost lands ~7-12¢ depending on output length.
//
// The prompt asks for verifiable facts only — if the model can't be
// sure of something for a given kind, the field comes back null and
// the widget falls through to its previous-day entry. Better empty than
// fabricated.
// =====================================================================

export type WidgetEntry = {
  kind: "fun-fact" | "on-this-day" | "landmark" | "animal-fact" | "quote"
  title: string
  body: string
  attribution: string | null
  imageHint: string | null
}

const widgetTool: Anthropic.Tool = {
  name: "submit_widgets",
  description:
    "Submit one entry per widget kind. Set fields to null when you can't generate a verifiable entry for that kind — never fabricate.",
  input_schema: {
    type: "object",
    properties: {
      entries: {
        type: "array",
        description:
          "One entry per widget kind. Skip a kind by omitting it; the previous day's entry will continue to render.",
        items: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: [
                "fun-fact",
                "on-this-day",
                "landmark",
                "animal-fact",
                "quote",
              ],
            },
            title: { type: "string", description: "Short label / heading" },
            body: { type: "string", description: "1-3 sentences" },
            attribution: {
              type: ["string", "null"],
              description:
                "Speaker name for quotes; null otherwise.",
            },
            imageHint: {
              type: ["string", "null"],
              description:
                "Wikimedia Commons search query for landmark + animal kinds; null otherwise.",
            },
          },
          required: ["kind", "title", "body"],
        },
      },
    },
    required: ["entries"],
  },
}

export async function generateWidgetBatch(opts: {
  model: string
  todayIso: string
  monthName: string
}): Promise<Array<WidgetEntry>> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set in Convex env")
  const client = new Anthropic({ apiKey })

  const prompt = [
    `Generate one entry for each of these five widgets for miami.community's right rail. Today's date: ${opts.todayIso} (${opts.monthName}).`,
    ``,
    `1. fun-fact — A surprising, verifiably-true fact about Miami-Dade. ≤25 words. Title is a short hook ("Did you know?" / "Trivia"); body is the fact.`,
    `2. on-this-day — A real historical event that happened in Miami-Dade on ${opts.todayIso.slice(5)} (month-day) in any year. Title: "YYYY · Short headline". Body: 1-2 sentences. If you don't know a verifiable event for this exact month-day, OMIT this kind from your output.`,
    `3. landmark — One Miami-Dade landmark with a brief history note. Title: landmark name. Body: 2-3 sentences. imageHint: a Wikimedia Commons search query that would surface a photo (e.g. "Vizcaya Museum facade").`,
    `4. animal-fact — A seasonal-aware note for ${opts.monthName}. Title: animal common name. Body: why it's relevant THIS month (nesting, migration, mating, visibility). imageHint: Wikimedia search query.`,
    `5. quote — A real quote from a historical OR contemporary Miamian (writer, activist, athlete, politician, musician). Title: speaker's name. Body: the exact quote. attribution: speaker's name.`,
    ``,
    `Hard rules:`,
    `- Never fabricate quotes, dates, or events. If you're not certain, omit the kind.`,
    `- Vary picks across runs — landmarks and animals especially shouldn't repeat day-to-day.`,
    `- Scope is Miami-Dade County and immediately adjacent (Broward, Monroe, the Keys, the Everglades).`,
    `- Return strictly via the submit_widgets tool. No textual response.`,
  ].join("\n")

  const response = await client.messages.create({
    model: opts.model,
    max_tokens: 1500,
    tools: [widgetTool],
    tool_choice: { type: "tool", name: "submit_widgets" },
    messages: [{ role: "user", content: prompt }],
  })
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  )
  if (!toolUse) return []
  const input = toolUse.input as { entries?: Array<unknown> }
  const entries: Array<WidgetEntry> = []
  for (const raw of input.entries ?? []) {
    if (!raw || typeof raw !== "object") continue
    const r = raw as Record<string, unknown>
    const kind = r.kind
    if (
      kind !== "fun-fact" &&
      kind !== "on-this-day" &&
      kind !== "landmark" &&
      kind !== "animal-fact" &&
      kind !== "quote"
    )
      continue
    const title = typeof r.title === "string" ? r.title.trim() : ""
    const body = typeof r.body === "string" ? r.body.trim() : ""
    if (!title || !body) continue
    entries.push({
      kind,
      title,
      body,
      attribution: typeof r.attribution === "string" ? r.attribution : null,
      imageHint: typeof r.imageHint === "string" ? r.imageHint : null,
    })
  }
  return entries
}

// =====================================================================
// Merge verification — cheap Haiku call that confirms whether two
// articles cover the same news event. Used by the post-publish merge
// sweep to gate auto-merges so high-confidence-overlap pairs that are
// actually distinct stories (e.g. two Marlins games against the same
// opponent on consecutive days) don't get incorrectly fused.
//
// Cost: ~1¢ per verification. Run only after the cheap title/citation
// pre-filter has already narrowed candidates to plausible pairs.
// =====================================================================

const verifyMergeTool: Anthropic.Tool = {
  name: "verify_merge",
  description:
    "Decide whether two articles cover the SAME news event/incident/topic and should be merged into one canonical article.",
  input_schema: {
    type: "object",
    properties: {
      sameStory: {
        type: "boolean",
        description:
          "True only if the two articles are about the same news event, incident, person, or specific topic. False for distinct events even when they share keywords or cite overlapping sources.",
      },
      reason: {
        type: "string",
        description: "One short sentence explaining the call.",
      },
    },
    required: ["sameStory", "reason"],
  },
}

export async function verifyMerge(opts: {
  model: string
  a: { title: string; dek: string; body: string }
  b: { title: string; dek: string; body: string }
}): Promise<{ sameStory: boolean; reason: string } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set in Convex env")
  const client = new Anthropic({ apiKey })
  const prompt = [
    `Two miami.community articles share enough surface signal (title or citations) that the merge sweep flagged them as a possible duplicate. Decide: are these the SAME news event, incident, or specific topic?`,
    ``,
    `ARTICLE A:`,
    `Title: ${opts.a.title}`,
    `Dek: ${opts.a.dek}`,
    `Body: ${opts.a.body.slice(0, 800)}`,
    ``,
    `ARTICLE B:`,
    `Title: ${opts.b.title}`,
    `Dek: ${opts.b.dek}`,
    `Body: ${opts.b.body.slice(0, 800)}`,
    ``,
    `Same news = same incident, same person being charged with the same thing, same vote, same opening/closing, same upcoming event. Different news = same beat, different specific event (two Marlins games against Orioles, two unrelated arrests in Homestead, two restaurant openings in Wynwood).`,
    ``,
    `Call \`verify_merge\` with your decision.`,
  ].join("\n")
  const response = await client.messages.create({
    model: opts.model,
    max_tokens: 400,
    tools: [verifyMergeTool],
    tool_choice: { type: "tool", name: "verify_merge" },
    messages: [{ role: "user", content: prompt }],
  })
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  )
  if (!toolUse) return null
  const input = toolUse.input as { sameStory?: unknown; reason?: unknown }
  if (typeof input.sameStory !== "boolean") return null
  return {
    sameStory: input.sameStory,
    reason: typeof input.reason === "string" ? input.reason : "",
  }
}

// =====================================================================
// Retroactive metric extraction. Daily pass over recently-published
// articles — asks Opus to find verifiably-stated numbers that should
// be promoted to first-class metrics, even if the mega-desk missed
// them at draft time. Idempotent by slug; same article producing the
// same number on a re-run upserts in place.
//
// Cost: one Opus call per pass with up to ~30 article bodies in
// context. ~$0.10-0.20 daily.
// =====================================================================

export type ExtractMetricsArticle = {
  /** Article slug — used to look up the citation set on the server. */
  slug: string
  title: string
  dek: string
  body: string
  /** First citation publisher to enrich the LLM's grounding. */
  primaryPublisher?: string
}

export type ExtractedMetric = {
  slug: string
  title: string
  subtitle?: string
  kind: "number" | "number-with-delta" | "line" | "bars" | "rank" | "compare"
  data: unknown
  unit?: string
  relatedTags: Array<string>
  relatedSectionSlugs: Array<string>
  /** Article slug the number came from, so the caller can resolve
   *  citations from that article's record server-side. */
  fromArticleSlug: string
}

const extractMetricsTool: Anthropic.Tool = {
  name: "submit_metrics",
  description:
    "Promote numbers stated in the provided articles to first-class miami.community metrics.",
  input_schema: {
    type: "object",
    properties: {
      metrics: {
        type: "array",
        items: {
          type: "object",
          properties: {
            slug: { type: "string" },
            title: { type: "string" },
            subtitle: { type: ["string", "null"] },
            kind: {
              type: "string",
              enum: [
                "number",
                "number-with-delta",
                "line",
                "bars",
                "rank",
                "compare",
              ],
            },
            data: { type: "object" },
            unit: { type: ["string", "null"] },
            relatedTags: { type: "array", items: { type: "string" } },
            relatedSectionSlugs: {
              type: "array",
              items: { type: "string" },
            },
            fromArticleSlug: {
              type: "string",
              description:
                "The slug of the article in this batch where the number appears. The server uses this to attach the right citations.",
            },
          },
          required: [
            "slug",
            "title",
            "kind",
            "data",
            "relatedTags",
            "relatedSectionSlugs",
            "fromArticleSlug",
          ],
        },
      },
    },
    required: ["metrics"],
  },
}

export async function extractMetricsFromArticles(opts: {
  model: string
  articles: ReadonlyArray<ExtractMetricsArticle>
}): Promise<Array<ExtractedMetric>> {
  if (opts.articles.length === 0) return []
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set in Convex env")
  const client = new Anthropic({ apiKey })

  const articlesText = opts.articles
    .map((a) => {
      const pub = a.primaryPublisher ? ` — ${a.primaryPublisher}` : ""
      return `### [slug: ${a.slug}]${pub}\n${a.title}\n${a.dek}\n${a.body}`
    })
    .join("\n\n---\n\n")

  const prompt = [
    `Pass over recently-published miami.community articles and find numerical facts that deserve to be promoted to first-class Miami metrics. Each metric carries the source article's citations and renders as a homepage widget plus an inline embed in any article tagged with its relatedTags.`,
    ``,
    `RULES:`,
    `- Only promote numbers EXPLICITLY stated in the article. Don't compute or estimate.`,
    `- Locally relevant: Miami-Dade, Miami metro, South Florida, statewide for big-picture stats. Skip national figures unless the article is contextualizing them for Miami.`,
    `- Stable slug (kebab-case, ≤80 chars) so future runs that find an updated value upsert in place. Examples: 'miami-dade-population', 'miami-median-rent', 'miami-cost-of-living-rank'.`,
    `- Pick the right kind: 'number' for one value, 'number-with-delta' when the article gives a YoY/QoQ change, 'line' for a time series, 'bars' for categorical breakdown, 'rank' for ordinal positions on a list, 'compare' for two-sided splits.`,
    `- Data shape MUST match the kind:`,
    `  - number / number-with-delta: { value: number, delta?: { value: number, period: string } }`,
    `  - line / bars: { points: [{ label: string, value: number }] }`,
    `  - rank: { value: number, outOf: number, list: string }`,
    `  - compare: { left: { label, value }, right: { label, value } }`,
    `- Empty result is the default. Most articles produce 0 metrics. A typical eligible article: a census release, BLS report, NAR/Redfin price update, "Miami ranks #N" mention.`,
    `- 'fromArticleSlug' MUST match one of the article slugs in this batch. Server uses it to attach citations.`,
    ``,
    `ARTICLES:`,
    articlesText,
    ``,
    `Return via the submit_metrics tool. No textual response.`,
  ].join("\n")

  const response = await client.messages.create({
    model: opts.model,
    max_tokens: 4096,
    tools: [extractMetricsTool],
    tool_choice: { type: "tool", name: "submit_metrics" },
    messages: [{ role: "user", content: prompt }],
  })
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  )
  if (!toolUse) return []
  const input = toolUse.input as { metrics?: unknown }
  if (!Array.isArray(input.metrics)) return []
  const validSlugs = new Set(opts.articles.map((a) => a.slug))
  const out: Array<ExtractedMetric> = []
  for (const raw of input.metrics) {
    if (!raw || typeof raw !== "object") continue
    const r = raw as Record<string, unknown>
    if (typeof r.slug !== "string" || !r.slug) continue
    if (typeof r.title !== "string" || !r.title) continue
    if (typeof r.fromArticleSlug !== "string") continue
    if (!validSlugs.has(r.fromArticleSlug)) continue
    if (
      r.kind !== "number" &&
      r.kind !== "number-with-delta" &&
      r.kind !== "line" &&
      r.kind !== "bars" &&
      r.kind !== "rank" &&
      r.kind !== "compare"
    )
      continue
    if (!r.data || typeof r.data !== "object") continue
    const relatedTags = Array.isArray(r.relatedTags)
      ? r.relatedTags.filter((t): t is string => typeof t === "string")
      : []
    const relatedSectionSlugs = Array.isArray(r.relatedSectionSlugs)
      ? r.relatedSectionSlugs.filter((t): t is string => typeof t === "string")
      : []
    out.push({
      slug: r.slug.slice(0, 80),
      title: r.title.slice(0, 80),
      subtitle:
        typeof r.subtitle === "string" ? r.subtitle.slice(0, 100) : undefined,
      kind: r.kind,
      data: r.data,
      unit: typeof r.unit === "string" ? r.unit.slice(0, 32) : undefined,
      relatedTags,
      relatedSectionSlugs,
      fromArticleSlug: r.fromArticleSlug,
    })
  }
  return out
}
