import { authTables } from "@convex-dev/auth/server"
import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

export default defineSchema({
  ...authTables,

  sections: defineTable({
    slug: v.string(),
    name: v.string(),
    description: v.string(),
    accentColor: v.string(),
    order: v.number(),
    // Optional primary parent — when set, this is the section's
    // canonical home in the tree. Drives the breadcrumb, the SubNav
    // it appears in by default, and the section page's section-header
    // accent. Top-level sections leave this undefined.
    parentId: v.optional(v.id("sections")),
    // Additional parents this section is cross-listed under. Museums
    // (primary parent: science) is also relevant under arts; the same
    // section row appears in both SubNavs, and event-scoping queries
    // that recurse into "children of arts" pick it up too. Optional
    // array — most sections leave it empty.
    crossListedIn: v.optional(v.array(v.id("sections"))),
    // Tag synonyms that count as "relevant to this section." Event-
    // scoping queries (topInSection / listBySection) union events
    // filed directly under the section with events tagged any of
    // these. Lets /section/books surface "jazz at Books & Books"
    // (primary section: music, also tagged "books"). Curated per
    // section — defaults to just [slug] when unset.
    associatedTags: v.optional(v.array(v.string())),
  })
    .index("by_slug", ["slug"])
    .index("by_order", ["order"])
    .index("by_parent", ["parentId"]),

  authors: defineTable({
    slug: v.string(),
    name: v.string(),
    bio: v.string(),
    avatar: v.optional(v.string()),
    title: v.optional(v.string()),
    kind: v.union(v.literal("agent"), v.literal("human")),
  }).index("by_slug", ["slug"]),

  articles: defineTable({
    slug: v.string(),
    title: v.string(),
    dek: v.string(),
    body: v.string(),
    /** Default "article". When "video", the article-page template uses
     *  a video-first layout — body still renders, but the lead is the
     *  embedded player rather than the hero image. Set by the youtube
     *  adapter when an item is video-native. */
    mediaType: v.optional(v.union(v.literal("article"), v.literal("video"))),
    /** Embedded media reference (only when mediaType === "video"). */
    videoEmbed: v.optional(
      v.object({
        provider: v.union(v.literal("youtube"), v.literal("vimeo")),
        id: v.string(),
      }),
    ),
    heroImage: v.optional(v.string()),
    heroCaption: v.optional(v.string()),
    heroSource: v.optional(
      v.union(
        v.literal("source"),
        v.literal("unsplash"),
        v.literal("wikimedia"),
        v.literal("none"),
      ),
    ),
    heroLastChecked: v.optional(v.number()),
    heroLastStatus: v.optional(
      v.union(v.literal("ok"), v.literal("broken"), v.literal("unknown")),
    ),
    sectionId: v.id("sections"),
    status: v.union(
      v.literal("draft"),
      v.literal("pending_review"),
      v.literal("published"),
      v.literal("archived"),
      v.literal("rejected"),
    ),
    publishedAt: v.optional(v.number()),
    createdAt: v.number(),
    tags: v.array(v.string()),
    // DEPRECATED: editorial pinning was removed in favor of computed
    // importance scoring (see lib/scoring.ts). Kept optional so existing
    // records validate; new inserts omit it. Drop the column + the
    // by_featured index in a follow-up push once values are unset.
    isFeatured: v.optional(v.boolean()),
    // Post-publish merge sweep (see articles.mergeSweep): when two
    // articles are detected as the same news event, the LLM-verified
    // loser gets `mergedIntoId` set + status flipped to "archived";
    // the winner absorbs the loser's citations and source items.
    // Reader-facing slug-resolution checks `previousSlugs` so old
    // URLs continue to resolve to the surviving article.
    mergedIntoId: v.optional(v.id("articles")),
    mergedAt: v.optional(v.number()),
    previousSlugs: v.optional(v.array(v.string())),
    citations: v.array(
      v.object({
        url: v.string(),
        title: v.string(),
        publisher: v.optional(v.string()),
        fetchedAt: v.number(),
        snippet: v.optional(v.string()),
      }),
    ),
    agentSlug: v.optional(v.string()),
    agentRunId: v.optional(v.id("agentRuns")),
    derivedFromItems: v.array(v.id("ingestedItems")),
    // Miami neighborhoods this story is tied to. Populated by the desk's
    // LLM at draft time from a fixed allowed list (see lib/neighborhoods.ts).
    neighborhoods: v.optional(v.array(v.string())),
    // Related articles populated at draft time by the desk's LLM call.
    // Bidirectional: when X links to Y, both ends get the back-reference.
    relatedArticleIds: v.optional(v.array(v.id("articles"))),
    // Story arc clustering: any cluster of articles that transitively link
    // forms an arc. Set when a draft links to existing articles; merged if
    // it links across two existing arcs.
    storyArcId: v.optional(v.id("storyArcs")),
    // Denormalized full-text search blob = title + dek + tags. Maintained
    // at insert / update time. Optional so existing docs validate; queries
    // tolerate a missing value.
    searchableText: v.optional(v.string()),
    // Per-language translations of the user-facing copy. Generated by an
    // LLM action triggered on publish + when the EN copy changes (e.g.
    // via merge or augment). `sourceHash` is a sha of EN title+dek+body
    // — when the EN shifts, the hash mismatches and the row is flagged
    // for re-translate by the translation backlog cron.
    translations: v.optional(
      v.object({
        es: v.optional(
          v.object({
            title: v.string(),
            dek: v.string(),
            body: v.string(),
            heroCaption: v.optional(v.string()),
            translatedAt: v.number(),
            sourceHash: v.string(),
          }),
        ),
      }),
    ),
  })
    .index("by_slug", ["slug"])
    .index("by_section_status_published", ["sectionId", "status", "publishedAt"])
    .index("by_status_created", ["status", "createdAt"])
    .index("by_status_published", ["status", "publishedAt"])
    .index("by_story_arc", ["storyArcId"])
    // Full-text search across the title + a derived searchable blob. The
    // `searchableText` field is maintained at insert / update time as
    // `title + dek + tags.join(" ")` so a single index covers headline,
    // standfirst, and topic recall.
    .searchIndex("by_searchable", {
      searchField: "searchableText",
      filterFields: ["status", "sectionId"],
    }),

  article_authors: defineTable({
    articleId: v.id("articles"),
    authorId: v.id("authors"),
  })
    .index("by_article", ["articleId"])
    .index("by_author", ["authorId"]),

  sources: defineTable({
    name: v.string(),
    type: v.union(
      v.literal("rss"),
      v.literal("reddit"),
      v.literal("youtube"),
      v.literal("x"),
      v.literal("bluesky"),
      v.literal("web"),
      v.literal("wikipedia-otd"),
      v.literal("ics"),
      v.literal("events-html"),
      v.literal("sitemap-events"),
      v.literal("data"),
    ),
    url: v.string(),
    sectionIds: v.array(v.id("sections")),
    enabled: v.boolean(),
    config: v.optional(v.any()),
    lastFetchedAt: v.optional(v.number()),
    lastFetchStatus: v.optional(v.string()),
    lastFetchError: v.optional(v.string()),
    lastFetchItemCount: v.optional(v.number()),
    lastFetchNewCount: v.optional(v.number()),
    // Auto-disable signal: incremented on each error fetch, reset on
    // success. Cron disables sources at ≥10 consecutive errors.
    consecutiveErrors: v.optional(v.number()),
    // Set when the auto-disable cron flipped enabled=false; informational.
    autoDisabledAt: v.optional(v.number()),
    autoDisabledReason: v.optional(v.string()),
    /** Per-source poll cadence hint. Defaults to 60 in code when unset.
     *  TV breaking-news feeds get 15; long-tail blogs 240. The mega-desk
     *  fetcher skips sources whose `lastFetchedAt` is younger than this,
     *  so a 30-min cron tick doesn't waste fetches on slow-moving feeds. */
    pollIntervalMinutes: v.optional(v.number()),
  })
    .index("by_enabled", ["enabled"]),

  ingestedItems: defineTable({
    sourceId: v.id("sources"),
    externalId: v.string(),
    url: v.string(),
    title: v.string(),
    snippet: v.optional(v.string()),
    body: v.optional(v.string()),
    mediaUrl: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    fetchedAt: v.number(),
    consumed: v.boolean(),
    // RFC 5545 RRULE captured from the source. Currently populated by
    // the iCal adapter when a VEVENT carries `RRULE:...`. Lets the
    // mega-desk forward recurrence information through to the events
    // table without going through the LLM (the rule is structured
    // data, not editorial copy).
    recurrenceRule: v.optional(v.string()),
  })
    .index("by_source_external", ["sourceId", "externalId"])
    .index("by_consumed_fetched", ["consumed", "fetchedAt"]),

  agents: defineTable({
    slug: v.string(),
    name: v.string(),
    sectionId: v.id("sections"),
    authorId: v.id("authors"),
    model: v.string(),
    systemPrompt: v.string(),
    beats: v.array(v.string()),
    enabled: v.boolean(),
    lastRunAt: v.optional(v.number()),
    maxItemsPerRun: v.number(),
    maxDraftsPerRun: v.number(),
    lookbackHours: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_section", ["sectionId"]),

  agentRuns: defineTable({
    agentId: v.id("agents"),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    status: v.union(
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
      // Cron tick fired but the budget gate said no, or every source
      // was fresh enough that polling was a no-op. We still write a
      // row so /admin/runs reflects "the cron is alive" instead of
      // looking like a 20h dead zone.
      v.literal("skipped"),
    ),
    log: v.array(v.string()),
    itemsConsidered: v.number(),
    draftsCreated: v.number(),
    errorMessage: v.optional(v.string()),
    /** Why this run was skipped, when status === "skipped". One of
     *  "budget-cap" / "all-sources-fresh" / "no-sources-enabled". */
    skippedReason: v.optional(v.string()),
  })
    .index("by_agent_started", ["agentId", "startedAt"])
    .index("by_started", ["startedAt"]),

  // System alerts — written by the run-watchdog cron when something's
  // off (e.g. mega-desk hasn't fired in 90 min). Surfaced on the admin
  // dashboard so a stalled deploy is visible at a glance.
  systemAlerts: defineTable({
    kind: v.string(),
    message: v.string(),
    severity: v.union(
      v.literal("info"),
      v.literal("warning"),
      v.literal("error"),
    ),
    createdAt: v.number(),
    /** Optional self-clear: when the condition resolves, the next
     *  watchdog tick patches `resolvedAt` rather than writing a new
     *  alert; the dashboard shows only unresolved rows. */
    resolvedAt: v.optional(v.number()),
  })
    .index("by_kind", ["kind"])
    .index("by_created", ["createdAt"]),

  editors: defineTable({
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("editor")),
  }).index("by_email", ["email"]),

  // Site-wide flags toggled from the admin dashboard. Single-row table —
  // we always read/write the first doc — but we use `defineTable` so the
  // shape is type-safe and additive flags don't require a new table.
  siteSettings: defineTable({
    // When false, every `<BannerAd>` placeholder + AdSense block hides.
    // Default: true (ads enabled). Toggling propagates instantly via
    // Convex's reactive subscriptions; no redeploy needed.
    adsEnabled: v.boolean(),
    /** Daily LLM spend cap in cents. Read at every `budget.reserve`
     *  call; falls back to a code-side default when unset. Editor can
     *  bump it from the dashboard during news bursts and tighten it
     *  back down later. */
    dailyBudgetCents: v.optional(v.number()),
    /** Public events page renders a "Map" view-toggle pill when this
     *  is true. Default false — map's still wired up but hidden until
     *  the editor flips it. Toggling propagates instantly via the
     *  reactive subscription. */
    mapViewEnabled: v.optional(v.boolean()),
    updatedAt: v.number(),
  }),

  // Per-article timeline. Every meaningful change (draft created, desk
  // augmented with new sources, editor edited, status moved) writes one row.
  // Powers the History panel in the per-article admin editor.
  // Daily LLM spend tracker — one row per (deployment, dayKey). Crons +
  // actions read-and-bump centsSpent before each call; when over the
  // BUDGET_DAILY_CENTS cap the call is short-circuited with a "skipped:
  // budget" log line. Reset is implicit (next dayKey starts fresh).
  llmBudget: defineTable({
    dayKey: v.string(), // "YYYY-MM-DD" Miami time
    centsSpent: v.number(),
    callsToday: v.number(),
    lastUpdatedAt: v.number(),
  }).index("by_day", ["dayKey"]),

  // A story arc groups articles that transitively reference each other.
  // Title is seeded from the first article and may be re-titled later.
  // lastActivityAt drives "still developing" treatment in the UI.
  storyArcs: defineTable({
    title: v.string(),
    startedAt: v.number(),
    lastActivityAt: v.number(),
  }),

  // Events are the canonical content primitive. Two flavors live in
  // the same table:
  //   - kind="scheduled" : a thing happening in the future (concert,
  //     opening, vote, game). `description` is calendar-style; `body`
  //     is usually empty. Surfaced by proximity to startsAt.
  //   - kind="reported"  : a news event that already happened. `startsAt`
  //     captures when it happened. `dek` + `body` carry article-style
  //     editorial copy. Surfaced by publishedAt + importance.
  // Both render through the same newspaper UI; the layout chooses
  // treatment based on which fields are populated and whether startsAt
  // is in the future.
  //
  // Articles table is now legacy — kept for the historical archive only.
  // New ingest writes only events (mega-desk, Phase 1 pivot).
  events: defineTable({
    // Stable kebab-case URL fragment, like articles.slug.
    slug: v.optional(v.string()),
    title: v.string(),
    description: v.string(),
    // Editorial dek (one-line standfirst) — populated for reported
    // events and for scheduled events when the LLM has a good hook.
    // Empty/missing → calendar UI falls back to description.
    dek: v.optional(v.string()),
    // Article-style paragraph body. Populated for reported events
    // (full editorial treatment); usually empty for pure calendar items.
    body: v.optional(v.string()),
    // Two flavors of event — see header comment above.
    kind: v.optional(
      v.union(v.literal("scheduled"), v.literal("reported")),
    ),
    // Video parity with the legacy articles.videoEmbed pattern. Set when
    // the event has a primary video (YouTube clip from the desk's video
    // sources, Instagram embed, etc.) — the renderer leads with the
    // player instead of the hero image.
    videoEmbed: v.optional(
      v.object({
        provider: v.union(v.literal("youtube"), v.literal("vimeo")),
        id: v.string(),
      }),
    ),
    startsAt: v.number(),
    endsAt: v.optional(v.number()),
    allDay: v.boolean(),
    // RFC 5545 RRULE for recurring events ("FREQ=WEEKLY;BYDAY=SA").
    // Forwarded through the pipeline from iCal sources so the renderer
    // can show "Recurs weekly on Saturdays" + the next few occurrences
    // instead of emitting N duplicate event rows. Empty for one-off
    // events. The LLM does not see this — it's structured data the
    // adapter passes through directly.
    recurrenceRule: v.optional(v.string()),
    locationName: v.optional(v.string()),
    locationAddress: v.optional(v.string()),
    // Multi-slug neighborhoods, validated against lib/neighborhoods.ts —
    // mirrors articles.neighborhoods.
    neighborhoods: v.optional(v.array(v.string())),
    url: v.optional(v.string()),
    heroImage: v.optional(v.string()),
    heroCaption: v.optional(v.string()),
    heroSource: v.optional(
      v.union(
        v.literal("source"),
        v.literal("unsplash"),
        v.literal("wikimedia"),
        v.literal("none"),
      ),
    ),
    heroLastChecked: v.optional(v.number()),
    heroLastStatus: v.optional(
      v.union(v.literal("ok"), v.literal("broken"), v.literal("unknown")),
    ),
    price: v.optional(v.string()),
    // Section is the primary categorization, mirroring articles. Stays
    // optional on the schema only because legacy rows that pre-date the
    // section migration may have null sectionId; new writes always set it.
    sectionId: v.optional(v.id("sections")),
    tags: v.optional(v.array(v.string())),
    relatedArticleIds: v.optional(v.array(v.id("articles"))),
    relatedEventIds: v.optional(v.array(v.id("events"))),
    // Merge sweep parity with articles. When two reported events are
    // detected as the same news, the loser gets `mergedIntoId` set +
    // status=archived; the winner absorbs the loser's citations. Slug
    // resolution checks `previousSlugs` so old URLs keep working.
    mergedIntoId: v.optional(v.id("events")),
    mergedAt: v.optional(v.number()),
    previousSlugs: v.optional(v.array(v.string())),
    // Story arc clustering — same shape as articles.storyArcId.
    storyArcId: v.optional(v.id("storyArcs")),
    // Rich citation list, same shape as articles.citations.
    citations: v.optional(
      v.array(
        v.object({
          url: v.string(),
          title: v.string(),
          publisher: v.optional(v.string()),
          fetchedAt: v.number(),
          snippet: v.optional(v.string()),
        }),
      ),
    ),
    // Lifecycle parity with articles: draft (in-progress, not visible) →
    // pending_review (LLM-extracted, awaiting editor) → approved (live) →
    // archived (was approved, now hidden) / rejected (will not run).
    status: v.union(
      v.literal("draft"),
      v.literal("pending_review"),
      v.literal("approved"),
      v.literal("archived"),
      v.literal("rejected"),
    ),
    // Set when an editor approves the event — mirrors articles.publishedAt.
    publishedAt: v.optional(v.number()),
    // Provenance — set when a desk's LLM extracted the event from sources.
    agentSlug: v.optional(v.string()),
    agentRunId: v.optional(v.id("agentRuns")),
    derivedFromItems: v.optional(v.array(v.id("ingestedItems"))),
    // Denormalized search blob = title + dek + description + body + tags.
    // Maintained at insert / update time, mirrors articles.searchableText.
    searchableText: v.optional(v.string()),
    // Per-language translations. `dek` + `body` are optional — only set
    // when the EN counterparts exist (reported flavor).
    translations: v.optional(
      v.object({
        es: v.optional(
          v.object({
            title: v.string(),
            description: v.string(),
            dek: v.optional(v.string()),
            body: v.optional(v.string()),
            heroCaption: v.optional(v.string()),
            translatedAt: v.number(),
            sourceHash: v.string(),
          }),
        ),
      }),
    ),
    createdAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_starts", ["startsAt"])
    .index("by_status_starts", ["status", "startsAt"])
    .index("by_section_starts", ["sectionId", "status", "startsAt"])
    // Reported-events feed sorts by publishedAt (newspaper-style), so
    // the homepage's "latest editorial" query is O(log n) instead of
    // a full table scan.
    .index("by_status_published", ["status", "publishedAt"])
    .index("by_section_status_published", [
      "sectionId",
      "status",
      "publishedAt",
    ])
    .index("by_story_arc", ["storyArcId"])
    .searchIndex("by_searchable", {
      searchField: "searchableText",
      filterFields: ["status", "sectionId"],
    }),

  // First-class numerical / statistical artifacts about Miami —
  // population, demographics, prices, rankings, etc. Auto-generated
  // by the mega-desk: when an article it's drafting cites a number
  // that fits a metric kind, the LLM emits a metric draft alongside
  // the article. Editor-side: visible in the homepage Metrics
  // carousel, and the article body can embed via `[[metric:slug]]`
  // tokens that render inline at read time.
  //
  // Citations are required — every metric carries the source URLs
  // it was extracted from. `validUntil` lets the renderer dim or
  // hide stale numbers (e.g. last-quarter unemployment data).
  metrics: defineTable({
    slug: v.string(),
    title: v.string(),
    subtitle: v.optional(v.string()),
    kind: v.union(
      v.literal("number"),
      v.literal("number-with-delta"),
      v.literal("line"),
      v.literal("bars"),
      v.literal("rank"),
      v.literal("compare"),
    ),
    /** Shape varies by kind:
     *   number              → { value: number; delta?: { value: number; period: string } }
     *   number-with-delta   → { value: number; delta: { value: number; period: string } }
     *   line | bars         → { points: Array<{ label: string; value: number }> }
     *   rank                → { value: number; outOf: number; list: string }
     *   compare             → { left: { label: string; value: number }; right: { label: string; value: number } } */
    data: v.any(),
    unit: v.optional(v.string()),
    citations: v.array(
      v.object({
        url: v.string(),
        title: v.string(),
        publisher: v.string(),
        fetchedAt: v.number(),
      }),
    ),
    relatedTags: v.array(v.string()),
    relatedSectionSlugs: v.array(v.string()),
    validUntil: v.optional(v.number()),
    generatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_generated", ["generatedAt"]),

  // Rotating right-rail widget content. Generated by a daily Opus
  // batch (see widgets.ts → dailyRefresh) — one entry per kind per
  // day. The widget query reads the most-recent row per kind, so old
  // rows stick around as history but never render.
  widgetContent: defineTable({
    kind: v.union(
      v.literal("fun-fact"),
      v.literal("on-this-day"),
      v.literal("landmark"),
      v.literal("animal-fact"),
      v.literal("quote"),
    ),
    title: v.string(),
    body: v.string(),
    /** Speaker name for quotes; image credit / source where relevant. */
    attribution: v.optional(v.string()),
    /** Wikimedia search hint for landmark + animal photos. */
    imageHint: v.optional(v.string()),
    /** Resolved image URL, populated post-generation. */
    imageUrl: v.optional(v.string()),
    generatedAt: v.number(),
  }).index("by_kind_generated", ["kind", "generatedAt"]),
})
