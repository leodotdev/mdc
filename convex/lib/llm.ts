import Anthropic from "@anthropic-ai/sdk"

import { EVENT_KINDS } from "./eventKinds"
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
// articles, others stand on their own (a public notice, a holiday).
export type LlmEvent = {
  title: string
  description: string
  kind: "general" | "meeting" | "notice" | "holiday" | "deal"
  startsAtIso: string
  endsAtIso?: string
  allDay: boolean
  locationName?: string
  neighborhood?: string
  url?: string
  price?: string
  citationItemIndices: Array<number>
  /** Optional index into `drafts[]` of this same response for cross-link. */
  relatedDraftIndex?: number
}

export type DraftBatch = { drafts: Array<LlmDraft>; events: Array<LlmEvent> }

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
        "2-5 lowercase tags. Do NOT use generic location tags like 'miami', 'miami-dade', or 'florida' — every story is already local by definition. Prefer specific topics, neighborhoods (e.g. 'wynwood', 'little-havana'), people, institutions, or beats.",
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
    name: "submit_drafts",
    description:
      "Submit one or more short article drafts to the editor's review queue. Each draft must cite at least one source item by index.",
    input_schema: {
      type: "object",
      properties: {
        drafts: {
          type: "array",
          items: {
            type: "object",
            properties: draftProperties,
            required: draftRequired,
          },
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
              description: "1–2 sentence description (≤300 chars)",
            },
            kind: {
              type: "string",
              enum: EVENT_KINDS.map((k) => k.slug),
              description:
                "Event category: 'general' for things-to-do (concerts/openings/festivals); 'meeting' for community meetings + public hearings; 'notice' for public notices and comment periods; 'holiday' for civic/cultural/religious holidays; 'deal' for offers, discounts, free-admission days.",
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
            neighborhood: { type: "string", description: "Miami neighborhood, if known." },
            url: { type: "string", description: "Canonical event URL if mentioned." },
            price: { type: "string", description: "e.g. 'Free' or '$15-30'." },
            citationItemIndices: {
              type: "array",
              items: { type: "integer" },
              description:
                "Source item indices that mention this event. Must include ≥1.",
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
            "kind",
            "startsAtIso",
            "allDay",
            "citationItemIndices",
          ],
        },
      },
    },
      required: ["drafts", "events"],
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

