import Anthropic from "@anthropic-ai/sdk"

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
  dek: string
  heroCaption?: string
}

const TRANSLATE_EVENT_TOOL = {
  name: "translate_event",
  description:
    "Translate a published event's title + 1-sentence dek into Spanish, preserving the house voice. NOT a literal translation — re-write in the same snappy local-paper register, in Spanish. Hard caps: title ≤ 60 chars, dek ≤ 200 chars / 1 sentence. Miami Spanish; mixing in natural anglicisms is fine. Proper nouns (venues, place names, person names) stay in their original form.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description:
          "Spanish event title. ≤ 60 chars. Active voice. Lead with what the event IS, not its publisher / sponsor.",
      },
      dek: {
        type: "string",
        description:
          "Spanish dek. EXACTLY one sentence, ≤ 200 chars. Same register as the EN: punchy, factual, concrete.",
      },
      heroCaption: {
        type: "string",
        description:
          "Spanish image caption when an English caption was provided. Omit when no EN caption.",
      },
    },
    required: ["title", "dek"],
  },
} as const

function validateEventTranslation(
  raw: unknown,
): EventTranslationOutput | null {
  if (!raw || typeof raw !== "object") return null
  const t = raw as Record<string, unknown>
  if (typeof t.title !== "string" || !t.title.trim()) return null
  if (typeof t.dek !== "string" || !t.dek.trim()) return null
  return {
    title: t.title.slice(0, 200),
    dek: t.dek.slice(0, 400),
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
    dek: string
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
    `- Dek: EXACTLY 1 sentence, ≤ 200 chars. Concrete facts only.`,
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
    `Dek: ${opts.event.dek}`,
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

// =====================================================================
// Event enrichment — Haiku call that returns structured tags +
// neighborhood slugs + optional section refinement for one event.
// Used by the deterministic ingest pipeline as the only LLM step:
// title / description / venue come from the source verbatim; this
// call only fills in metadata.
// =====================================================================

export type EventEnrichmentOutput = {
  tags: Array<string>
  neighborhoodSlugs: Array<string>
  sectionSlug?: string
}

const ENRICH_EVENT_TOOL = {
  name: "enrich_event",
  description:
    "Tag, place, and (optionally) re-section a Miami event. Outputs metadata only — do NOT rewrite the title or description.",
  input_schema: {
    type: "object",
    properties: {
      tags: {
        type: "array",
        items: { type: "string" },
        description:
          "0-6 short tag slugs (lowercase, hyphenated). Topical: e.g. 'jazz', 'family-friendly', 'free-events', 'art-basel', 'haitian-heritage-month'. Avoid 'miami' / 'miami-dade' (redundant) and venue-name tags (use the venue field instead).",
      },
      neighborhoodSlugs: {
        type: "array",
        items: { type: "string" },
        description:
          "0-2 Miami-Dade neighborhood slugs the event is tied to. ONLY use these slugs (or leave empty if uncertain): wynwood, little-havana, little-haiti, brickell, downtown, midtown, design-district, edgewater, allapattah, overtown, liberty-city, coral-gables, coconut-grove, key-biscayne, south-beach, mid-beach, north-beach, surfside, bal-harbour, sunny-isles-beach, north-miami-beach, north-miami, miami-shores, el-portal, miami-springs, doral, hialeah, opa-locka, miami-gardens, aventura, pinecrest, palmetto-bay, cutler-bay, kendall, homestead, florida-city, fisher-island.",
      },
      sectionSlug: {
        type: "string",
        description:
          "Optional override for the source's declared section when the event clearly belongs elsewhere. Use the section slugs from the input. Omit when unsure.",
      },
    },
    required: ["tags", "neighborhoodSlugs"],
  },
} as const

function validateEventEnrichment(
  raw: unknown,
): EventEnrichmentOutput | null {
  if (!raw || typeof raw !== "object") return null
  const t = raw as Record<string, unknown>
  const tags = Array.isArray(t.tags)
    ? t.tags
        .filter((x): x is string => typeof x === "string")
        .slice(0, 6)
    : []
  const hoods = Array.isArray(t.neighborhoodSlugs)
    ? t.neighborhoodSlugs
        .filter((x): x is string => typeof x === "string")
        .slice(0, 2)
    : []
  const section =
    typeof t.sectionSlug === "string" && t.sectionSlug.trim().length > 0
      ? t.sectionSlug
      : undefined
  return { tags, neighborhoodSlugs: hoods, sectionSlug: section }
}

export async function generateEventEnrichment(opts: {
  model: string
  event: {
    title: string
    description: string
    locationName?: string
    locationAddress?: string
    currentSectionSlug?: string
  }
  sectionChoices: ReadonlyArray<{ slug: string; name: string }>
}): Promise<EventEnrichmentOutput | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set in Convex env")
  const client = new Anthropic({ apiKey })

  const sectionLines = opts.sectionChoices
    .map((s) => `- ${s.slug}: ${s.name}`)
    .join("\n")

  const userPrompt = [
    `Tag and place this Miami event. Output metadata only — never rewrite the title/description.`,
    ``,
    `Event:`,
    `Title: ${opts.event.title}`,
    `Description: ${opts.event.description}`,
    opts.event.locationName ? `Venue: ${opts.event.locationName}` : "",
    opts.event.locationAddress ? `Address: ${opts.event.locationAddress}` : "",
    opts.event.currentSectionSlug
      ? `Currently filed under: ${opts.event.currentSectionSlug}`
      : "",
    ``,
    `Sections (slug : name):`,
    sectionLines,
    ``,
    `Rules:`,
    `- Only suggest a sectionSlug when the current one is clearly wrong (e.g. concert filed under politics).`,
    `- Neighborhood: infer from the address or venue, never guess from the title alone.`,
    `- Tags: topical, not venue-named, no 'miami' / 'miami-dade'.`,
  ]
    .filter(Boolean)
    .join("\n")

  const response = await client.messages.create({
    model: opts.model,
    max_tokens: 512,
    messages: [{ role: "user", content: userPrompt }],
    tools: [ENRICH_EVENT_TOOL],
    tool_choice: { type: "tool", name: "enrich_event" },
  })

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  )
  if (!toolUse) return null
  return validateEventEnrichment(toolUse.input)
}

