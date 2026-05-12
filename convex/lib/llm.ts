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
//
// Tags + neighborhoods are passed alongside the headline so the LLM can
// recognize topical continuity ("housing in Wynwood", "Inter Miami transfer
// window") even when the new draft's headline is phrased differently from
// the candidate's. Without these signals, related-IDs degenerate into
// title-word matching and we under-link follow-ups / over-link headline
// twins. They also give the model the signal it needs to detect when an
// incoming item has NO tie to existing coverage and should be skipped.
export type RelatedCandidate = {
  index: number
  section: string
  title: string
  dek: string
  publishedAt?: string
  tags: ReadonlyArray<string>
  neighborhoods: ReadonlyArray<string>
}

export type SectionChoice = {
  slug: string
  name: string
  description: string
}

// Every output of the mega-desk is an LlmEvent. Two flavors live in
// the same shape, distinguished by `kind`:
//   - "scheduled" — a thing happening in the future (concert, opening,
//     vote, exhibition). `description` is a 1-2 sentence calendar
//     blurb; `dek` / `body` are usually empty.
//   - "reported" — a news event that already happened. `startsAt`
//     captures when it happened. `dek` + `body` carry article-style
//     editorial copy. The newspaper UI leads with these.
// Both render through the same templates; the layout chooses
// treatment based on which fields are populated and whether startsAt
// is past/future.
//
// Section parity: every event belongs to a section. The desk's LLM
// picks the most specific section from its allowed tree.
export type LlmEvent = {
  title: string
  /** One-line standfirst (≤120 chars). REQUIRED for kind="reported". */
  dek?: string
  /** Editorial paragraph (30-60 words). REQUIRED for kind="reported". */
  body?: string
  /** Calendar-style description (≤300 chars). Always present. */
  description: string
  kind: "scheduled" | "reported"
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
  /** Indices into `relatedCandidates` for sibling events. */
  relatedEventIndices: Array<number>
  /** When this is the SAME event as one in the related-candidates list
   *  (same incident, same scheduled occurrence, same news moment). The
   *  server merges citations into that event instead of inserting a
   *  duplicate. Mirrors the old `updateOfRelatedIndex` on articles. */
  updateOfRelatedIndex?: number
  /** Optional video reference — when the cited sources are YouTube /
   *  Vimeo clips, the renderer leads with the player instead of the
   *  hero image. Provider + ID are extracted by the YouTube adapter
   *  upstream; the LLM only needs to forward them on. */
  videoProvider?: "youtube" | "vimeo"
  videoId?: string
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
  events: Array<LlmEvent>
  metrics: Array<LlmMetric>
  /** Number of raw event objects the LLM emitted before validation.
   *  When > events.length, rows were dropped for missing/invalid
   *  required fields — useful for distinguishing "model produced
   *  nothing" from "model produced unusable output." */
  rawEventCount: number
  stopReason: string | null
  rawInputSnippet: string
}