export async function generateDrafts(opts: {
  systemPrompt: string
  model: string
  items: Array<DraftItem>
  maxDrafts: number
  relatedCandidates?: Array<RelatedCandidate>
  /** Sections the desk can file stories under (primary + children). */
  sectionChoices?: Array<SectionChoice>
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
    `Return drafts ONLY by calling the \`submit_drafts\` tool. Do not return drafts in your textual response.`,
    `Each draft MUST cite at least one source item by its bracket index above.`,
    ``,
    `EDITORIAL VOICE — read this twice before drafting.`,
    `miami.community is the AI-edited local paper that reads like a smart friend telling you what happened in plain English. Source publications write at length for general audiences; we don't. Our job is to take their reporting and make it SHORTER, SNAPPIER, CLEARER for a busy Miami reader. If your draft reads like the source headline / lede with light edits, rewrite it.`,
    ``,
    `Hard rules:`,
    `- Headline: 6–10 words, ≤ 60 chars. Active voice. Lead with the news. Never copy or near-copy the source publication's headline.`,
    `- Dek: ≤ 120 chars / ~20 words. ADDS information the headline doesn't carry — don't restate. If you'd just be rewording the headline, write a shorter dek with one concrete fact (a number, a place, a name).`,
    `- Body: ONE paragraph, 40–80 words. The shortest version that answers who/what/where/when + why a Miamian should care. Distill, don't paraphrase. Cut every sentence that doesn't add a fact.`,
    `- State only facts present in the cited items. Do not fabricate quotes, names, dates, or numbers. If something's missing, omit it.`,
    `- Never reproduce source text verbatim — re-express in our voice.`,
    `- No headlinese / hedging clichés ("amid", "as", "after", "in a sign that", "experts say", "comes as", "raises concerns"). Cut them.`,
    `- No clickbait. No questions in headlines. No "you'll never believe", "here's what", etc.`,
    `- Skip items that are not newsworthy for a Miami audience.`,
    relatedText
      ? `- For each draft, look at the "Recently published articles" list below. If this draft is a follow-up, background context, or another angle on one of those, include its bracket index in \`relatedArticleIndices\`. 0–3 entries. Empty is fine — only link when the connection is real.`
      : `- Leave \`relatedArticleIndices\` empty (no recent articles available).`,
    relatedText
      ? `- DEDUPE: If your incoming sources are reporting on the SAME story we already covered (one of the candidate articles is essentially the same event from a different outlet), set \`updateOfRelatedIndex\` to that candidate's bracket index instead of producing a fresh draft. The system will merge your sources into the existing article. Only use this for *the same story*, not follow-ups or another angle (those go in relatedArticleIndices).`
      : "",
    sectionsText
      ? `- For each draft, set \`sectionSlug\` to the most specific section from this desk's allowed list (below). Default to the desk's primary section if no sub-section is a clearer fit.`
      : "",
    `- ALSO populate \`events\`: extract any specific upcoming events mentioned in the source items. Required fields: title, description, kind, startsAtIso (ISO 8601 with Miami offset), allDay, citationItemIndices. Choose kind from: general (things-to-do), meeting (community meeting / public hearing), notice (public notice / comment period), holiday, deal. STRICT: only include events with an explicit date in the source — never invent dates. Empty array is fine when sources mention no concrete events.`,
    ``,
    `Source items:`,
    itemsText,
    ...(sectionsText
      ? ["", `Allowed sections for this desk (use the slug for sectionSlug):`, sectionsText]
      : []),
    ...(relatedText
      ? ["", `Recently published articles (for relatedArticleIndices):`, relatedText]
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
    tool_choice: { type: "tool", name: "submit_drafts" },
    messages: [{ role: "user", content: userPrompt }],
  })

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  )
  if (!toolUse) throw new Error("LLM did not return a tool_use block")
  const input = toolUse.input as { drafts?: unknown; events?: unknown }
  if (!Array.isArray(input.drafts)) {
    throw new Error("LLM tool input did not contain drafts array")
  }
  const drafts = input.drafts
    .map(validateDraft)
    .filter((d): d is LlmDraft => d !== null)
  const events = Array.isArray(input.events)
    ? input.events
        .map(validateEvent)
        .filter((e): e is LlmEvent => e !== null)
    : []
  return { drafts, events }
}

const KIND_SET: Set<string> = new Set(EVENT_KINDS.map((k) => k.slug))

function validateEvent(raw: unknown): LlmEvent | null {
  if (!raw || typeof raw !== "object") return null
  const e = raw as Record<string, unknown>
  if (typeof e.title !== "string" || !e.title.trim()) return null
  if (typeof e.description !== "string") return null
  if (typeof e.kind !== "string" || !KIND_SET.has(e.kind)) return null
  if (typeof e.startsAtIso !== "string") return null
  if (Number.isNaN(new Date(e.startsAtIso).getTime())) return null
  if (typeof e.allDay !== "boolean") return null
  if (!Array.isArray(e.citationItemIndices)) return null
  if (!e.citationItemIndices.every((i) => Number.isInteger(i))) return null
  if (e.citationItemIndices.length === 0) return null
  return {
    title: e.title.slice(0, 200),
    description: e.description.slice(0, 600),
    kind: e.kind as LlmEvent["kind"],
    startsAtIso: e.startsAtIso,
    endsAtIso:
      typeof e.endsAtIso === "string" &&
      !Number.isNaN(new Date(e.endsAtIso).getTime())
        ? e.endsAtIso
        : undefined,
    allDay: e.allDay,
    locationName:
      typeof e.locationName === "string" ? e.locationName : undefined,
    neighborhood:
      typeof e.neighborhood === "string" ? e.neighborhood : undefined,
    url: typeof e.url === "string" ? e.url : undefined,
    price: typeof e.price === "string" ? e.price : undefined,
    citationItemIndices: e.citationItemIndices as Array<number>,
    relatedDraftIndex: Number.isInteger(e.relatedDraftIndex)
      ? (e.relatedDraftIndex as number)
      : undefined,
  }
}