// =====================================================================
// Page-to-events extractor — used by the llm-extract adapter when a
// venue page describes events in text but exposes no JSON-LD. Haiku
// reads a cleaned-up text dump of the page and emits a JSON array of
// events the scraper found.
// =====================================================================

export type ExtractedPageEvent = {
  title: string
  startsAtIso: string
  endsAtIso?: string
  locationName?: string
  locationAddress?: string
  description?: string
  url?: string
  price?: string
}

const EXTRACT_EVENTS_TOOL = {
  name: "extract_events",
  description:
    "Extract every concrete, future-dated event mentioned on the page. SKIP: recurring 'every day' opening hours, exhibition runs without a kickoff date, generic store-hours notes, classes / courses without a one-time event. INCLUDE: dated performances, openings, screenings, talks, festivals, ticketed shows. Return an empty array when nothing concrete is in the text.",
  input_schema: {
    type: "object",
    properties: {
      events: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Event name as the venue states it. No editorializing.",
            },
            startsAtIso: {
              type: "string",
              description:
                "Concrete ISO-8601 datetime in the venue's local timezone (assume America/New_York when unstated). MUST be a real date, not 'soon' or 'TBA'.",
            },
            endsAtIso: { type: "string" },
            locationName: { type: "string" },
            locationAddress: { type: "string" },
            description: {
              type: "string",
              description:
                "One-sentence summary lifted from the page. Skip when no description is on the page.",
            },
            url: {
              type: "string",
              description:
                "Direct event-detail URL when the page links to one. Skip when the event lives only on this page.",
            },
            price: {
              type: "string",
              description:
                'Human-readable price label ("Free", "$15", "$10-25"). Skip when not stated.',
            },
          },
          required: ["title", "startsAtIso"],
        },
      },
    },
    required: ["events"],
  },
} as const

export async function generatePageEventExtraction(opts: {
  model: string
  pageUrl: string
  /** Cleaned-up text snapshot of the page (HTML stripped + whitespace
   *  collapsed). Caller should cap at ~8KB to keep token use bounded. */
  pageText: string
  /** Inferred "today" — supplied so Haiku can disambiguate "this
   *  Saturday" / "next Friday" without time-zone trickery. */
  todayIso: string
}): Promise<ReadonlyArray<ExtractedPageEvent> | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set in Convex env")
  const client = new Anthropic({ apiKey })

  const prompt = [
    `You are extracting events from a Miami venue's web page. Output ONLY events the page concretely describes with a real, future date. Skip vague mentions ("coming soon", "see calendar for dates").`,
    ``,
    `Today's date (Miami time): ${opts.todayIso}`,
    `Source URL: ${opts.pageUrl}`,
    ``,
    `=== Page text (HTML stripped) ===`,
    opts.pageText.slice(0, 8000),
    ``,
    `Call \`extract_events\` with your list. If nothing concrete is in the text, pass an empty array — don't invent events.`,
  ].join("\n")

  const response = await client.messages.create({
    model: opts.model,
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
    tools: [EXTRACT_EVENTS_TOOL],
    tool_choice: { type: "tool", name: "extract_events" },
  })

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  )
  if (!toolUse) return null
  const input = toolUse.input as { events?: unknown }
  if (!Array.isArray(input.events)) return []
  const out: Array<ExtractedPageEvent> = []
  for (const e of input.events) {
    if (!e || typeof e !== "object") continue
    const obj = e as Record<string, unknown>
    if (typeof obj.title !== "string" || !obj.title.trim()) continue
    if (typeof obj.startsAtIso !== "string") continue
    const startMs = Date.parse(obj.startsAtIso)
    if (!Number.isFinite(startMs)) continue
    out.push({
      title: obj.title.trim(),
      startsAtIso: obj.startsAtIso,
      endsAtIso:
        typeof obj.endsAtIso === "string" ? obj.endsAtIso : undefined,
      locationName:
        typeof obj.locationName === "string" ? obj.locationName : undefined,
      locationAddress:
        typeof obj.locationAddress === "string"
          ? obj.locationAddress
          : undefined,
      description:
        typeof obj.description === "string" ? obj.description : undefined,
      url: typeof obj.url === "string" ? obj.url : undefined,
      price: typeof obj.price === "string" ? obj.price : undefined,
    })
  }
  return out
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