function buildEventsTool(sectionSlugs: Array<string>) {
  const eventProperties: Record<string, unknown> = {
    kind: {
      type: "string",
      enum: ["scheduled", "reported"],
      description:
        "`scheduled` for things happening in the future (concert, opening, vote, exhibition, market, game). `reported` for news that already happened (a vote was passed, a trade was announced, an arrest was made, a record was broken). For `reported`, set `startsAtIso` to when the news event itself occurred — NOT some unrelated future date.",
    },
    title: {
      type: "string",
      description:
        "Snappy local-newspaper headline / event title. TARGET 6–10 words, HARD CAP 80 characters. Active voice. Lead with the news / what's happening, not the institution. For events from iCal sources, keep the venue's own title unless it's pure boilerplate. No hedging words ('amid', 'as', 'after'), no headlinese clichés, no questions, no clickbait.",
    },
    dek: {
      type: "string",
      description:
        "REQUIRED when kind=reported, OPTIONAL when kind=scheduled. One-sentence standfirst that adds new info beyond the headline. TARGET 60-80 characters, HARD CAP 120. Concrete, not vague. No 'in a sign that…' / 'amid growing concerns…' / 'experts say'. Drop the dek entirely if it would just rephrase the headline.",
    },
    body: {
      type: "string",
      description:
        "REQUIRED when kind=reported, USUALLY EMPTY when kind=scheduled. Newspaper paragraph: ONE paragraph, MAX 3 SENTENCES, 30-60 words. The shortest version that gives the reader who/what/where/when and why it matters in Miami. Active voice, short sentences, no line breaks, no Markdown, no bullet points. Distill, don't paraphrase. For pure calendar items (yoga at the park), leave empty — the description alone is enough.",
    },
    description: {
      type: "string",
      description:
        "Calendar-style 1–2 sentence blurb (≤300 chars). Always present. For scheduled events: 'What is this event?' For reported events: a brief recap that works as a card preview when the body is hidden. Plain prose, no marketing fluff.",
    },
    suggestedSlug: {
      type: "string",
      description:
        "kebab-case slug for the event detail URL (≤80 chars). Should not include the date — the system disambiguates with a timestamp suffix when needed.",
    },
    startsAtIso: {
      type: "string",
      description:
        "ISO 8601 with Miami offset (e.g. 2026-05-15T19:00:00-04:00). For kind=scheduled: when the event happens. For kind=reported: when the news event occurred (announcement time, incident time, vote time). REQUIRED.",
    },
    endsAtIso: { type: "string", description: "Optional end time in ISO 8601." },
    allDay: {
      type: "boolean",
      description:
        "True for all-day events (holidays, multi-day festivals, museum exhibitions). For reported news without a known time, also true.",
    },
    locationName: {
      type: "string",
      description:
        "Venue or place name. For reported events, the place where the news happened (e.g. 'Miami-Dade County Commission', 'Hard Rock Stadium').",
    },
    url: { type: "string", description: "Canonical event URL when mentioned." },
    price: { type: "string", description: "e.g. 'Free' or '$15-30'." },
    tags: {
      type: "array",
      items: { type: "string" },
      description:
        "2-5 lowercase tags. Tags are reusable taxonomy hooks — only pick tags that OTHER events will plausibly share. Good: ongoing series ('formula-1', 'art-basel', 'calle-ocho'), beats ('housing', 'transit', 'live-music'), institutions ('miami-dade-county', 'inter-miami', 'um'), named people, neighborhood slugs ('wynwood', 'little-havana'). BAD (do NOT use): single-event names ('fan-fest', 'opening-gala'), marketing slugs, ad-hoc descriptors. NEVER 'miami' / 'miami-dade' / 'florida' — every event is local by definition. When in doubt, drop the tag.",
    },
    neighborhoodSlugs: {
      type: "array",
      items: { type: "string", enum: NEIGHBORHOODS.map((n) => n.slug) },
      description:
        "Miami neighborhood slugs this event is tied to. 0–3 entries. Use ONLY slugs from the allowed list. Leave empty for citywide / county-wide events.",
    },
    citationItemIndices: {
      type: "array",
      items: { type: "integer" },
      description: "Indices into the source items[]. Must include ≥1.",
    },
    relatedEventIndices: {
      type: "array",
      items: { type: "integer" },
      description:
        "Indices into the related candidate events[] (when provided). Use when this event is a follow-up, sibling, or background to an existing event. 0–3 entries. Empty is fine — only link when the connection is real.",
    },
    updateOfRelatedIndex: {
      type: "integer",
      description:
        "Use this ONLY when the sources cover the SAME event as one in the related candidates — same news incident, same scheduled occurrence — not a follow-up or sibling. The server merges citations into the existing event instead of inserting a duplicate. Leave unset for distinct events; use relatedEventIndices for follow-ups.",
    },
    videoProvider: {
      type: "string",
      enum: ["youtube", "vimeo"],
      description:
        "Set when the cited sources include a primary video clip and you want the renderer to lead with the player. Pair with `videoId`. Leave unset when there's no video.",
    },
    videoId: {
      type: "string",
      description:
        "Provider-side video ID (e.g. YouTube's 11-char `v=` value). Required when `videoProvider` is set.",
    },
  }
  const eventRequired = [
    "kind",
    "title",
    "description",
    "suggestedSlug",
    "startsAtIso",
    "allDay",
    "tags",
    "neighborhoodSlugs",
    "citationItemIndices",
    "relatedEventIndices",
  ]
  // Only inject sectionSlug when the desk has multiple options to choose
  // from — keeps single-section desks unchanged and avoids a useless
  // 1-element enum.
  if (sectionSlugs.length > 1) {
    eventProperties.sectionSlug = {
      type: "string",
      enum: sectionSlugs,
      description:
        "Section to file this event under. Pick the MOST SPECIFIC match from the allowed sections. Music event → music. Restaurant opening → food. School-board vote → education. Use the desk's primary section only when no sub-section fits.",
    }
    eventRequired.push("sectionSlug")
  }

  return {
    name: "publish_events",
    description:
      "Publish one or more events to miami.community. EVERY ingest item that passes the Miami test produces an event — calendar items (kind=scheduled) and news events (kind=reported) both flow through this single output. Events go live immediately; there is no editor review queue. Each event must cite at least one source item by index.",
    input_schema: {
      type: "object",
      properties: {
        events: {
          type: "array",
          description:
            "Events to publish. This array should rarely be empty — when you have N items in the input, expect ~N events back, minus duplicates of already-published events and items not Miami-Dade-relevant. Calendar feeds (iCal, venue listings) produce kind=scheduled events; news wires produce kind=reported events with full dek+body editorial treatment.",
          items: {
            type: "object",
            properties: eventProperties,
            required: eventRequired,
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
  /** Max events per response. The previous `maxDrafts` name is kept by
   *  the caller for now; this is the same number. */
  maxDrafts: number
  relatedCandidates?: Array<RelatedCandidate>
  /** Sections the desk can file events under (primary + children). */
  sectionChoices?: Array<SectionChoice>
  /** Current metric catalog. The LLM may drop `[[metric:slug]]` tokens
   *  into the body of any event whose tags match the metric's
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
            const tags = c.tags.length > 0 ? `\n  tags: ${c.tags.join(", ")}` : ""
            const hoods =
              c.neighborhoods.length > 0
                ? `\n  neighborhoods: ${c.neighborhoods.join(", ")}`
                : ""
            return `[${c.index}] ${c.section} — ${c.title}${date}\n  ${c.dek}${tags}${hoods}`
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
    `You may produce up to ${opts.maxDrafts} events.`,
    `Return your events ONLY by calling the \`publish_events\` tool. Do not return event copy in your textual response.`,
    `Events publish IMMEDIATELY when you submit them — there is no editor review queue.`,
    `Each event MUST cite at least one source item by its bracket index above.`,
    ``,
    `EVERY OUTPUT IS AN EVENT. miami.community has deprecated stand-alone articles. Every ingest item becomes either:`,
    `  - kind="scheduled" — a future happening (concert, opening, vote, exhibition, market, game, meeting). \`startsAtIso\` is when it happens. \`description\` is calendar-style; \`dek\` and \`body\` are usually empty.`,
    `  - kind="reported" — a news event that already occurred (a vote was passed, a trade was announced, a building permit filed, an arrest made, a record broken). \`startsAtIso\` is when the news event happened. \`dek\` (≤120 chars) and \`body\` (30-60 words, ONE paragraph) carry full newspaper-style editorial copy. \`description\` is a short calendar-style preview for cards.`,
    ``,
    `EDITORIAL VOICE — read this twice.`,
    `miami.community is the AI-edited local paper that reads like a smart friend telling you what happened in plain English. Source publications write at length for general audiences; we don't. Our job is to take their reporting and make it SHORTER, SNAPPIER, CLEARER for a busy Miami reader. If your event's body reads like the source headline / lede with light edits, rewrite it.`,
    ``,
    `Hard rules:`,
    `- Headline: 6–10 words, ≤ 80 chars. Active voice. Lead with the news / what's happening. Never copy or near-copy the source publication's headline.`,
    `- Dek (kind=reported, REQUIRED): TARGET 60-80 chars, HARD CAP 120. ADDS information the headline doesn't carry. Drop it entirely if you'd just be rewording the headline. For kind=scheduled, dek is optional — only set when there's a real hook beyond the title.`,
    `- Body (kind=reported, REQUIRED): ONE paragraph, MAX 3 SENTENCES, 30-60 words. Shortest version that answers who/what/where/when + why it matters in Miami. For kind=scheduled, body is USUALLY EMPTY — the description alone is enough for calendar items.`,
    `- Description (ALWAYS REQUIRED): 1-2 sentences, ≤300 chars. Calendar-style. For reported events, a brief recap that works as a card preview.`,
    `- State only facts present in the cited items. Do not fabricate quotes, names, dates, or numbers. If something's missing, omit it.`,
    `- Never reproduce source text verbatim — re-express in our voice.`,
    `- No headlinese / hedging clichés ("amid", "as", "after", "in a sign that", "experts say", "comes as", "raises concerns"). Cut them.`,
    `- No clickbait. No questions in headlines. No "you'll never believe", "here's what", etc.`,
    `- The ONLY reasons to omit an item from your events array: (i) it's a duplicate of an existing event on the site (use updateOfRelatedIndex), or (ii) it's clearly not Miami-Dade-relevant. "Maybe not interesting enough" is NOT a reason to skip — emit it.`,
    `- iCal-sourced calendar items (titles like "Yoga at the park", "City Commission meeting", "Storytime at the library", "Friday Night Concert", "Member Reception", "Guided museum tour") are PURE scheduled events — emit one event row per item with kind=scheduled, body empty.`,
    `- News-sourced items (a county vote, a trade, a permit, a Heat win, a restaurant opening) become kind=reported with FULL editorial dek+body and startsAtIso = when the news event occurred.`,
    relatedText
      ? `- For each event, look at the "Recently published events" list below. If your event is a follow-up, sibling, or background to one of those, include its bracket index in \`relatedEventIndices\`. 0–3 entries. Empty is fine — only link when the connection is real.`
      : `- Leave \`relatedEventIndices\` empty (no recent events available).`,
    relatedText
      ? `- DEDUPE — BE AGGRESSIVE. If your incoming sources cover the SAME news event / SAME scheduled occurrence / SAME incident / SAME person-and-charge as one of the candidate events, set \`updateOfRelatedIndex\` to that candidate's bracket index instead of emitting a duplicate. Two stories about the same county vote = same event. Two listings of the same concert = same event. The system merges citations into the existing event. Only use \`relatedEventIndices\` (not updateOfRelatedIndex) for clearly distinct events or genuine follow-ups (a day-after analysis, a profile of someone tangentially involved, a sidebar).`
      : "",
    sectionsText
      ? `- For each event, set \`sectionSlug\` to the most specific section from the allowed list below.`
      : "",
    (opts.metricCatalog ?? []).length > 0
      ? `- INLINE METRIC EMBEDS: when a reported event's tags overlap with a metric's relatedTags below, drop a \`[[metric:slug]]\` token into the BODY on its own line where the number would naturally appear. The renderer expands the token into a compact widget. Use sparingly — at most one embed per event, only when the metric directly supports the claim. Example: an event about cost of living that overlaps with 'miami-cost-of-living-rank' → drop \`[[metric:miami-cost-of-living-rank]]\` near the relevant sentence.`
      : "",
    ``,
    `Source items:`,
    itemsText,
    ...(sectionsText
      ? ["", `Allowed sections (use the slug for sectionSlug):`, sectionsText]
      : []),
    ...(relatedText
      ? ["", `Recently published events (for relatedEventIndices / updateOfRelatedIndex):`, relatedText]
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
    // 16k output cap. 20 events × (title + dek + body ≈ 600 tokens
    // each) + metrics + tool-call overhead easily exceeds 4k.
    max_tokens: 16384,
    system: [
      {
        type: "text",
        text: opts.systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [buildEventsTool(sectionSlugs)],
    tool_choice: { type: "tool", name: "publish_events" },
    messages: [{ role: "user", content: userPrompt }],
  })

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  )
  if (!toolUse) throw new Error("LLM did not return a tool_use block")
  const input = toolUse.input as {
    events?: unknown
    metrics?: unknown
  }
  const rawEvents = Array.isArray(input.events) ? input.events : []
  const events = rawEvents
    .map(validateEvent)
    .filter((e): e is LlmEvent => e !== null)
  const droppedEvents = rawEvents.length - events.length
  if (droppedEvents > 0) {
    const firstInvalid = rawEvents.find((r) => validateEvent(r) === null)
    console.warn(
      `[generateDrafts] dropped ${droppedEvents}/${rawEvents.length} events during validation. First invalid raw object:`,
      JSON.stringify(firstInvalid)?.slice(0, 600),
    )
  }
  const metrics = Array.isArray(input.metrics)
    ? input.metrics
        .map(validateMetric)
        .filter((m): m is LlmMetric => m !== null)
    : []
  return {
    events,
    metrics,
    rawEventCount: rawEvents.length,
    /** Anthropic's stop_reason — useful diagnostic when events is
     *  empty (max_tokens vs end_turn vs stop_sequence vs refusal). */
    stopReason: response.stop_reason ?? null,
    /** First 600 chars of the raw tool input — surfaces what the LLM
     *  actually submitted when the validated count is 0. */
    rawInputSnippet: JSON.stringify(input).slice(0, 600),
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
  // Default to "scheduled" when the LLM forgets the field — a
  // calendar item without editorial copy is the safer fallback. The
  // server's section + hero pipeline doesn't care which kind it is.
  const kind: "scheduled" | "reported" =
    e.kind === "reported" ? "reported" : "scheduled"
  // For reported events: dek + body are required. For scheduled: both
  // optional. We don't hard-fail a missing dek/body on reported — the
  // renderer falls back to description — but we log so the prompt can
  // tighten over time.
  const dek =
    typeof e.dek === "string" && e.dek.trim().length > 0
      ? e.dek.slice(0, 400)
      : undefined
  const body =
    typeof e.body === "string" && e.body.trim().length > 0
      ? e.body
      : undefined
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
  // Accept either the new field name (relatedEventIndices) OR the
  // legacy one (relatedArticleIndices) — the mid-rename safety net so
  // a stale prompt-cache miss doesn't drop every event's related links.
  const relatedRaw = Array.isArray(e.relatedEventIndices)
    ? e.relatedEventIndices
    : Array.isArray(e.relatedArticleIndices)
      ? e.relatedArticleIndices
      : []
  const relatedEventIndices = (relatedRaw as Array<unknown>)
    .filter((i) => Number.isInteger(i))
    .slice(0, 3) as Array<number>
  const updateOfRelatedIndex = Number.isInteger(e.updateOfRelatedIndex)
    ? (e.updateOfRelatedIndex as number)
    : undefined
  const sectionSlug =
    typeof e.sectionSlug === "string" ? e.sectionSlug : undefined
  const videoProvider =
    e.videoProvider === "youtube" || e.videoProvider === "vimeo"
      ? (e.videoProvider as "youtube" | "vimeo")
      : undefined
  const videoId =
    typeof e.videoId === "string" && e.videoId.trim().length > 0
      ? e.videoId
      : undefined
  return {
    title: e.title.slice(0, 200),
    dek,
    body,
    description: e.description.slice(0, 600),
    kind,
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
    relatedEventIndices,
    updateOfRelatedIndex,
    videoProvider: videoProvider && videoId ? videoProvider : undefined,
    videoId: videoProvider && videoId ? videoId : undefined,
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
// Bulk backlog generator — produces N entries for ONE widget kind in
// a single LLM call. Used by the seedBacklog action to pre-populate
// the right-rail history so chevron navigation has somewhere to walk
// before the daily cron has accumulated a backlog organically.
// =====================================================================

type WidgetKind = WidgetEntry["kind"]

const widgetBacklogTool: Anthropic.Tool = {
  name: "submit_widget_backlog",
  description:
    "Submit N unique widget entries for a single kind. Each entry should be distinct from every other in the batch AND from the existing entries listed in the prompt.",
  input_schema: {
    type: "object",
    properties: {
      entries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            body: { type: "string" },
            attribution: { type: ["string", "null"] },
            imageHint: { type: ["string", "null"] },
          },
          required: ["title", "body"],
        },
      },
    },
    required: ["entries"],
  },
}

const KIND_SPEC: Record<WidgetKind, string> = {
  "fun-fact":
    "Surprising, verifiably-true facts about Miami-Dade. Body ≤25 words. Title can be left as 'Did you know' (the widget already labels itself).",
  "on-this-day":
    "Real historical events that happened in Miami-Dade. Title: 'YYYY · Short headline'. Body: 1-2 sentences. Skip days you can't verify.",
  landmark:
    "Miami-Dade landmarks with brief history notes. Title: landmark name. Body: 2-3 sentences. imageHint: Wikimedia search query.",
  "animal-fact":
    "Local Miami-area wildlife. Title: animal common name. Body: 2 sentences on Miami-specific behavior, habitat, or seasonal relevance. imageHint: Wikimedia search query.",
  quote:
    "Real quotes from historical or contemporary Miamians (writers, activists, athletes, politicians, musicians). Title: speaker's name. Body: the exact quote. attribution: speaker's name.",
}

export async function generateWidgetBacklog(opts: {
  model: string
  kind: WidgetKind
  count: number
  /** Already-known titles to avoid re-emitting. Lowercased on the
   *  client; we pass them verbatim and the LLM is told not to repeat. */
  existingTitles: ReadonlyArray<string>
}): Promise<Array<WidgetEntry>> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set in Convex env")
  const client = new Anthropic({ apiKey })

  const existingBlock =
    opts.existingTitles.length > 0
      ? [
          ``,
          `Already in the database — DO NOT repeat any of these titles or substantially overlap their content:`,
          ...opts.existingTitles.slice(0, 60).map((t) => `- ${t}`),
        ].join("\n")
      : ""

  const prompt = [
    `Generate ${opts.count} UNIQUE entries of kind "${opts.kind}" for miami.community's right-rail backlog.`,
    ``,
    `Spec: ${KIND_SPEC[opts.kind]}`,
    ``,
    `Hard rules:`,
    `- All ${opts.count} entries must be distinct from each other and from the existing list (when provided).`,
    `- Never fabricate quotes, dates, or events. If you can't reach ${opts.count} verifiable entries, return fewer.`,
    `- Scope: Miami-Dade County and immediately adjacent (Broward, Monroe, the Keys, the Everglades).`,
    `- Return strictly via the submit_widget_backlog tool.`,
    existingBlock,
  ]
    .filter(Boolean)
    .join("\n")

  const response = await client.messages.create({
    model: opts.model,
    // ~30 entries × ~80 tokens each + tool overhead ≈ 3-4k. 8k gives
    // headroom on the high-token kinds (landmarks, on-this-day).
    max_tokens: 8192,
    tools: [widgetBacklogTool],
    tool_choice: { type: "tool", name: "submit_widget_backlog" },
    messages: [{ role: "user", content: prompt }],
  })

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  )
  if (!toolUse) return []
  const input = toolUse.input as { entries?: Array<unknown> }
  const out: Array<WidgetEntry> = []
  for (const raw of input.entries ?? []) {
    if (!raw || typeof raw !== "object") continue
    const r = raw as Record<string, unknown>
    const title = typeof r.title === "string" ? r.title.trim() : ""
    const body = typeof r.body === "string" ? r.body.trim() : ""
    if (!title || !body) continue
    out.push({
      kind: opts.kind,
      title,
      body,
      attribution: typeof r.attribution === "string" ? r.attribution : null,
      imageHint: typeof r.imageHint === "string" ? r.imageHint : null,
    })
  }
  return out
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
// Event rubric grader — cheap Haiku call that gates each LLM-emitted
// event before insert. The mega-desk's system prompt has accreted
// dozens of "don't publish X" rules over time (Palm Beach isn't
// adjacent, no police blotter without a hook, etc.), and Sonnet keeps
// finding ways to justify past them. A separate grader with a clean
// context window and a tight rubric catches the rationalizations.
//
// Modeled on the "Outcomes" pattern from Anthropic's Managed Agents:
// the writer optimizes for editorial flow; the grader checks whether
// the result meets policy. They don't share a chain of thought.
//
// Rubric is intentionally narrow — five criteria, all true to pass.
// Borderline items default to pass so coverage doesn't collapse on
// edge cases; the grader's job is to catch obvious failures, not
// arbitrate close calls.
//
// Cost: ~$0.0005/event with Haiku 4.5. ~20 events × $0.01 per run × 24
// ticks/day = ~$0.25/day, well within the daily budget.
// =====================================================================

const eventRubricTool: Anthropic.Tool = {
  name: "grade_event",
  description:
    "Grade a candidate event against miami.community's editorial rubric. PASS only when every criterion below is met; FAIL when any is violated.",
  input_schema: {
    type: "object",
    properties: {
      passes: {
        type: "boolean",
        description:
          "True ONLY when every rubric criterion is satisfied. Default to true on genuinely borderline cases (the writer already saw the source; we trust their judgment unless it clearly broke policy).",
      },
      reason: {
        type: "string",
        description:
          "One short sentence. For fails: cite the specific criterion that broke (e.g. 'Palm Beach is not Miami-Dade-adjacent', 'Police-blotter incident with no named subject or policy angle', 'Reported kind missing body'). For passes: optional one-line note or empty.",
      },
    },
    required: ["passes", "reason"],
  },
}

export async function verifyEventRubric(opts: {
  model: string
  event: {
    title: string
    dek?: string
    body?: string
    description: string
    kind: "scheduled" | "reported"
    locationName?: string
    neighborhoodSlugs: ReadonlyArray<string>
    tags: ReadonlyArray<string>
    /** Optional — when present, helps the grader judge "Miami test" on
     *  ambiguous items. Pulled from the LLM's chosen sectionSlug at the
     *  agent layer; an undefined value means the writer didn't pick. */
    sectionSlug?: string
  }
}): Promise<{ passes: boolean; reason: string } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set in Convex env")
  const client = new Anthropic({ apiKey })

  const e = opts.event
  const prompt = [
    `You are a strict editorial reviewer for miami.community — a hyperlocal newspaper for Miami-Dade County. A writer just produced this event candidate. Decide whether it meets the publishing bar.`,
    ``,
    `RUBRIC — all must be true to pass:`,
    ``,
    `1. MIAMI TEST: The event is materially about Miami-Dade County or its named immediately-adjacent areas (Broward, Monroe, the Keys, the Everglades) WITH a clear Miami-Dade tie. PALM BEACH IS NOT ADJACENT — treat it like Orlando. Any out-of-state or out-of-Florida-region story (Denver, Nebraska, national wire) → FAIL. National political horserace with no Miami-Dade impact → FAIL.`,
    ``,
    `2. LOCAL HOOK: The copy names at least one specific Miami-Dade place, person, business, agency, institution, neighborhood, or carries a Miami neighborhood slug. "A man was arrested" with no neighborhood / no agency named / no public-interest angle → FAIL. Pure wire copy that could be published anywhere → FAIL.`,
    ``,
    `3. POLICE-BLOTTER GATE (kind=reported only): if the headline mentions arrest / shooting / stabbing / fatal / crash / robbery / homicide, the body MUST add at least one of: named subject, named officer/agency, named victim, charge filed, public-interest angle (corruption, pattern of force, prominent person, policy implication). A one-off "incident happened" with no names and no follow-up hook → FAIL.`,
    ``,
    `4. EDITORIAL COMPLETENESS:`,
    `   - If kind="reported": both dek and body must be present and substantive. Empty/missing body → FAIL. Body shorter than ~25 words → FAIL. Headlinese clichés in title ("amid", "as", "after", "in a sign that", "raises concerns") → FAIL.`,
    `   - If kind="scheduled": description must be present (≥10 chars). dek/body optional. Headlinese in title still → FAIL.`,
    ``,
    `5. NOT HEADLINESE / CLICKBAIT: No questions in headlines, no "you'll never believe", no "here's what". Active voice. If the title is a question or has clickbait markers → FAIL.`,
    ``,
    `=== Candidate event (kind=${e.kind}) ===`,
    `Title: ${e.title}`,
    e.dek ? `Dek: ${e.dek}` : `Dek: (none)`,
    e.body ? `Body: ${e.body.slice(0, 800)}` : `Body: (none)`,
    `Description: ${e.description.slice(0, 400)}`,
    e.locationName ? `Location: ${e.locationName}` : "",
    `Section: ${e.sectionSlug ?? "(unset)"}`,
    `Tags: ${e.tags.length > 0 ? e.tags.join(", ") : "(none)"}`,
    `Neighborhoods: ${e.neighborhoodSlugs.length > 0 ? e.neighborhoodSlugs.join(", ") : "(none)"}`,
    ``,
    `Bias: borderline cases PASS. The writer saw the source items and made the call; only fail when a rubric criterion is clearly broken. Never fail purely on "I would have phrased it differently."`,
    ``,
    `Call \`grade_event\` with your decision.`,
  ]
    .filter(Boolean)
    .join("\n")

  const response = await client.messages.create({
    model: opts.model,
    max_tokens: 400,
    tools: [eventRubricTool],
    tool_choice: { type: "tool", name: "grade_event" },
    messages: [{ role: "user", content: prompt }],
  })
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  )
  if (!toolUse) return null
  const input = toolUse.input as { passes?: unknown; reason?: unknown }
  if (typeof input.passes !== "boolean") return null
  return {
    passes: input.passes,
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