// =====================================================================
// Enrichment pass — operates on already-PUBLISHED articles to refine,
// extend, and connect them. Distinct from generateDrafts (which creates
// new drafts from raw items) because here the article already exists and
// we're feeding the LLM both: the existing piece + freshly-ingested items
// that may add facts, and a candidate set of recent published articles
// the piece could link to.
// =====================================================================

export type EnrichmentArticle = {
  title: string
  dek: string
  body: string
  tags: Array<string>
  sectionSlug: string
  citations: Array<{ url: string; title: string; publisher?: string }>
  neighborhoodSlugs?: Array<string>
}

export type EnrichmentOutput = {
  // Optional rewrites — undefined = keep existing.
  title?: string
  dek?: string
  body?: string
  tags?: Array<string>
  neighborhoodSlugs?: Array<string>
  // Indices into the `newItems` argument that genuinely add facts/sources.
  citationItemIndicesToAdd: Array<number>
  // Indices into the `relatedCandidates` argument that are truly related.
  relatedArticleIndicesToLink: Array<number>
  // One-line reason for any rewrites (so editors see WHY in the timeline).
  rewriteJustification?: string
}

const ENRICH_TOOL = {
  name: "enrich_article",
  description:
    "Apply ADDITIVE improvements to a published article: append new citations, link related stories, and OPTIONALLY rewrite title/dek/body for clarity. Only suggest rewrites that materially improve the piece. If new items don't actually add facts, leave citationItemIndicesToAdd empty. If no candidate is truly related, leave relatedArticleIndicesToLink empty. NEVER fabricate facts — every claim must trace to either the existing article or a cited new item.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description:
          "Improved headline (6–10 words, ≤ 60 chars). Active voice. Omit when the existing headline is already short and clear; rewrite when it's long, hedging, or mirrors the source publication.",
      },
      dek: {
        type: "string",
        description:
          "Improved standfirst (≤ 120 chars / ~20 words). Adds info the headline doesn't carry. Omit when the existing dek is already tight.",
      },
      body: {
        type: "string",
        description:
          "Improved body — ONE paragraph, 40–80 words. Distill, don't paraphrase. Omit unless new facts warrant a rewrite or the existing body reads bloated.",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description:
          "Replacement tags (2–5 lowercase). Omit to keep existing. Do NOT use generic location tags like 'miami', 'miami-dade', or 'florida'.",
      },
      neighborhoodSlugs: {
        type: "array",
        items: { type: "string", enum: NEIGHBORHOODS.map((n) => n.slug) },
        description:
          "Replacement neighborhood slugs. Omit to keep existing.",
      },
      citationItemIndicesToAdd: {
        type: "array",
        items: { type: "integer" },
        description:
          "Indices into the new-items list that add fresh facts or sources to this story. Empty when nothing genuinely adds.",
      },
      relatedArticleIndicesToLink: {
        type: "array",
        items: { type: "integer" },
        description:
          "Indices into the related-candidates list that are truly related (follow-up, background, sibling story). Empty when nothing connects.",
      },
      rewriteJustification: {
        type: "string",
        description:
          "One short line explaining any rewrite — shown to editors in the revision timeline.",
      },
    },
    required: ["citationItemIndicesToAdd", "relatedArticleIndicesToLink"],
  },
} as const

function validateEnrichment(raw: unknown): EnrichmentOutput | null {
  if (!raw || typeof raw !== "object") return null
  const e = raw as Record<string, unknown>
  if (!Array.isArray(e.citationItemIndicesToAdd)) return null
  if (!Array.isArray(e.relatedArticleIndicesToLink)) return null
  const cite = (e.citationItemIndicesToAdd as Array<unknown>).filter((i) =>
    Number.isInteger(i),
  ) as Array<number>
  const link = (e.relatedArticleIndicesToLink as Array<unknown>).filter((i) =>
    Number.isInteger(i),
  ) as Array<number>
  const tags = Array.isArray(e.tags)
    ? (e.tags as Array<unknown>)
        .filter((t): t is string => typeof t === "string" && t.length > 0)
        .slice(0, 6)
    : undefined
  const neighborhoods = Array.isArray(e.neighborhoodSlugs)
    ? (e.neighborhoodSlugs as Array<unknown>)
        .filter((s): s is string => typeof s === "string")
        .slice(0, 3)
    : undefined
  return {
    title:
      typeof e.title === "string" && e.title.trim().length > 0
        ? e.title.slice(0, 200)
        : undefined,
    dek:
      typeof e.dek === "string" && e.dek.trim().length > 0
        ? e.dek.slice(0, 400)
        : undefined,
    body:
      typeof e.body === "string" && e.body.trim().length > 0
        ? e.body
        : undefined,
    tags,
    neighborhoodSlugs: neighborhoods,
    citationItemIndicesToAdd: cite,
    relatedArticleIndicesToLink: link,
    rewriteJustification:
      typeof e.rewriteJustification === "string"
        ? e.rewriteJustification.slice(0, 280)
        : undefined,
  }
}

