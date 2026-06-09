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
    /** Coverage floor — when the section publishes fewer than this
     *  many events in the trailing 14d window, the daily coverage
     *  cron writes a systemAlerts row. Leaf sections (Theater, Music,
     *  Books, etc.) get small numbers (3-5); the catch-all city
     *  section is excluded. Optional — sections without it skip
     *  coverage checks entirely. */
    minEventsLast14d: v.optional(v.number()),
    /** Last computed event count for the trailing 14d window, refreshed
     *  by the coverage cron. Surfaced on /admin so the editor can see
     *  who's near the floor before the alert trips. */
    eventsLast14d: v.optional(v.number()),
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


  sources: defineTable({
    name: v.string(),
    // Calendar-shaped adapters only. News/social types (rss, reddit,
    // youtube, x, bluesky, web, wikipedia-otd, data) were dropped in
    // the events-only pivot — every existing row is one of the five
    // below, and the narrowed union prevents legacy types from
    // sneaking back through `create` / `installSource`.
    type: v.union(
      v.literal("ics"),
      v.literal("events-html"),
      v.literal("sitemap-events"),
      v.literal("miami-new-times"),
      v.literal("llm-extract"),
      v.literal("browser-extract"),
    ),
    url: v.string(),
    // Legacy hint, retained for backfill compatibility. Sections are
    // now assigned per-event by `convex/lib/classify.ts` based on the
    // event's own title / venue / source URL — a single source can
    // ship events across many sections. New writes can omit.
    sectionIds: v.optional(v.array(v.id("sections"))),
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
    // Rolling 30-day event-yield counter + last-event timestamp,
    // refreshed by the sourceHealth.dailyTick cron. Drives the
    // /admin/sources health rail and the auto-disable rule for
    // sources that fetch fine but never produce events.
    eventsLast30d: v.optional(v.number()),
    lastEventAt: v.optional(v.number()),
    // Conditional-fetch cache. Server returns ETag and/or
    // Last-Modified; next fetch sends them back as If-None-Match /
    // If-Modified-Since. A 304 short-circuits the extractor entirely
    // — no HTML parse, no LLM call. Halves daily Haiku spend on
    // long-tail sources that rarely change.
    lastEtag: v.optional(v.string()),
    lastModifiedHeader: v.optional(v.string()),
    /** Miami neighborhood slugs this source serves. Used by the admin
     *  page to group sources by area and surface coverage gaps. Optional
     *  — generic city-wide feeds (Eventbrite Miami, Refresh Miami) leave
     *  it empty. Validated against lib/neighborhoods.ts at write time. */
    neighborhoodSlugs: v.optional(v.array(v.string())),
  })
    .index("by_enabled", ["enabled"]),

  // Domains spotted in event citations that aren't yet registered
  // sources. Populated by `discovery:weeklyTick`. Editors approve or
  // dismiss from /admin/sources; approving runs probe + installSource.
  sourceSuggestions: defineTable({
    /** Canonical hostname (lowercased, www stripped). The primary
     *  identity key — one row per unique source domain. */
    domain: v.string(),
    /** Up to N example event URLs from that domain — gives the editor
     *  enough context to decide. */
    sampleUrls: v.array(v.string()),
    /** Count of distinct events seen pointing at this domain in the
     *  discovery window. Higher = better signal to install. */
    eventCount: v.number(),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("dismissed"),
    ),
  })
    .index("by_domain", ["domain"])
    .index("by_status", ["status"]),

  // Editor-curated taxonomy overrides. The classifier
  // (`convex/lib/classify.ts`) reads these in addition to the built-in
  // hardcoded baseline — DB rows take precedence when both match a
  // given event. Edit live from /admin/taxonomy without a redeploy.
  taxonomyVenues: defineTable({
    /** Lowercase + ampersand-folded venue name match (`includes`
     *  semantics — "kaseya center" matches "Kaseya Center, Miami"). */
    venueKey: v.string(),
    /** Section slug the matched venue should route into. */
    sectionSlug: v.string(),
    /** Free-text label for the admin UI ("Kaseya Center / Heat home"). */
    note: v.optional(v.string()),
  }).index("by_venueKey", ["venueKey"]),

  taxonomyHosts: defineTable({
    /** Lowercase hostname (`www.` stripped). Matches exact + parent
     *  domain via the classifier's parts.slice(-2) fallback. */
    host: v.string(),
    sectionSlug: v.string(),
    note: v.optional(v.string()),
  }).index("by_host", ["host"]),

  taxonomyKeywords: defineTable({
    /** RegExp source string (compiled with `i` flag). Match against
     *  title + body + venue concat. */
    pattern: v.string(),
    sectionSlug: v.string(),
    /** Tags to add to the event when this rule fires. */
    tags: v.array(v.string()),
    /** Ordered priority — higher fires first within the keyword pass. */
    order: v.number(),
    note: v.optional(v.string()),
  }).index("by_order", ["order"]),

  taxonomyAudienceBlocks: defineTable({
    /** RegExp source string (`i` flag). Match against the event's
     *  haystack — if hit and no PUBLIC_OVERRIDES match, the event is
     *  dropped by isPrivateAudience. */
    pattern: v.string(),
    note: v.optional(v.string()),
  }),

  // Forward-geocoding cache. Mapbox calls are billed per-lookup so
  // we memoize by normalized address — events that share a venue
  // ("Adrienne Arsht Center, 1300 Biscayne Blvd, Miami, FL") hit the
  // cache after the first lookup. Stale entries (>180d) get refreshed
  // lazily on next read.
  geocodeCache: defineTable({
    normalizedAddress: v.string(),
    lat: v.number(),
    lng: v.number(),
    /** Mapbox-resolved neighborhood slug, if it mapped to one of
     *  Miami-Dade's known neighborhoods. */
    neighborhood: v.optional(v.string()),
    /** Raw place-name returned by Mapbox — kept for debugging
     *  classifier misses. */
    placeName: v.optional(v.string()),
    fetchedAt: v.number(),
  }).index("by_normalized", ["normalizedAddress"]),

  // Cache of Spanish translations keyed on the djb2 hash of
  // `${title}|${dek}`. Lets us skip Haiku entirely when an identical
  // title+dek combo has already been translated — common for
  // syndicated listings (Eventbrite cross-posts, ICS clones, repeated
  // venue copy) and for re-runs of the same event after dedupe.
  translationCache: defineTable({
    sourceHash: v.string(),
    title: v.string(),
    dek: v.string(),
    heroCaption: v.optional(v.string()),
    /** When the entry was first written. We don't currently expire
     *  cache entries — if EN copy changes the sourceHash changes too,
     *  so a stale entry can only be hit by truly identical inputs. */
    createdAt: v.number(),
    /** Bumped each time the cache is reused for an event. Used to
     *  cheaply order eviction if we ever cap table size. */
    hits: v.number(),
  }).index("by_hash", ["sourceHash"]),

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
    // Structured event fields — populated by ICS / JSON-LD / sitemap
    // adapters when the source's data carries the equivalent. Used by
    // the deterministic ingest pipeline to insert events without an
    // LLM rewrite pass. News-shaped adapters (RSS, reddit) leave them
    // undefined and their items get skipped at ingest time.
    startsAt: v.optional(v.number()),
    endsAt: v.optional(v.number()),
    locationName: v.optional(v.string()),
    locationAddress: v.optional(v.string()),
    allDay: v.optional(v.boolean()),
    price: v.optional(v.string()),
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
    /** Lights Out — when explicitly false, every LLM-backed action
     *  short-circuits without making a call. Lets us test the no-AI
     *  floor or panic-toggle during a billing scare without a deploy.
     *  Default true (LLMs on). */
    llmEnabled: v.optional(v.boolean()),
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

  // Events are the canonical (and only) content primitive on the site.
  // Two flavors live in the same table:
  //   - kind="scheduled" : a thing happening in the future (concert,
  //     opening, vote, game). `description` is calendar-style; `body`
  //     is usually empty. Surfaced by proximity to startsAt.
  //   - kind="reported"  : an event that already happened. `startsAt`
  //     captures when it happened. `dek` + `body` carry editorial copy.
  //     Surfaced by publishedAt + importance.
  // Both render through the same UI; the layout chooses treatment
  // based on which fields are populated and whether startsAt is in
  // the future.
  events: defineTable({
    // Stable kebab-case URL fragment.
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
    // Geocoded coordinates. Populated by the events.geocodeOne action
    // which calls Mapbox Geocoding API on locationAddress (and falls
    // back to neighborhood centroid when no address is available).
    // Drives the Map view; absence means the event isn't placeable
    // and the map renderer skips it.
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
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
    relatedEventIds: v.optional(v.array(v.id("events"))),
    // Merge sweep parity with articles. When two reported events are
    // detected as the same news, the loser gets `mergedIntoId` set +
    // status=archived; the winner absorbs the loser's citations. Slug
    // resolution checks `previousSlugs` so old URLs keep working.
    mergedIntoId: v.optional(v.id("events")),
    mergedAt: v.optional(v.number()),
    previousSlugs: v.optional(v.array(v.string())),
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
    /** Quality score 0..1 computed at insert from completeness +
     *  classifier confidence. Events below ~0.55 get parked in
     *  `pending_review` for editor approval instead of auto-going
     *  live. */
    qualityScore: v.optional(v.number()),
    /** Short token: "venue" | "host" | "keyword" | "tag" | "fallback".
     *  Lets the review queue surface "why this needs eyes." */
    classifierReason: v.optional(v.string()),
    // Pre-computed next ~30 days of RRULE occurrences (epoch ms).
    // Populated by the `recurrence:expandTick` cron on rows with
    // recurrenceRule. Lets the UI render "next 3 dates" and lets a
    // future date-range query find a weekly yoga class without
    // re-parsing RRULEs at read time.
    recurrenceInstances: v.optional(v.array(v.number())),
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
            // Legacy field — kept on the validator so existing
            // translations still validate. New writes leave it
            // empty; the frontend reads `dek`.
            description: v.optional(v.string()),
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
    // Content-derived dedup key: normalize(title) + day(startsAt).
    // Set on every new event; used by insertExtracted to detect when
    // the same event arrives from two different sources (e.g. FIU
    // events.fiu.edu iCal + calendar.fiu.edu events-html) and merge
    // their citations instead of inserting twice.
    dedupeKey: v.optional(v.string()),
    // Series key: normalize(title) + "|" + normalize(venue), no date.
    // Catches recurring exhibits (e.g. Balloon Museum's daily showings
    // over a 6-week run) that the day-keyed `dedupeKey` lets through
    // as N separate rows. `insertExtracted` queries this first and
    // merges new showings into the earliest-upcoming row in the series.
    seriesKey: v.optional(v.string()),
    // Trailing-30-day view count, denormalized for the "Popular" rail.
    // Patched nightly by `popularity:cronTick` from the `eventViews`
    // log table. Optional because legacy rows pre-date the field and
    // events with no recorded views never get touched. Read by the
    // rail sort and the `compareByPopularity` helper.
    viewCount30d: v.optional(v.number()),
    viewCountUpdatedAt: v.optional(v.number()),
  })
    .index("by_slug", ["slug"])
    .index("by_starts", ["startsAt"])
    .index("by_status_starts", ["status", "startsAt"])
    .index("by_section_starts", ["sectionId", "status", "startsAt"])
    .index("by_dedupe_key", ["dedupeKey"])
    .index("by_series_key", ["seriesKey"])
    // Reported-events feed sorts by publishedAt (newspaper-style), so
    // the homepage's "latest editorial" query is O(log n) instead of
    // a full table scan.
    .index("by_status_published", ["status", "publishedAt"])
    .index("by_section_status_published", [
      "sectionId",
      "status",
      "publishedAt",
    ])
    // Popular-events feed sorts by trailing-30d view count. Status
    // filter so archived/draft rows are excluded from rail queries.
    .index("by_status_views", ["status", "viewCount30d"])
    .searchIndex("by_searchable", {
      searchField: "searchableText",
      filterFields: ["status", "sectionId"],
    }),

  // Append-only view log. Each row is one open of an event detail
  // page (drawer or full route), deduped per session on the client so
  // F5-spam doesn't inflate counts. The nightly popularity cron rolls
  // these up into `events.viewCount30d` and prunes rows older than
  // 30 days. We keep the raw log so the window can be retuned later
  // without rebuilding from scratch.
  eventViews: defineTable({
    eventId: v.id("events"),
    viewedAt: v.number(),
  })
    .index("by_event_time", ["eventId", "viewedAt"])
    .index("by_time", ["viewedAt"]),

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