export async function generateEnrichment(opts: {
  systemPrompt: string
  model: string
  article: EnrichmentArticle
  newItems: Array<DraftItem>
  relatedCandidates: Array<RelatedCandidate>
}): Promise<EnrichmentOutput | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set in Convex env")
  const client = new Anthropic({ apiKey })

  const itemsText = opts.newItems
    .map((item) => {
      const date = item.publishedAt ? ` (${item.publishedAt})` : ""
      return `[${item.index}] ${item.source} — ${item.title}${date}\nURL: ${item.url}\n${item.body}\n`
    })
    .join("\n---\n")

  const relatedText =
    opts.relatedCandidates.length > 0
      ? opts.relatedCandidates
          .map((c) => {
            const date = c.publishedAt ? ` (${c.publishedAt})` : ""
            return `[${c.index}] ${c.section} — ${c.title}${date}\n  ${c.dek}`
          })
          .join("\n")
      : "(no candidates)"

  const existingCitations =
    opts.article.citations.length > 0
      ? opts.article.citations
          .map((c) => `- ${c.title} (${c.publisher ?? "—"}) — ${c.url}`)
          .join("\n")
      : "(none recorded)"

  const userPrompt = [
    `You are doing an ENRICHMENT pass on a published article. Your goal: keep it sharper and more useful by adding new sources, linking related coverage, polishing copy when warranted, and updating metadata.`,
    `Return your changes ONLY by calling the \`enrich_article\` tool. Do not return text outside the tool call.`,
    `Hard rules:`,
    `- Never fabricate facts. Every claim must trace to either the existing article or a cited new item.`,
    `- Be conservative with rewrites: only rewrite title/dek/body when there is a real improvement (clarity, brevity, accuracy, or a new fact). If it's already short and clear, omit those fields.`,
    `- House voice: punchy and short. Headlines 6–10 words / ≤ 60 chars. Deks ≤ 120 chars. Body ONE paragraph, 40–80 words. If the existing copy is wordy or mirrors the source publication, that's reason enough to rewrite shorter.`,
    `- citationItemIndicesToAdd should ONLY include items that add a fact or source not already in the article. Reject anything redundant.`,
    `- relatedArticleIndicesToLink: only link candidates that a reader would genuinely benefit from. Empty list is fine.`,
    `- Tags: 2–5, lowercase, specific. No 'miami', 'miami-dade', or 'florida'.`,
    ``,
    `=== EXISTING ARTICLE ===`,
    `Section: ${opts.article.sectionSlug}`,
    `Title: ${opts.article.title}`,
    `Dek: ${opts.article.dek}`,
    `Body: ${opts.article.body}`,
    `Tags: ${opts.article.tags.join(", ") || "(none)"}`,
    `Neighborhoods: ${(opts.article.neighborhoodSlugs ?? []).join(", ") || "(none)"}`,
    `Existing citations:`,
    existingCitations,
    ``,
    `=== NEW INGESTED ITEMS (candidates for citationItemIndicesToAdd) ===`,
    itemsText || "(none)",
    ``,
    `=== RECENT PUBLISHED ARTICLES (candidates for relatedArticleIndicesToLink) ===`,
    relatedText,
  ].join("\n")

  const response = await client.messages.create({
    model: opts.model,
    max_tokens: 2048,
    system: opts.systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    tools: [ENRICH_TOOL],
    tool_choice: { type: "tool", name: "enrich_article" },
  })

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  )
  if (!toolUse) return null
  return validateEnrichment(toolUse.input)
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
