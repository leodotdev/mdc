import { internalMutation } from "./_generated/server"
import type { MutationCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"

// Section accents come from the Tailwind v4 palette at the 600 weight, in their
// canonical oklch values. Keep one distinct hue per section so badges read at a glance.
//
// `parentSlug` makes a section a sub-section of another. Articles tag the most
// specific (leaf) section; the parent's section page surfaces them too.
const SECTIONS: Array<{
  slug: string
  name: string
  description: string
  accentColor: string
  order: number
  parentSlug?: string
}> = [
  {
    slug: "politics",
    name: "Politics",
    description:
      "Civic life in Miami-Dade — commission meetings, town halls, candidate forums, neighborhood-association meetups, public-comment nights.",
    accentColor: "oklch(0.541 0.281 293.009)", // violet-600
    order: 30,
  },
  {
    slug: "city",
    name: "City Government",
    description:
      "City council and commission meetings, zoning boards, town halls — the formal civic agenda for cities across Miami-Dade.",
    accentColor: "oklch(0.541 0.281 293.009)",
    order: 31,
    parentSlug: "politics",
  },
  {
    slug: "local",
    name: "Local",
    description:
      "Neighborhood associations, community councils, hyperlocal meetups, public-comment nights.",
    accentColor: "oklch(0.541 0.281 293.009)",
    order: 32,
    parentSlug: "politics",
  },
  {
    slug: "business",
    name: "Business",
    description:
      "Business events across Miami — conferences, ribbon-cuttings, mixers, networking, port and trade.",
    accentColor: "oklch(0.546 0.245 262.881)", // blue-600
    order: 20,
  },
  {
    slug: "tech",
    name: "Tech",
    description:
      "Tech meetups, hackathons, demo days, founder gatherings — Refresh Miami, eMerge, CIC, Endeavor.",
    accentColor: "oklch(0.546 0.245 262.881)", // blue-600
    order: 22,
    parentSlug: "business",
  },
  {
    slug: "real-estate",
    name: "Real Estate",
    description:
      "Open houses, developer briefings, broker meetups, real-estate panels and tours.",
    accentColor: "oklch(0.609 0.126 221.723)", // cyan-600
    order: 24,
    parentSlug: "business",
  },
  {
    slug: "commerce",
    name: "Commerce",
    description:
      "Retail openings, store launches, chamber of commerce events, pop-up shops, markets, plazas, and small-business happenings across Miami.",
    accentColor: "oklch(0.595 0.13 200)", // teal-ish, sibling of business/blue
    order: 26,
    parentSlug: "business",
  },
  {
    slug: "education",
    name: "Education",
    description:
      "Schools and universities — academic events, open houses, lectures, dissertations, alumni nights. NOT athletics; see Sports for game schedules.",
    accentColor: "oklch(0.577 0.245 27.325)", // red-600
    order: 40,
  },
  {
    slug: "university-of-miami",
    name: "University of Miami",
    description:
      "UM academic events — Herbert Business School, Frost School of Music, Law School, dissertations, webinars, open houses. For Hurricanes athletics see Sports.",
    accentColor: "oklch(0.795 0.184 86.047)",
    order: 36,
    parentSlug: "education",
  },
  {
    slug: "mdc",
    name: "Miami Dade College",
    description:
      "Miami Dade College academic and community events — campus lectures, gallery openings, the Book Fair, Cultura del Lobo.",
    accentColor: "oklch(0.586 0.253 17.585)",
    order: 37,
    parentSlug: "education",
  },
  {
    slug: "fiu",
    name: "FIU",
    description:
      "Florida International University academic events. For FIU Panthers athletics see Sports.",
    accentColor: "oklch(0.546 0.245 262.881)",
    order: 38,
    parentSlug: "education",
  },
  {
    slug: "health",
    name: "Health",
    description:
      "Fitness, wellness, and medical events across Miami — yoga, pilates, cycling, hospital lectures, public-health programs.",
    accentColor: "oklch(0.648 0.20 131.684)", // lime-600
    order: 70,
  },
  {
    slug: "fitness",
    name: "Fitness",
    description:
      "Group exercise classes, gym programs, yoga, pilates, cycling, running clubs, swim, barre, HIIT, dance fitness.",
    accentColor: "oklch(0.648 0.20 131.684)",
    order: 71,
    parentSlug: "health",
  },
  {
    slug: "medical",
    name: "Medical",
    description:
      "Hospital events, medical conferences, public-health programs, health-screening days, CME, blood drives.",
    accentColor: "oklch(0.586 0.253 17.585)",
    order: 87,
    parentSlug: "health",
  },
  {
    slug: "wellness",
    name: "Wellness",
    description:
      "Meditation, mindfulness, mental-health programs, holistic retreats, self-care workshops.",
    accentColor: "oklch(0.541 0.281 293.009)",
    order: 88,
    parentSlug: "health",
  },
  {
    slug: "sports",
    name: "Sports",
    description:
      "Every Miami franchise, every season — from the Dolphins on Sundays to the Hurricanes in Coral Gables.",
    accentColor: "oklch(0.646 0.222 41.116)", // orange-600
    order: 50,
  },
  {
    slug: "dolphins",
    name: "Dolphins",
    description: "Miami Dolphins — NFL.",
    accentColor: "oklch(0.609 0.126 221.723)", // cyan-600 (team color)
    order: 41,
    parentSlug: "sports",
  },
  {
    slug: "heat",
    name: "Heat",
    description: "Miami Heat — NBA.",
    accentColor: "oklch(0.646 0.222 41.116)", // orange-600 (team color)
    order: 42,
    parentSlug: "sports",
  },
  {
    slug: "marlins",
    name: "Marlins",
    description: "Miami Marlins — MLB.",
    accentColor: "oklch(0.546 0.245 262.881)", // blue-600 (team color)
    order: 43,
    parentSlug: "sports",
  },
  {
    slug: "panthers",
    name: "Panthers",
    description: "Florida Panthers — NHL.",
    accentColor: "oklch(0.666 0.179 58.318)", // amber-600 (team color)
    order: 44,
    parentSlug: "sports",
  },
  {
    slug: "inter-miami",
    name: "Inter Miami",
    description: "Inter Miami CF — MLS.",
    accentColor: "oklch(0.586 0.253 17.585)", // rose-600 (team color)
    order: 45,
    parentSlug: "sports",
  },
  {
    // Slug stays `the-u` for URL stability; display name is "Hurricanes".
    slug: "the-u",
    name: "Hurricanes",
    description: "Miami Hurricanes — University of Miami athletics.",
    accentColor: "oklch(0.627 0.194 149.214)", // green-600 (team color)
    order: 46,
    parentSlug: "sports",
  },
  {
    slug: "miami-fc",
    name: "Miami FC",
    description: "Miami FC — USL Championship.",
    accentColor: "oklch(0.546 0.245 262.881)", // blue-600
    order: 47,
    parentSlug: "sports",
  },
  {
    slug: "fiu-panthers",
    name: "FIU",
    description: "FIU Panthers — Florida International athletics.",
    accentColor: "oklch(0.541 0.281 293.009)", // violet-600
    order: 48,
    parentSlug: "sports",
  },
  {
    slug: "food",
    name: "Food",
    description:
      "Food events across Miami — restaurant openings, markets, festivals, tastings, chef dinners.",
    accentColor: "oklch(0.795 0.184 86.047)", // yellow-600
    order: 60,
  },
  {
    slug: "food-openings",
    name: "Openings",
    description:
      "New restaurants, bars, and ventanitas — opening nights, soft-launch dinners, ribbon-cuttings.",
    accentColor: "oklch(0.795 0.184 86.047)", // yellow-600
    order: 62,
    parentSlug: "food",
  },
  {
    slug: "arts",
    name: "Arts & Culture",
    description:
      "Concerts, exhibitions, theater, film, gallery openings, street art — Miami's creative pulse on stage, on screen, on the walls.",
    accentColor: "oklch(0.609 0.126 221.723)", // cyan-600
    order: 10,
  },
  {
    slug: "music",
    name: "Music",
    description: "Concerts, clubs, local artists, festivals.",
    accentColor: "oklch(0.541 0.281 293.009)", // violet-600
    order: 70,
    parentSlug: "arts",
  },
  {
    slug: "film",
    name: "Film",
    description: "Local productions, festivals, movie houses.",
    accentColor: "oklch(0.666 0.179 58.318)", // amber-600
    order: 74,
    parentSlug: "arts",
  },
  {
    slug: "theater",
    name: "Theater",
    description:
      "Stages across the city — Adrienne Arsht, GableStage, Miami New Drama, dance companies, performing arts.",
    accentColor: "oklch(0.586 0.253 17.585)", // rose-600
    order: 76,
    parentSlug: "arts",
  },
  {
    slug: "galleries",
    name: "Galleries",
    description:
      "Wynwood, Little River, the Design District — opening nights, art fairs, the working-artist scene around Art Basel.",
    accentColor: "oklch(0.591 0.293 322.896)", // fuchsia-600
    order: 78,
    parentSlug: "arts",
  },
  {
    slug: "books",
    name: "Books",
    description:
      "Miami's literary scene — the Book Fair, indie bookstores, local authors, readings, and what the city is reading.",
    accentColor: "oklch(0.508 0.118 165.612)", // emerald-700
    order: 80,
    parentSlug: "arts",
  },
  {
    slug: "street-art",
    name: "Street Art",
    description:
      "Murals, public installations, Wynwood Walls, the artists painting Miami's exteriors.",
    accentColor: "oklch(0.609 0.126 221.723)", // cyan-600
    order: 82,
    parentSlug: "arts",
  },
  {
    slug: "science",
    name: "Science",
    description:
      "Museum nights, lectures, history walks, climate panels, nature programs — Miami's research and learning beats. Sub-sections: museums, history, climate, nature.",
    accentColor: "oklch(0.627 0.194 149.214)", // green-600
    order: 80,
  },
  {
    slug: "museums",
    name: "Museums",
    description:
      "PAMM, Frost, Bass, Vizcaya, ICA, HistoryMiami — exhibition openings, members nights, lectures, family days.",
    accentColor: "oklch(0.588 0.158 241.966)", // sky-600
    order: 82,
    parentSlug: "science",
  },
  {
    slug: "history",
    name: "History",
    description:
      "Historical events — heritage walks, archival exhibits, talks on Miami's past. Replaces the old standalone Miami History section.",
    accentColor: "oklch(0.6 0.118 184.704)", // teal-600
    order: 84,
    parentSlug: "science",
  },
  {
    slug: "climate",
    name: "Climate",
    description:
      "Climate-focused events — sea-level-rise talks, hurricane prep, sustainability panels, resilience workshops.",
    accentColor: "oklch(0.627 0.194 149.214)", // green-600 (matches parent)
    order: 86,
    parentSlug: "science",
  },
  {
    slug: "nature",
    name: "Nature",
    description:
      "Everglades programs, wildlife events, beach cleanups, bird walks, reef and park talks.",
    accentColor: "oklch(0.596 0.145 163.225)", // emerald-600
    order: 88,
    parentSlug: "science",
  },
]

// Legacy newspaper-style desks (News, Politics, Business, Sports, Food,
// Arts, Investigations, Miami History, Opinion, Music, Real Estate,
// Climate) were retired with the events-only pivot. Only the Events
// Desk persona is seeded now; the active ingest is the mega-desk
// pipeline (`runEventIngestInternal`) which doesn't consume per-desk
// systemPrompts. Existing legacy `agents` rows in prod are pruned by
// `cleanupLegacyAgents` (below).
const AGENT_PERSONAS = [
  {
    slug: "events-desk",
    name: "Events Desk",
    bio: "AI-assisted desk that crawls source feeds for upcoming Miami events — concerts, festivals, gallery openings, community meetings, public notices, holidays, deals. Events are reviewed by a human editor before publication.",
    title: "AI Desk",
    kind: "agent" as const,
  },
]

// The Events Desk is the only active LLM persona post-pivot. Its
// system prompt is stored on the `agents` row but the active ingest
// (`runEventIngestInternal`) ignores it — the mega-desk has its own
// inline prompt. Kept here so the seed continues to populate a sane
// row and the admin UI shows a useful description.
const EVENTS_PROMPT = `You are the Events desk for miami.community. Your sole job is to crawl source items and queue upcoming Miami events for the editor's calendar.

What to look for:
- Concerts, festivals, gallery openings, restaurant openings, neighborhood happenings → kind: general
- Community meetings, public hearings, town halls, school-board sessions → kind: meeting
- Public notices, comment periods, zoning notices, environmental reviews → kind: notice
- Civic / cultural / religious holidays — Calle Ocho, Carnaval, Three Kings Day → kind: holiday
- Discounts, free-admission days, happy hours, opening specials → kind: deal

Hard rules:
- Always populate the \`events\` array generously. Empty is acceptable ONLY when no item mentions a concrete event.
- Each event MUST have a verifiable startsAtIso (ISO 8601 with Miami offset). NEVER invent dates, times, or locations.
- Each event must cite at least one source item.
- Prefer specific Miami-Dade events. Skip national events without a Miami-Dade venue or angle.`


export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    // 1. Sections
    // First pass: upsert every section without parent links (since the
    // parent's _id may not exist yet when we hit a child entry).
    const sectionIdBySlug = new Map<string, Id<"sections">>()
    for (const s of SECTIONS) {
      const { parentSlug: _ignore, ...doc } = s
      const existing = await ctx.db
        .query("sections")
        .withIndex("by_slug", (q) => q.eq("slug", s.slug))
        .unique()
      if (existing) {
        await ctx.db.patch(existing._id, doc)
        sectionIdBySlug.set(s.slug, existing._id)
      } else {
        const id = await ctx.db.insert("sections", doc)
        sectionIdBySlug.set(s.slug, id)
      }
    }
    // Second pass: wire parentId now that every section has an _id. Sections
    // that no longer have a parent are explicitly cleared.
    for (const s of SECTIONS) {
      const sectionId = sectionIdBySlug.get(s.slug)
      if (!sectionId) continue
      const parentId = s.parentSlug
        ? sectionIdBySlug.get(s.parentSlug)
        : undefined
      await ctx.db.patch(sectionId, { parentId })
    }

    // 2. Author personas (for agent bylines)
    const authorIdBySlug = new Map<string, Id<"authors">>()
    for (const a of AGENT_PERSONAS) {
      const existing = await ctx.db
        .query("authors")
        .withIndex("by_slug", (q) => q.eq("slug", a.slug))
        .unique()
      if (existing) {
        await ctx.db.patch(existing._id, a)
        authorIdBySlug.set(a.slug, existing._id)
      } else {
        const id = await ctx.db.insert("authors", a)
        authorIdBySlug.set(a.slug, id)
      }
    }

    // 3. Agents. Only the Events Desk is seeded — the legacy
    // newspaper-style desks were retired with the events-only pivot;
    // see `cleanupLegacyAgents` below for the prod pruning mutation.
    const AGENTS = [
      {
        slug: "events",
        name: "Events Desk",
        sectionSlug: "local",
        authorSlug: "events-desk",
        model: "claude-opus-4-7",
        systemPrompt: EVENTS_PROMPT,
        beats: [
          "concerts",
          "festivals",
          "gallery openings",
          "community meetings",
          "public notices",
          "holidays",
          "deals and offers",
        ],
        enabled: true,
        maxItemsPerRun: 60,
        maxDraftsPerRun: 2,
        lookbackHours: 96,
      },
    ]
    for (const a of AGENTS) {
      const sectionId = sectionIdBySlug.get(a.sectionSlug)
      const authorId = authorIdBySlug.get(a.authorSlug)
      if (!sectionId || !authorId) continue
      const existing = await ctx.db
        .query("agents")
        .withIndex("by_slug", (q) => q.eq("slug", a.slug))
        .unique()
      const doc = {
        slug: a.slug,
        name: a.name,
        sectionId,
        authorId,
        model: a.model,
        systemPrompt: a.systemPrompt,
        beats: a.beats,
        enabled: a.enabled,
        maxItemsPerRun: a.maxItemsPerRun,
        maxDraftsPerRun: a.maxDraftsPerRun,
        lookbackHours: a.lookbackHours,
      }
      if (existing) await ctx.db.patch(existing._id, doc)
      else await ctx.db.insert("agents", doc)
    }

    // 4. Editor allowlist (super user). Idempotent: clear out existing
    // rows, then insert each canonical email below. Multiple emails
    // supported so the operator can sign in from any of them.
    //
    // (Sources are managed entirely via the /admin/sources UI now —
    // the seed no longer ships a starter list. See the source-system
    // cleanup PR for the rationale: curation-first beats auto-discovery
    // at this scale.)
    const editorEmails = ["leo@leo.dev", "leo@leo.miami"]
    const existingEditors = await ctx.db.query("editors").collect()
    for (const editor of existingEditors) {
      await ctx.db.delete(editor._id)
    }
    for (const email of editorEmails) {
      await ctx.db.insert("editors", {
        email,
        role: "admin",
      })
    }

    // 5. Mega-desk install was retired along with the dead news/social
    // seed mutations — calendar adapters don't need the desk's
    // article-extraction prompts. Left as a stub so existing seed
    // callers don't trip over a missing identifier.
    const mega = { inserted: 0, skipped: 0, total: 0 }

    // 6. Phase-3 expansion sources. ~50 broader feeds (TV, Spanish-
    // language, hyperlocal, university, government press, Reddit, etc.)
    // wired up so a fresh deploy isn't dependent on running additional
    // seed commands to reach decent coverage.
    const expansion = await installExpansionSources(ctx, EXPANSION_FEEDS)

    // 7. Round-2 expansion (verified URLs). ~30 more sources curl-
    // probed before commit so we don't silently auto-disable a third
    // of them on first fetch.
    const expansionV2 = await installExpansionSources(ctx, EXPANSION_FEEDS_V2)

    // 8. Round-3 expansion. ~30 more, targeting undercovered
    // categories (TV station verticals, university research, more
    // venues, podcasts, more Bluesky journos). All verified.
    const expansionV3 = await installExpansionSources(ctx, EXPANSION_FEEDS_V3)

    // 9. Round-4 expansion. Strict Miami-only (no statewide noise) —
    // every TV station's remaining sub-verticals, neighborhood blogs,
    // university athletics, more Bluesky journos. ~45 sources.
    const expansionV4 = await installExpansionSources(ctx, EXPANSION_FEEDS_V4)

    // 10. Round-5 expansion. Events-first push — every iCal feed we
    // could verify, major university calendars, civic/chamber, arts
    // verticals. ~28 sources, heavy on `ics` type for date-accurate
    // event extraction.
    const expansionV5 = await installExpansionSources(ctx, EXPANSION_FEEDS_V5)

    return {
      sections: SECTIONS.length,
      personas: AGENT_PERSONAS.length,
      agents: AGENTS.length,
      megaDesk: mega,
      expansionSources: expansion,
      expansionSourcesV2: expansionV2,
      expansionSourcesV3: expansionV3,
      expansionSourcesV4: expansionV4,
      expansionSourcesV5: expansionV5,
    }
  },
})

// One-shot ICS seed. Sources are otherwise managed by the editor via
// /admin/sources, but a starter set of public Miami calendar feeds is
// useful enough that we ship it as an opt-in mutation. Each entry is
// idempotent (matched by URL) so re-running the mutation only inserts
// new feeds and never duplicates an existing one.
//
// The list is deliberately limited to feeds that returned a valid
// `BEGIN:VCALENDAR` payload during verification — many Miami venues
// (PAMM, Frost, Vizcaya, Arsht, Coral Gables city, Doral, Miami-Dade
// County) don't expose ICS at all and were skipped rather than
// guessed. Add more via the admin UI as you discover them.
//
// Run: `npx convex run seed:seedIcsSources`
export const seedIcsSources = internalMutation({
  args: {},
  handler: async (ctx) => {
    const sectionIdBySlug = new Map<string, Id<"sections">>()
    for (const s of await ctx.db.query("sections").collect()) {
      sectionIdBySlug.set(s.slug, s._id)
    }
    const resolve = (slugs: ReadonlyArray<string>): Array<Id<"sections">> => {
      const ids: Array<Id<"sections">> = []
      for (const slug of slugs) {
        const id = sectionIdBySlug.get(slug)
        if (id) ids.push(id)
      }
      return ids
    }

    // Verified 2026-05-06 — each URL returned a valid BEGIN:VCALENDAR
    // payload during probing. The category IDs are CivicEngage's own
    // numeric ids; they're stable per municipality.
    const FEEDS: Array<{
      name: string
      url: string
      sectionSlugs: ReadonlyArray<string>
    }> = [
      {
        name: "City of Miami Beach — events",
        url: "https://events.miamibeachfl.gov/?ical=1",
        sectionSlugs: ["news", "news"],
      },
      {
        name: "City of North Miami — city events",
        url: "https://www.northmiamifl.gov/common/modules/iCalendar/iCalendar.aspx?catID=14&feed=calendar",
        sectionSlugs: ["news", "news"],
      },
      {
        name: "City of North Miami — library events",
        url: "https://www.northmiamifl.gov/common/modules/iCalendar/iCalendar.aspx?catID=23&feed=calendar",
        sectionSlugs: ["news", "books"],
      },
      {
        name: "City of North Miami — parks & recreation",
        url: "https://www.northmiamifl.gov/common/modules/iCalendar/iCalendar.aspx?catID=24&feed=calendar",
        sectionSlugs: ["news"],
      },
      {
        name: "City of North Miami — commission meetings",
        url: "https://www.northmiamifl.gov/common/modules/iCalendar/iCalendar.aspx?catID=26&feed=calendar",
        sectionSlugs: ["politics", "news"],
      },
      {
        name: "City of North Miami Beach — events",
        url: "https://www.citynmb.com/common/modules/iCalendar/iCalendar.aspx?catID=14&feed=calendar",
        sectionSlugs: ["news", "news"],
      },
      {
        name: "City of North Miami Beach — meetings",
        url: "https://www.citynmb.com/common/modules/iCalendar/iCalendar.aspx?catID=23&feed=calendar",
        sectionSlugs: ["politics", "news"],
      },
      {
        name: "City of North Miami Beach — CRA",
        url: "https://www.citynmb.com/common/modules/iCalendar/iCalendar.aspx?catID=49&feed=calendar",
        sectionSlugs: ["politics", "real-estate"],
      },
      {
        name: "City of Miami Gardens — council meetings",
        url: "https://www.miamigardens-fl.gov/common/modules/iCalendar/iCalendar.aspx?catID=23&feed=calendar",
        sectionSlugs: ["politics", "news"],
      },
      {
        name: "City of Miami Gardens — council events",
        url: "https://www.miamigardens-fl.gov/common/modules/iCalendar/iCalendar.aspx?catID=24&feed=calendar",
        sectionSlugs: ["news", "news"],
      },
      {
        name: "City of Miami Gardens — other city events",
        url: "https://www.miamigardens-fl.gov/common/modules/iCalendar/iCalendar.aspx?catID=27&feed=calendar",
        sectionSlugs: ["news", "news"],
      },
    ]

    let inserted = 0
    let skipped = 0
    for (const feed of FEEDS) {
      const existing = await ctx.db
        .query("sources")
        .filter((q) => q.eq(q.field("url"), feed.url))
        .first()
      if (existing) {
        skipped += 1
        continue
      }
      const sectionIds = resolve(feed.sectionSlugs)
      if (sectionIds.length === 0) continue
      await ctx.db.insert("sources", {
        name: feed.name,
        type: "ics",
        url: feed.url,
        sectionIds,
        enabled: true,
      })
      inserted += 1
    }
    return { inserted, skipped, total: FEEDS.length }
  },
})

// ── Retired news/social seeds ── All five mutations (seedYoutubeSources, seedPodcastSources, seedAggregatorSources, seedNationalSources, seedDataSources) and their feed tables were removed in the events-only pivot. The adapter unions on the sources table no longer permit rss / reddit / youtube / bluesky / data types. Recreate as calendar-shaped feeds (ics / events-html / llm-extract) if needed.

// Internal helper for the Phase-3 expansion seed. Shared by the
// public mutation below and by `seed.run` so a fresh deploy gets all
// expansion sources after one command.
type ExpansionFeed = {
  name: string
  // Calendar-shaped adapters only. The expansion seed lists used to
  // include rss / reddit / youtube / bluesky entries (news-shaped);
  // those were retired with the events-only pivot. Any legacy entries
  // still referencing those types are commented out below — they need
  // to be ported to a calendar adapter (ics or events-html) or
  // dropped before the source is re-seeded.
  type:
    | "ics"
    | "events-html"
    | "sitemap-events"
    | "miami-new-times"
    | "llm-extract"
    | "browser-extract"
  url: string
  sectionSlugs: ReadonlyArray<string>
  /** Optional Miami neighborhood slugs this source serves. */
  neighborhoodSlugs?: ReadonlyArray<string>
  pollMinutes?: number
}

async function installExpansionSources(
  ctx: { db: MutationCtx["db"] },
  feeds: ReadonlyArray<ExpansionFeed>,
): Promise<{ inserted: number; skipped: number; total: number }> {
  const sectionIdBySlug = new Map<string, Id<"sections">>()
  for (const s of await ctx.db.query("sections").collect()) {
    sectionIdBySlug.set(s.slug, s._id)
  }
  let inserted = 0
  let skipped = 0
  for (const feed of feeds) {
    const existing = await ctx.db
      .query("sources")
      .filter((q) => q.eq(q.field("url"), feed.url))
      .first()
    if (existing) {
      skipped += 1
      continue
    }
    const sectionIds: Array<Id<"sections">> = []
    for (const slug of feed.sectionSlugs) {
      const id = sectionIdBySlug.get(slug)
      if (id) sectionIds.push(id)
    }
    if (sectionIds.length === 0) continue
    await ctx.db.insert("sources", {
      name: feed.name,
      type: feed.type,
      url: feed.url,
      sectionIds,
      enabled: true,
      pollIntervalMinutes: feed.pollMinutes,
      neighborhoodSlugs:
        feed.neighborhoodSlugs && feed.neighborhoodSlugs.length > 0
          ? Array.from(feed.neighborhoodSlugs)
          : undefined,
    })
    inserted += 1
  }
  return { inserted, skipped, total: feeds.length }
}

// =====================================================================
// Phase-3 expansion seed — broadens source coverage substantially.
// Local TV stations (high-cadence breaking news), Spanish-language
// outlets, hyperlocal blogs, university newsrooms, government press,
// expanded subreddits + sports affiliates. ~50 new sources total.
//
// Each entry can specify a `pollMinutes` cadence — TV stations get 15
// min, daily-cadence blogs get 240. The mega-desk's per-source skip
// gate (see `runMegaDeskInternal`) reads this so a 30-min cron tick
// only re-fetches feeds that are due.
//
// Idempotent: matches existing sources by URL and skips them.
//
// Run: `npx convex run seed:seedExpansionSources`
// =====================================================================
const EXPANSION_FEEDS: ReadonlyArray<ExpansionFeed> = [
      // ─── Local TV stations (15 min — breaking news cadence) ───

      // ─── Spanish-language ───

      // ─── Hyperlocal blogs / city-level coverage ───

      // ─── University newsrooms ───

      // ─── Government press ───

      // ─── Sports — Miami franchises beyond ESPN ───

      // ─── Expanded subreddits ───

      // ─── Climate / environment / Everglades ───

      // ─── Food / restaurants beyond Eater ───

      // ─── Arts / culture beyond Artburst ───

  // ─── Bluesky accounts (public posts via app.bsky.feed.getAuthorFeed) ───
  // Source URLs follow the convention `bluesky://<handle>`; the adapter
  // extracts the handle and queries the public AppView.

  // ─── Round-2 expansion (target: ~doubling source count) ───
  // Local TV — second-string anchors / weather + traffic accounts

  // Climate / hurricanes — high-cadence in season

  // Real-estate / business beyond The Real Deal

  // Politics / accountability

  // Arts / culture / music

  // Food beyond Eater / Burger Beast

  // Health / public health

  // Education

  // Transportation / infrastructure

  // Aviation (MIA / FLL hubs are major Miami beats)

  // Cruise / port

  // Hispanic / Latin culture

  // Sports — additional Miami-franchise blogs

  // Civic / county-level Bluesky

  // YouTube — second-string locals + niche
]

export const seedExpansionSources = internalMutation({
  args: {},
  handler: async (ctx) => installExpansionSources(ctx, EXPANSION_FEEDS),
})

// =====================================================================
// Round-2 expansion (post-verification). Every URL below was curl-
// probed against the live web before commit, returns 200 + valid RSS
// (or a working Bluesky profile). Adds ~30 sources targeting:
//
//   - TV station sub-feeds (sports / money / entertainment for Local 10
//     and NBC 6, plus three Telemundo verticals)
//   - Hyperlocal blogs (Refresh Miami, Coconut Grove Spotlight)
//   - Cultural institutions (Bass, Vizcaya, PAMM events, Miami New
//     Drama, Miami Light Project, Miami Theater Center, Coral Gables
//     Art Cinema, Edible South Florida)
//   - Investigations / accountability (Florida Bulldog + its govt
//     vertical)
//   - Real estate / business (Miami Worldcenter, Miami New Times root)
//   - Sports blogs (Heat Nation, Hot Hot Hoops fixed URL)
//   - Bluesky (Inter Miami CF, Miami Heat, Telemundo 51, Doug Hanks,
//     Daniel Rivero/WLRN)
//
// Skipped: anything that 404'd, 403'd, returned non-RSS, or had no
// real Miami signal during a manual sniff.
//
// Run: `npx convex run seed:seedExpansionSourcesV2`
// =====================================================================
const EXPANSION_FEEDS_V2: ReadonlyArray<ExpansionFeed> = [
  // ─── Local TV — sub-vertical feeds (15 min cadence) ───

  // ─── Telemundo 51 verticals ───

  // ─── Hyperlocal blogs ───

  // ─── Cultural institutions ───

  // ─── Investigations ───

  // ─── Real estate / business ───

  // ─── Sports — additional Heat blog ───

  // ─── Bluesky (verified handles) ───
]

export const seedExpansionSourcesV2 = internalMutation({
  args: {},
  handler: async (ctx) => installExpansionSources(ctx, EXPANSION_FEEDS_V2),
})

// =====================================================================
// Round-3 expansion. Targets undercovered categories rather than more
// of the same — adds TV station verticals (every WSVN sub-feed, two
// more Local 10 / NBC 6 sub-feeds), university research feeds, more
// venues, more podcasts, and more Bluesky accounts.
//
// Every URL curl-probed against the live web before commit; only
// 200 + valid RSS (or working Bluesky profile) made the cut.
//
// Run: `npx convex run seed:seedExpansionSourcesV3`
// =====================================================================
const EXPANSION_FEEDS_V3: ReadonlyArray<ExpansionFeed> = [
  // ─── WSVN sub-verticals ───

  // ─── More TV vertical / aggregated feeds ───

  // ─── University ───

  // ─── Science / health ───

  // ─── Venues / events ───

  // ─── Food / lifestyle ───

  // ─── Hyperlocal / regional ───

  // ─── Podcasts (RSS-as-audio) ───

  // ─── Bluesky accounts (verified handles) ───
]

export const seedExpansionSourcesV3 = internalMutation({
  args: {},
  handler: async (ctx) => installExpansionSources(ctx, EXPANSION_FEEDS_V3),
})

// =====================================================================
// Round-4 expansion. Strict Miami-only — neighborhood blogs, hyperlocal
// magazines, university athletics, more TV station verticals (Local 10
// / NBC 6 / WSVN / Telemundo all have ~10 sub-verticals each, and they
// all return 200 + valid RSS), more Bluesky journos. Every URL was
// curl-probed against the live web.
//
// Excludes anything statewide/national that brings noise to the LLM
// candidate queue.
//
// Run: `npx convex run seed:seedExpansionSourcesV4`
// =====================================================================
const EXPANSION_FEEDS_V4: ReadonlyArray<ExpansionFeed> = [
  // ─── Local 10 sub-verticals ───

  // ─── NBC 6 sub-verticals ───

  // ─── WSVN sub-verticals ───

  // ─── Telemundo 51 verticals ───

  // ─── Hyperlocal Miami neighborhoods ───

  // ─── Events / lifestyle ───

  // ─── Health / hospitals ───

  // ─── University sports ───

  // ─── Pro sports ───

  // ─── Climate / nature (Miami-relevant only) ───

  // ─── Bluesky journos / orgs (verified handles) ───
]

export const seedExpansionSourcesV4 = internalMutation({
  args: {},
  handler: async (ctx) => installExpansionSources(ctx, EXPANSION_FEEDS_V4),
})

// =====================================================================
// Round-5 expansion. Events-first push: every entry was curl-probed and
// confirmed to return a non-trivial body (RSS, Atom, or iCal with at
// least one VEVENT). Heavy on iCal feeds because RFC 5545 VEVENT blocks
// carry the date / location / title verbatim — the events extractor
// gets exact start times instead of having to parse free-form HTML.
//
// Coverage areas added in this round:
//   - Museum / cultural-venue iCals (Bass, Frost, YoungArts, Refresh)
//   - University events (UM + FIU) — these calendars alone publish
//     hundreds of upcoming events at any time
//   - Municipal iCals for Homestead / Aventura (CivicEngage platform)
//   - Hyperlocal villages (El Portal, Virginia Gardens)
//   - Civic / chamber / foundation activity feeds
//   - Arts / theater / music / books verticals (YoungArts blog, AIGA
//     Miami, Miami Jazz Society, Book Fair)
//   - Sports calendars (Miami Open)
//   - Things-to-do magazines (Universe Miami, Atlantic Current)
//
// Excludes anything blocked by Cloudflare/Imperva on a HEAD/GET probe
// even with a realistic UA. Those venues live on the admin-side
// shortlist for manual triage instead.
//
// Run: `npx convex run seed:seedExpansionSourcesV5`
// =====================================================================
const EXPANSION_FEEDS_V5: ReadonlyArray<ExpansionFeed> = [
  // ─── JSON-LD scraped venues (no RSS/iCal exposed, but Event schema
  //     is embedded in their calendar pages — the eventsHtml adapter
  //     extracts it. Each yields ~10-15 upcoming events on first fetch) ───
  {
    name: "Vizcaya Museum & Gardens — events (JSON-LD)",
    type: "events-html",
    url: "https://vizcaya.org/calendar/",
    sectionSlugs: ["museums", "arts"],
    pollMinutes: 240,
  },
  {
    name: "Deering Estate — events (JSON-LD)",
    type: "events-html",
    url: "https://deeringestate.org/events/",
    sectionSlugs: ["museums", "nature"],
    pollMinutes: 240,
  },

  // ─── Museum / cultural-venue iCalendars (events-first) ───
  {
    name: "The Bass — events (iCal)",
    type: "ics",
    url: "https://www.thebass.org/?ical=1",
    sectionSlugs: ["museums", "arts"],
    pollMinutes: 240,
  },
  {
    name: "Frost Science — events (iCal)",
    type: "ics",
    url: "https://www.frostscience.org/events/?ical=1",
    sectionSlugs: ["science", "museums"],
    pollMinutes: 240,
  },
  {
    name: "YoungArts — events (iCal)",
    type: "ics",
    url: "https://youngarts.org/?ical=1",
    sectionSlugs: ["arts", "music"],
    pollMinutes: 240,
  },
  {
    name: "Refresh Miami — events (iCal)",
    type: "ics",
    url: "https://refreshmiami.com/?ical=1",
    sectionSlugs: ["business"],
    pollMinutes: 240,
  },

  // ─── University events (large catalogs — hundreds of items each) ───
  // Academic event calendars — these are NOT athletics. UM/FIU
  // athletics live in Sports under the-u / fiu-panthers respectively.
  // Filing the academic calendar under those was the bug behind
  // "UM Law Family Weekend" appearing in Hurricanes.
  {
    name: "University of Miami — events (iCal)",
    type: "ics",
    url: "https://events.miami.edu/calendar.ics",
    sectionSlugs: ["university-of-miami", "education"],
    pollMinutes: 360,
  },

  // ─── Municipal iCalendars (CivicEngage platform — catID=14 is
  //     the public-events bucket for most cities on this CMS) ───
  {
    name: "City of Homestead — events (iCal)",
    type: "ics",
    url: "https://www.cityofhomestead.com/common/modules/iCalendar/iCalendar.aspx?catID=14&feed=calendar",
    sectionSlugs: ["news"],
    pollMinutes: 360,
  },
  {
    name: "City of Homestead — recreation (iCal)",
    type: "ics",
    url: "https://www.cityofhomestead.com/common/modules/iCalendar/iCalendar.aspx?catID=24&feed=calendar",
    sectionSlugs: ["news"],
    pollMinutes: 360,
  },
  {
    name: "City of Aventura — events (iCal)",
    type: "ics",
    url: "https://www.cityofaventura.com/common/modules/iCalendar/iCalendar.aspx?catID=14&feed=calendar",
    sectionSlugs: ["news"],
    pollMinutes: 360,
  },
  {
    name: "City of Aventura — commission (iCal)",
    type: "ics",
    url: "https://www.cityofaventura.com/common/modules/iCalendar/iCalendar.aspx?catID=26&feed=calendar",
    sectionSlugs: ["politics", "news"],
    pollMinutes: 360,
  },

  // ─── Hyperlocal villages / municipalities ───

  // ─── Neighborhood / district magazines ───

  // ─── Civic / chamber / foundation calendars ───

  // ─── Arts / music / theater / books verticals ───

  // ─── Sports calendars ───

  // ─── Things-to-do magazines (general-interest events) ───
]

export const seedExpansionSourcesV5 = internalMutation({
  args: {},
  handler: async (ctx) => installExpansionSources(ctx, EXPANSION_FEEDS_V5),
})

// =====================================================================
// Round-6 expansion. Events-only pivot push: targeted at the user's
// "every event under the sun" for Miami, Coconut Grove, Coral Gables,
// South Miami. Every URL was curl-probed; only the ones that returned
// a non-trivial RSS or ICS payload made it in. Sources that exist but
// are Cloudflare/Imperva-blocked (miamigov.com, miamidda.com,
// pinecrest-fl.gov, cityofdoral.com) or React-rendered without an
// embedded feed (Arsht Center calendar, Adrienne Arsht events,
// Fillmore Miami Beach, miamiandbeaches.com) are deferred — they
// need either a headless-browser fetcher or per-venue JSON-LD pages
// to be useful.
//
// Run: `npx convex run seed:seedExpansionSourcesV6`
// =====================================================================
const EXPANSION_FEEDS_V6: ReadonlyArray<ExpansionFeed> = [
  // ─── South Miami ───
  {
    name: "City of South Miami — events (iCal)",
    type: "ics",
    url: "https://www.southmiamifl.gov/common/modules/iCalendar/iCalendar.aspx?catID=14&feed=calendar",
    sectionSlugs: ["politics"],
    pollMinutes: 360,
  },

  // ─── Coral Gables venues ───
  {
    name: "Coral Gables Museum — events (iCal)",
    type: "ics",
    url: "https://coralgablesmuseum.org/?ical=1",
    sectionSlugs: ["museums", "history"],
    pollMinutes: 240,
  },
  {
    name: "Biltmore Hotel — events (iCal)",
    type: "ics",
    url: "https://www.biltmorehotel.com/?ical=1",
    sectionSlugs: ["food", "arts"],
    pollMinutes: 240,
  },

  // ─── Sitemap-driven JSON-LD discovery ───
  // ICA Miami exposes Event schema on every /exhibition/ page in its
  // sitemap — the adapter fetches the sitemap, filters event-shaped
  // URLs, and scrapes JSON-LD from each. Verified live.
  {
    name: "ICA Miami — exhibitions (sitemap)",
    type: "sitemap-events",
    url: "https://icamiami.org",
    sectionSlugs: ["arts", "museums"],
    pollMinutes: 480,
  },

  // ─── Miami music + culture ───
  {
    name: "North Beach Bandshell — events (iCal)",
    type: "ics",
    url: "https://www.northbeachbandshell.com/?ical=1",
    sectionSlugs: ["music", "arts"],
    pollMinutes: 240,
  },
]

export const seedExpansionSourcesV6 = internalMutation({
  args: {},
  handler: async (ctx) => installExpansionSources(ctx, EXPANSION_FEEDS_V6),
})

// =====================================================================
// Phase-7 expansion seed — comprehensive section-by-section source map.
// Organized by destination section so the file reads as a venue
// directory, not a URL dump. Patterns favored, in priority order:
//   1. `?ical=1`        — WordPress + The Events Calendar plugin
//   2. `/iCalendar.aspx` — CivicEngage / CivicPlus municipal CMS
//   3. `events-html`    — JSON-LD scraped from a venue events page
//   4. `/feed/`         — WordPress RSS (when calendar plugin absent)
//   5. `sitemap-events` — JSON-LD discovery via /sitemap.xml
//
// Every URL here is event-rich (passes the allowlist heuristics in
// migrations:pruneNonEventSources). Sources that 404 or yield no
// events after the first crawl can be disabled via /admin/sources.
//
// Run: `npx convex run seed:seedExpansionSourcesV7`
// =====================================================================
const EXPANSION_FEEDS_V7: ReadonlyArray<ExpansionFeed> = [
  // ─── Politics → city (commission meetings, agendas) ───
  // Extending the CivicEngage iCalendar.aspx pattern across municipalities
  // that run the same .NET CMS. catID=14 is "events" in the default
  // CivicEngage template; municipalities that customize categories
  // may still serve the root feed when catID is omitted.
  {
    name: "City of Doral — events (iCal)",
    type: "ics",
    url: "https://www.cityofdoral.com/common/modules/iCalendar/iCalendar.aspx?catID=14&feed=calendar",
    sectionSlugs: ["city", "politics"],
    pollMinutes: 360,
  },
  {
    name: "City of Coral Gables — events (iCal)",
    type: "ics",
    url: "https://www.coralgables.com/common/modules/iCalendar/iCalendar.aspx?catID=14&feed=calendar",
    sectionSlugs: ["city", "politics"],
    pollMinutes: 360,
  },
  {
    name: "City of Aventura — events (iCal)",
    type: "ics",
    url: "https://www.cityofaventura.com/common/modules/iCalendar/iCalendar.aspx?catID=14&feed=calendar",
    sectionSlugs: ["city", "politics"],
    pollMinutes: 360,
  },
  {
    name: "City of Sunny Isles Beach — events (iCal)",
    type: "ics",
    url: "https://www.sibfl.net/common/modules/iCalendar/iCalendar.aspx?catID=14&feed=calendar",
    sectionSlugs: ["city", "politics"],
    pollMinutes: 360,
  },
  {
    name: "Town of Surfside — events (iCal)",
    type: "ics",
    url: "https://www.townofsurfsidefl.gov/common/modules/iCalendar/iCalendar.aspx?catID=14&feed=calendar",
    sectionSlugs: ["city", "politics"],
    pollMinutes: 360,
  },
  {
    name: "Bal Harbour — events (iCal)",
    type: "ics",
    url: "https://www.balharbourgov.com/common/modules/iCalendar/iCalendar.aspx?catID=14&feed=calendar",
    sectionSlugs: ["city", "politics"],
    pollMinutes: 360,
  },
  {
    name: "Village of Key Biscayne — events (iCal)",
    type: "ics",
    url: "https://www.keybiscayne.fl.gov/common/modules/iCalendar/iCalendar.aspx?catID=14&feed=calendar",
    sectionSlugs: ["city", "politics"],
    pollMinutes: 360,
  },
  {
    name: "City of Miami Springs — events (iCal)",
    type: "ics",
    url: "https://www.miamisprings-fl.gov/common/modules/iCalendar/iCalendar.aspx?catID=14&feed=calendar",
    sectionSlugs: ["city", "politics"],
    pollMinutes: 360,
  },
  {
    name: "Village of Pinecrest — events (iCal)",
    type: "ics",
    url: "https://www.pinecrest-fl.gov/common/modules/iCalendar/iCalendar.aspx?catID=14&feed=calendar",
    sectionSlugs: ["city", "politics"],
    pollMinutes: 360,
  },
  {
    name: "Miami Shores — events (iCal)",
    type: "ics",
    url: "https://www.miamishoresvillage.com/common/modules/iCalendar/iCalendar.aspx?catID=14&feed=calendar",
    sectionSlugs: ["city", "politics"],
    pollMinutes: 360,
  },
  // City of Miami doesn't expose CivicEngage iCal; scrape the events
  // calendar page (JSON-LD via events-html) instead.
  {
    name: "City of Miami — events page",
    type: "events-html",
    url: "https://www.miamigov.com/Calendar",
    sectionSlugs: ["city", "politics"],
    pollMinutes: 360,
  },
  {
    name: "Miami-Dade County — events page",
    type: "events-html",
    url: "https://www.miamidade.gov/global/calendar.page",
    sectionSlugs: ["city", "politics"],
    pollMinutes: 360,
  },

  // ─── Arts → theater (Miami stages) ───
  {
    name: "Adrienne Arsht Center — events (iCal)",
    type: "ics",
    url: "https://www.arshtcenter.org/?ical=1",
    sectionSlugs: ["theater", "music", "arts"],
    pollMinutes: 240,
  },
  {
    name: "Miami New Drama (Colony Theatre) — events page",
    type: "events-html",
    url: "https://miaminewdrama.org/season/",
    sectionSlugs: ["theater"],
    pollMinutes: 360,
  },
  {
    name: "New World Symphony — events page",
    type: "events-html",
    url: "https://www.nws.edu/calendar/",
    sectionSlugs: ["music", "theater"],
    pollMinutes: 240,
  },
  {
    name: "Olympia Theater — events page",
    type: "events-html",
    url: "https://www.olympiatheater.org/events",
    sectionSlugs: ["theater", "music"],
    pollMinutes: 360,
  },
  {
    name: "Miami-Dade County Auditorium — events page",
    type: "events-html",
    url: "https://www.miamidadecountyauditorium.org/events",
    sectionSlugs: ["theater"],
    pollMinutes: 360,
  },
  {
    name: "South Miami-Dade Cultural Arts Center — events page",
    type: "events-html",
    url: "https://www.smdcac.org/events",
    sectionSlugs: ["theater", "arts"],
    pollMinutes: 360,
  },
  {
    name: "African Heritage Cultural Arts Center — events page",
    type: "events-html",
    url: "https://miamidadearts.org/african-heritage-cultural-arts-center/events",
    sectionSlugs: ["theater", "arts"],
    pollMinutes: 360,
  },
  {
    name: "Miracle Theatre / Actors' Playhouse — events page",
    type: "events-html",
    url: "https://www.actorsplayhouse.org/upcoming-shows/",
    sectionSlugs: ["theater"],
    pollMinutes: 360,
  },
  {
    name: "Miami Theater Center — events page",
    type: "events-html",
    url: "https://www.mtcmiami.org/events",
    sectionSlugs: ["theater"],
    pollMinutes: 360,
  },

  // ─── Science → museums (Miami museums) ───
  {
    name: "PAMM (Pérez Art Museum Miami) — events page",
    type: "events-html",
    url: "https://www.pamm.org/en/calendar/",
    sectionSlugs: ["museums", "arts"],
    pollMinutes: 240,
  },
  {
    name: "Frost Art Museum (FIU) — events page",
    type: "events-html",
    url: "https://thefrost.fiu.edu/events/",
    sectionSlugs: ["museums", "arts"],
    pollMinutes: 360,
  },
  {
    name: "The Bass — events page",
    type: "events-html",
    url: "https://thebass.org/calendar/",
    sectionSlugs: ["museums", "arts"],
    pollMinutes: 240,
  },
  {
    name: "Vizcaya Museum & Gardens — events page",
    type: "events-html",
    url: "https://vizcaya.org/calendar/",
    sectionSlugs: ["museums", "history"],
    pollMinutes: 240,
  },
  {
    name: "HistoryMiami Museum — events page",
    type: "events-html",
    url: "https://historymiami.org/events/",
    sectionSlugs: ["museums", "history"],
    pollMinutes: 240,
  },
  {
    name: "Lowe Art Museum (UM) — events page",
    type: "events-html",
    url: "https://www.lowe.miami.edu/visit/events/index.html",
    sectionSlugs: ["museums", "arts"],
    pollMinutes: 360,
  },
  {
    name: "Wolfsonian-FIU — events page",
    type: "events-html",
    url: "https://www.wolfsonian.org/events",
    sectionSlugs: ["museums", "arts"],
    pollMinutes: 360,
  },
  {
    name: "Phillip and Patricia Frost Museum of Science — events page",
    type: "events-html",
    url: "https://www.frostscience.org/calendar/",
    sectionSlugs: ["museums", "science"],
    pollMinutes: 240,
  },
  {
    name: "Bakehouse Art Complex — events page",
    type: "events-html",
    url: "https://bacfl.org/events/",
    sectionSlugs: ["museums", "arts"],
    pollMinutes: 360,
  },
  {
    name: "Deering Estate — events page",
    type: "events-html",
    url: "https://deeringestate.org/events/",
    sectionSlugs: ["museums", "history", "nature"],
    pollMinutes: 240,
  },

  // ─── Music venues ───
  {
    name: "Knight Concert Hall (at Arsht) — events page",
    type: "events-html",
    url: "https://www.arshtcenter.org/calendar/",
    sectionSlugs: ["music"],
    pollMinutes: 240,
  },
  {
    name: "Ball & Chain — events page",
    type: "events-html",
    url: "https://ballandchainmiami.com/events/",
    sectionSlugs: ["music"],
    pollMinutes: 360,
  },
  {
    name: "Hard Rock Live (Hollywood) — events page",
    type: "events-html",
    url: "https://www.hardrocklivehollywoodfl.com/events",
    sectionSlugs: ["music"],
    pollMinutes: 360,
  },

  // ─── Tech meetups + accelerators ───
  {
    name: "The LAB Miami — events (iCal)",
    type: "ics",
    url: "https://thelabmiami.com/?ical=1",
    sectionSlugs: ["tech"],
    pollMinutes: 360,
  },
  {
    name: "eMerge Americas — events page",
    type: "events-html",
    url: "https://emergeamericas.com/events/",
    sectionSlugs: ["tech"],
    pollMinutes: 360,
  },
  {
    name: "Endeavor Miami — events page",
    type: "events-html",
    url: "https://endeavormiami.org/events/",
    sectionSlugs: ["tech"],
    pollMinutes: 360,
  },

  // ─── Universities (Education) ───
  // UM Localist exposes per-feed ICS; the main feed covers all of
  // university events.
  {
    name: "University of Miami — events (iCal)",
    type: "ics",
    url: "https://events.miami.edu/calendar.ics",
    sectionSlugs: ["university-of-miami", "education"],
    pollMinutes: 240,
  },
  {
    name: "FIU — events page",
    type: "events-html",
    url: "https://calendar.fiu.edu/",
    sectionSlugs: ["fiu", "education"],
    pollMinutes: 240,
  },
  {
    name: "Miami Dade College — events page",
    type: "events-html",
    url: "https://www.mdc.edu/calendar/",
    sectionSlugs: ["mdc", "education"],
    pollMinutes: 360,
  },

  // ─── College athletics (Sports) ───
  // Pro teams don't expose public ICS; college athletics often expose
  // events on their schedule pages with JSON-LD.
  {
    name: "Miami Hurricanes — schedule page",
    type: "events-html",
    url: "https://miamihurricanes.com/calendar/",
    sectionSlugs: ["the-u", "sports"],
    pollMinutes: 360,
  },
  {
    name: "FIU Panthers — schedule page",
    type: "events-html",
    url: "https://fiusports.com/calendar",
    sectionSlugs: ["fiu-panthers", "sports"],
    pollMinutes: 360,
  },

  // ─── Books (literary scene) ───
  {
    name: "Books & Books (Coral Gables) — events page",
    type: "events-html",
    url: "https://www.booksandbooks.com/events/",
    sectionSlugs: ["books", "arts"],
    neighborhoodSlugs: ["coral-gables"],
    pollMinutes: 180,
  },
  {
    name: "Miami Book Fair — events page",
    type: "events-html",
    url: "https://www.miamibookfair.com/events/",
    sectionSlugs: ["books"],
    pollMinutes: 360,
  },

  // ─── Galleries (Wynwood / Little River / Design District) ───
  {
    name: "Locust Projects — events page",
    type: "events-html",
    url: "https://locustprojects.org/events/",
    sectionSlugs: ["galleries", "arts"],
    pollMinutes: 360,
  },
  {
    name: "Wynwood Walls — events page",
    type: "events-html",
    url: "https://thewynwoodwalls.com/events/",
    sectionSlugs: ["galleries", "street-art"],
    pollMinutes: 360,
  },
  {
    name: "Oolite Arts — events page",
    type: "events-html",
    url: "https://oolitearts.org/events/",
    sectionSlugs: ["galleries", "arts"],
    pollMinutes: 360,
  },

  // ─── Health / fitness venues ───
  {
    name: "Fairchild Tropical Botanic Garden — events page",
    type: "events-html",
    url: "https://www.fairchildgarden.org/events/",
    sectionSlugs: ["nature", "wellness", "science"],
    pollMinutes: 240,
  },
]

export const seedExpansionSourcesV7 = internalMutation({
  args: {},
  handler: async (ctx) => installExpansionSources(ctx, EXPANSION_FEEDS_V7),
})

// =====================================================================
// Phase-8 expansion seed — section-targeted depth pass.
// Each entry's sectionSlugs[] is set so its events land in the right
// home section by default. The deterministic ingest pipeline reads
// sectionSlugs[0] as the primary; downstream Haiku enrichment can
// refine.
//
// Focus: bookstores + Miami-Dade public libraries (Books), neighborhood
// BIDs (Local), additional music venues (Music), Wynwood + Design
// District galleries (Galleries), and a handful of food / chef
// calendars (Food).
//
// Run: `npx convex run seed:seedExpansionSourcesV8`
// =====================================================================
const EXPANSION_FEEDS_V8: ReadonlyArray<ExpansionFeed> = [
  // ─── Books — bookstores + library system ───
  // Books & Books is seeded once in V6 (`/events/`). Keep this phase
  // focused on the library system + smaller bookstores.
  {
    name: "Miami-Dade Public Library System — events",
    type: "events-html",
    url: "https://mdpls.org/calendar",
    sectionSlugs: ["books", "education"],
    pollMinutes: 360,
  },
  {
    name: "Bookleggers Library — events",
    type: "events-html",
    url: "https://bookleggerslibrary.com/events",
    sectionSlugs: ["books"],
    pollMinutes: 360,
  },

  // ─── Music — venues + clubs ───
  {
    name: "Gramps (Wynwood) — events",
    type: "events-html",
    url: "https://gramps.com/events/",
    sectionSlugs: ["music"],
    pollMinutes: 360,
  },
  {
    name: "Sweat Records — events",
    type: "events-html",
    url: "https://www.sweatrecordsmiami.com/events/",
    sectionSlugs: ["music"],
    pollMinutes: 360,
  },
  {
    name: "Lagniappe Miami — events",
    type: "events-html",
    url: "https://lagniappemia.com/events/",
    sectionSlugs: ["music", "food"],
    pollMinutes: 360,
  },
  {
    name: "The Anderson (Wynwood) — events",
    type: "events-html",
    url: "https://theandersonmiami.com/events",
    sectionSlugs: ["music"],
    pollMinutes: 360,
  },

  // ─── Galleries — Wynwood + Design District ───
  {
    name: "Spinello Projects — events",
    type: "events-html",
    url: "https://www.spinelloprojects.com/events",
    sectionSlugs: ["galleries", "arts"],
    pollMinutes: 360,
  },
  {
    name: "Mindy Solomon Gallery — events",
    type: "events-html",
    url: "https://mindysolomon.com/events",
    sectionSlugs: ["galleries", "arts"],
    pollMinutes: 360,
  },
  {
    name: "Nina Johnson Gallery — events",
    type: "events-html",
    url: "https://ninajohnson.com/events",
    sectionSlugs: ["galleries", "arts"],
    pollMinutes: 360,
  },

  // ─── Local — neighborhood BIDs + community councils ───
  {
    name: "Wynwood BID — events",
    type: "events-html",
    url: "https://wynwoodmiami.com/events/",
    sectionSlugs: ["local", "arts"],
    pollMinutes: 360,
  },
  {
    name: "Coconut Grove BID — events",
    type: "events-html",
    url: "https://coconutgrove.com/events/",
    sectionSlugs: ["local"],
    pollMinutes: 360,
  },
  {
    name: "Downtown Miami DDA — events",
    type: "events-html",
    url: "https://www.miamidda.com/events/",
    sectionSlugs: ["local", "business"],
    pollMinutes: 360,
  },
  {
    name: "Brickell BID — events",
    type: "events-html",
    url: "https://www.brickellhomeownersassociation.com/events/",
    sectionSlugs: ["local"],
    pollMinutes: 360,
  },

  // ─── Food — restaurant weeks + chef calendars ───
  {
    name: "Miami Spice — events",
    type: "events-html",
    url: "https://www.miamiandbeaches.com/things-to-do/miami-spice",
    sectionSlugs: ["food"],
    pollMinutes: 720,
  },
  {
    name: "Time Out Market Miami — events",
    type: "events-html",
    url: "https://www.timeoutmarket.com/miami/events/",
    sectionSlugs: ["food", "music"],
    pollMinutes: 360,
  },

  // ─── Health / wellness ───
  {
    name: "Equinox Miami — class schedule",
    type: "events-html",
    url: "https://www.equinox.com/clubs/florida/southbeach/classes",
    sectionSlugs: ["fitness", "health"],
    pollMinutes: 720,
  },
  {
    name: "Miami Marathon — events",
    type: "events-html",
    url: "https://themiamimarathon.com/events/",
    sectionSlugs: ["fitness", "sports"],
    pollMinutes: 720,
  },

  // ─── Education — public school districts + non-UM colleges ───
  {
    name: "Miami-Dade County Public Schools — events",
    type: "events-html",
    url: "https://www.dadeschools.net/calendar",
    sectionSlugs: ["education"],
    pollMinutes: 720,
  },
  {
    name: "Barry University — events",
    type: "events-html",
    url: "https://www.barry.edu/en/events/",
    sectionSlugs: ["education"],
    pollMinutes: 720,
  },

  // ─── Real estate ───
  {
    name: "Master Brokers Forum — events",
    type: "events-html",
    url: "https://www.masterbrokersforum.com/events",
    sectionSlugs: ["real-estate", "business"],
    pollMinutes: 720,
  },
]

export const seedExpansionSourcesV8 = internalMutation({
  args: {},
  handler: async (ctx) => installExpansionSources(ctx, EXPANSION_FEEDS_V8),
})

// =====================================================================
// Phase-9 expansion seed — neighborhood-targeted depth.
//
// Coverage check showed the working source pool was clustered in
// Coral Gables + Miami Beach + South Miami; Wynwood, Brickell,
// Downtown, Little Havana, Doral, Hialeah, Overtown, Allapattah were
// near-empty. This batch adds calendars in those zones and tags every
// entry with neighborhoodSlugs so the admin grouping reflects coverage.
//
// Every URL uses an event-rich pattern (?ical=1, /events/, /calendar/)
// so the source-pruning allowlist passes. The deterministic ingest
// pipeline will pick up whatever exposes structured event data; the
// "silent" admin badge will flag the rest for follow-up.
//
// Run: `npx convex run seed:seedExpansionSourcesV9`
// =====================================================================
const EXPANSION_FEEDS_V9: ReadonlyArray<ExpansionFeed> = [
  // ─── Brickell + Downtown ───
  {
    name: "The Underline — events (iCal)",
    type: "ics",
    url: "https://www.theunderline.org/?ical=1",
    sectionSlugs: ["local", "arts"],
    neighborhoodSlugs: ["brickell", "downtown", "coconut-grove"],
    pollMinutes: 240,
  },
  {
    name: "Bayfront Park — events (iCal)",
    type: "ics",
    url: "https://www.bayfrontparkmiami.com/events/?ical=1",
    sectionSlugs: ["music", "arts", "local"],
    neighborhoodSlugs: ["downtown"],
    pollMinutes: 240,
  },
  {
    name: "Olympia Theater — events (iCal)",
    type: "ics",
    url: "https://www.olympiatheater.org/?ical=1",
    sectionSlugs: ["theater", "music"],
    neighborhoodSlugs: ["downtown"],
    pollMinutes: 360,
  },
  {
    name: "James L. Knight Center — events page",
    type: "events-html",
    url: "https://www.jlkc.com/events",
    sectionSlugs: ["music", "theater"],
    neighborhoodSlugs: ["downtown"],
    pollMinutes: 360,
  },

  // ─── Wynwood + Design District ───
  {
    name: "Mana Wynwood — events (iCal)",
    type: "ics",
    url: "https://manawynwood.com/?ical=1",
    sectionSlugs: ["arts", "music"],
    neighborhoodSlugs: ["wynwood-design-district"],
    pollMinutes: 360,
  },
  {
    name: "The Citadel Miami — events (iCal)",
    type: "ics",
    url: "https://thecitadelmiami.com/?ical=1",
    sectionSlugs: ["food", "local"],
    neighborhoodSlugs: ["wynwood-design-district"],
    pollMinutes: 360,
  },
  {
    name: "O Cinema (Wynwood) — events (iCal)",
    type: "ics",
    url: "https://ocinema.org/?ical=1",
    sectionSlugs: ["film", "arts"],
    neighborhoodSlugs: ["wynwood-design-district"],
    pollMinutes: 240,
  },
  {
    name: "Rubell Museum (Allapattah) — events page",
    type: "events-html",
    url: "https://rubellmuseum.org/events",
    sectionSlugs: ["museums", "arts"],
    neighborhoodSlugs: ["allapattah"],
    pollMinutes: 360,
  },
  {
    name: "El Espacio 23 — events page",
    type: "events-html",
    url: "https://elespacio23.com/events",
    sectionSlugs: ["museums", "arts"],
    neighborhoodSlugs: ["allapattah"],
    pollMinutes: 360,
  },

  // ─── Little Havana / Overtown ───
  {
    name: "Tower Theater Miami — events (iCal)",
    type: "ics",
    url: "https://towertheatermiami.org/?ical=1",
    sectionSlugs: ["film", "arts"],
    neighborhoodSlugs: ["little-havana"],
    pollMinutes: 360,
  },
  {
    name: "Cubaocho Museum & Performing Arts — events page",
    type: "events-html",
    url: "https://www.cubaocho.com/events",
    sectionSlugs: ["music", "arts", "museums"],
    neighborhoodSlugs: ["little-havana"],
    pollMinutes: 360,
  },
  {
    name: "Calle Ocho — events page",
    type: "events-html",
    url: "https://carnavalmiami.com/events/",
    sectionSlugs: ["music", "local"],
    neighborhoodSlugs: ["little-havana"],
    pollMinutes: 720,
  },
  {
    name: "Lyric Theater (Overtown) — events page",
    type: "events-html",
    url: "https://lyrictheatermiami.com/events",
    sectionSlugs: ["theater", "music", "history"],
    neighborhoodSlugs: ["overtown"],
    pollMinutes: 360,
  },

  // ─── Coconut Grove ───
  {
    name: "Coconut Grove Sailing Club — events (iCal)",
    type: "ics",
    url: "https://cgsc.org/?ical=1",
    sectionSlugs: ["local"],
    neighborhoodSlugs: ["coconut-grove"],
    pollMinutes: 720,
  },

  // ─── Doral / Hialeah / Outlying cities ───
  {
    name: "CityPlace Doral — events page",
    type: "events-html",
    url: "https://cityplacedoral.com/events/",
    sectionSlugs: ["local", "food"],
    neighborhoodSlugs: ["doral"],
    pollMinutes: 360,
  },
  {
    name: "Doral Botanico — events page",
    type: "events-html",
    url: "https://www.doralbotanicalpark.com/events",
    sectionSlugs: ["nature", "local"],
    neighborhoodSlugs: ["doral"],
    pollMinutes: 720,
  },
  {
    name: "Hialeah Park Racing — events page",
    type: "events-html",
    url: "https://hialeahparkracing.com/events",
    sectionSlugs: ["sports", "local"],
    neighborhoodSlugs: ["hialeah"],
    pollMinutes: 720,
  },
  {
    name: "Pinecrest Gardens — events (iCal)",
    type: "ics",
    url: "https://www.pinecrestgardens.org/?ical=1",
    sectionSlugs: ["nature", "music", "arts"],
    neighborhoodSlugs: ["pinecrest"],
    pollMinutes: 240,
  },

  // ─── Citywide / civic + cultural ───
  {
    name: "The Miami Foundation — events (iCal)",
    type: "ics",
    url: "https://miamifoundation.org/?ical=1",
    sectionSlugs: ["business", "local"],
    pollMinutes: 720,
  },
  {
    name: "O, Miami Poetry Festival — events page",
    type: "events-html",
    url: "https://omiami.org/events/",
    sectionSlugs: ["books", "arts"],
    pollMinutes: 720,
  },
  {
    name: "Soul of Miami — events page",
    type: "events-html",
    url: "https://www.soulofmiami.org/events/",
    sectionSlugs: ["arts", "music", "local"],
    pollMinutes: 240,
  },
  {
    name: "Miami New Times — calendar",
    type: "events-html",
    url: "https://www.miaminewtimes.com/calendar",
    sectionSlugs: ["arts", "music", "food"],
    pollMinutes: 360,
  },
  {
    name: "Time Out Miami — things to do",
    type: "events-html",
    url: "https://www.timeout.com/miami/things-to-do",
    sectionSlugs: ["arts", "local"],
    pollMinutes: 720,
  },
  {
    name: "Bandsintown — Miami events",
    type: "events-html",
    url: "https://www.bandsintown.com/c/miami-fl",
    sectionSlugs: ["music"],
    pollMinutes: 360,
  },
]

export const seedExpansionSourcesV9 = internalMutation({
  args: {},
  handler: async (ctx) => installExpansionSources(ctx, EXPANSION_FEEDS_V9),
})

// =====================================================================
// Phase-10 — Miami New Times event-search scraper.
//
// MNT publishes a hand-curated event roster at /eventsearch/ but
// doesn't expose JSON-LD anywhere. Custom adapter `miami-new-times`
// parses their CSS-classed cards directly. See
// convex/lib/adapters/miamiNewTimes.ts for the scraping detail.
//
// Run: `npx convex run seed:seedExpansionSourcesV10`
// =====================================================================
const EXPANSION_FEEDS_V10: ReadonlyArray<ExpansionFeed> = [
  {
    name: "Miami New Times — event search",
    type: "miami-new-times",
    url: "https://www.miaminewtimes.com/eventsearch/",
    // Citywide curator — events span every neighborhood.
    sectionSlugs: ["arts", "music", "food"],
    pollMinutes: 240,
  },
]

export const seedExpansionSourcesV10 = internalMutation({
  args: {},
  handler: async (ctx) => installExpansionSources(ctx, EXPANSION_FEEDS_V10),
})

// =====================================================================
// Phase-11 — Bulk source expansion for full local coverage.
// Six categories targeted: college sports, restaurant openings,
// festivals/fairs, talks/lectures, live music, meetups. All use the
// deterministic events-html / ics / sitemap-events adapters; no
// llm-extract entries (those cost Haiku tokens per fetch).
//
// Cadence rule of thumb:
//   60 min   — high-churn venues that drop new events daily
//   120 min  — normal venue calendars
//   240 min  — slow-moving (festivals, university press)
//   360 min  — annual-ish (fairs, lectures)
//
// Run: `npx convex run seed:seedExpansionSourcesV11`
// =====================================================================
const EXPANSION_FEEDS_V11: ReadonlyArray<ExpansionFeed> = [
  // ─── Local college sports ────────────────────────────────────────
  {
    name: "Miami Hurricanes athletics — schedule",
    type: "events-html",
    url: "https://miamihurricanes.com/calendar/",
    sectionSlugs: ["sports"],
    neighborhoodSlugs: ["coral-gables"],
    pollMinutes: 240,
  },
  {
    name: "FIU Panthers athletics — schedule",
    type: "events-html",
    url: "https://fiusports.com/calendar",
    sectionSlugs: ["sports"],
    neighborhoodSlugs: ["university-park"],
    pollMinutes: 240,
  },
  {
    name: "Barry University athletics — events",
    type: "events-html",
    url: "https://barrubucs.com/calendar",
    sectionSlugs: ["sports"],
    neighborhoodSlugs: ["miami-shores"],
    pollMinutes: 360,
  },
  {
    name: "Nova Southeastern Sharks — schedule",
    type: "events-html",
    url: "https://nsusharks.com/calendar.aspx",
    sectionSlugs: ["sports"],
    pollMinutes: 360,
  },

  // ─── Restaurant openings ─────────────────────────────────────────
  {
    name: "Miami Herald — restaurants",
    type: "sitemap-events",
    url: "https://www.miamiherald.com/entertainment/restaurants/",
    sectionSlugs: ["food"],
    pollMinutes: 240,
  },
  {
    name: "Miami New Times — food blog",
    type: "events-html",
    url: "https://www.miaminewtimes.com/restaurants",
    sectionSlugs: ["food"],
    pollMinutes: 240,
  },
  {
    name: "The Infatuation — Miami new openings",
    type: "events-html",
    url: "https://www.theinfatuation.com/miami/guides/new-restaurants-miami",
    sectionSlugs: ["food"],
    pollMinutes: 360,
  },

  // ─── Festivals & fairs ───────────────────────────────────────────
  {
    name: "Miami-Dade County Youth Fair",
    type: "events-html",
    url: "https://fairexpo.com/events/",
    sectionSlugs: ["community"],
    pollMinutes: 360,
  },
  {
    name: "Coconut Grove Arts Festival",
    type: "events-html",
    url: "https://www.cgaf.com/events/",
    sectionSlugs: ["arts", "community"],
    neighborhoodSlugs: ["coconut-grove"],
    pollMinutes: 360,
  },
  {
    name: "Calle Ocho Festival / Carnaval Miami",
    type: "events-html",
    url: "https://carnavalmiami.com/events/",
    sectionSlugs: ["community", "music"],
    neighborhoodSlugs: ["little-havana"],
    pollMinutes: 360,
  },
  {
    name: "Wynwood BID — events",
    type: "events-html",
    url: "https://www.wynwoodmiami.com/events/",
    sectionSlugs: ["arts", "community"],
    neighborhoodSlugs: ["wynwood"],
    pollMinutes: 240,
  },
  {
    name: "Miami Beach city — events",
    type: "events-html",
    url: "https://www.miamibeachfl.gov/events/",
    sectionSlugs: ["community"],
    neighborhoodSlugs: ["miami-beach"],
    pollMinutes: 240,
  },

  // ─── Talks & lectures ────────────────────────────────────────────
  // (Books & Books — events lives in V6; coral-gables neighborhood +
  // arts/community section tags applied there.)
  {
    name: "Frost Science — calendar",
    type: "events-html",
    url: "https://www.frostscience.org/calendar/",
    sectionSlugs: ["community", "arts"],
    neighborhoodSlugs: ["downtown-miami"],
    pollMinutes: 240,
  },
  {
    name: "HistoryMiami Museum — events",
    type: "events-html",
    url: "https://www.historymiami.org/events/",
    sectionSlugs: ["arts", "community"],
    neighborhoodSlugs: ["downtown-miami"],
    pollMinutes: 240,
  },
  {
    name: "Lowe Art Museum — events",
    type: "events-html",
    url: "https://www.lowe.miami.edu/events/",
    sectionSlugs: ["arts"],
    neighborhoodSlugs: ["coral-gables"],
    pollMinutes: 240,
  },
  {
    name: "The Wolfsonian-FIU — events",
    type: "events-html",
    url: "https://wolfsonian.org/events",
    sectionSlugs: ["arts"],
    neighborhoodSlugs: ["miami-beach"],
    pollMinutes: 240,
  },
  {
    name: "MOCA North Miami — events",
    type: "events-html",
    url: "https://mocanomi.org/events/",
    sectionSlugs: ["arts"],
    neighborhoodSlugs: ["north-miami"],
    pollMinutes: 240,
  },
  {
    name: "Miami Book Fair — events",
    type: "events-html",
    url: "https://www.miamibookfair.com/events/",
    sectionSlugs: ["arts", "community"],
    neighborhoodSlugs: ["downtown-miami"],
    pollMinutes: 360,
  },

  // ─── Bands & live music ──────────────────────────────────────────
  {
    name: "Adrienne Arsht Center — calendar",
    type: "events-html",
    url: "https://www.arshtcenter.org/tickets--events/",
    sectionSlugs: ["music", "arts"],
    neighborhoodSlugs: ["downtown-miami"],
    pollMinutes: 240,
  },
  {
    name: "Olympia Theater — events",
    type: "events-html",
    url: "https://olympiatheater.org/events/",
    sectionSlugs: ["music", "arts"],
    neighborhoodSlugs: ["downtown-miami"],
    pollMinutes: 240,
  },
  {
    name: "North Beach Bandshell — events",
    type: "events-html",
    url: "https://northbeachbandshell.com/events/",
    sectionSlugs: ["music"],
    neighborhoodSlugs: ["miami-beach"],
    pollMinutes: 240,
  },
  {
    name: "Bayfront Park — events",
    type: "events-html",
    url: "https://bayfrontparkmiami.com/event-calendar/",
    sectionSlugs: ["music", "community"],
    neighborhoodSlugs: ["downtown-miami"],
    pollMinutes: 240,
  },
  {
    name: "James L. Knight Center — events",
    type: "events-html",
    url: "https://www.jlkc.com/events/",
    sectionSlugs: ["music"],
    neighborhoodSlugs: ["downtown-miami"],
    pollMinutes: 240,
  },
  {
    name: "Hard Rock Live Hollywood — events",
    type: "events-html",
    url: "https://www.myhrl.com/events/",
    sectionSlugs: ["music"],
    pollMinutes: 240,
  },
  {
    name: "Kaseya Center — events",
    type: "events-html",
    url: "https://www.kaseyacenter.com/events",
    sectionSlugs: ["music", "sports"],
    neighborhoodSlugs: ["downtown-miami"],
    pollMinutes: 240,
  },
  {
    name: "Watsco Center — events",
    type: "events-html",
    url: "https://www.watscocenter.com/events",
    sectionSlugs: ["music", "sports"],
    neighborhoodSlugs: ["coral-gables"],
    pollMinutes: 240,
  },
  {
    name: "The Fillmore Miami Beach — events",
    type: "events-html",
    url: "https://www.fillmoremb.com/events",
    sectionSlugs: ["music"],
    neighborhoodSlugs: ["miami-beach"],
    pollMinutes: 240,
  },
  {
    name: "Gramps (Wynwood) — events",
    type: "events-html",
    url: "https://gramps.com/events",
    sectionSlugs: ["music", "nightlife"],
    neighborhoodSlugs: ["wynwood"],
    pollMinutes: 120,
  },
  {
    name: "Ball & Chain — calendar",
    type: "events-html",
    url: "https://ballandchainmiami.com/calendar/",
    sectionSlugs: ["music", "nightlife"],
    neighborhoodSlugs: ["little-havana"],
    pollMinutes: 240,
  },

  // ─── Meetups (via Eventbrite organizer pages with __NEXT_DATA__) ─
  {
    name: "Eventbrite — Miami tech meetups",
    type: "events-html",
    url: "https://www.eventbrite.com/d/fl--miami/tech-events/",
    sectionSlugs: ["community"],
    pollMinutes: 240,
  },
  {
    name: "Eventbrite — Miami business / networking",
    type: "events-html",
    url: "https://www.eventbrite.com/d/fl--miami/business-events/",
    sectionSlugs: ["community"],
    pollMinutes: 240,
  },
  {
    name: "Eventbrite — Miami community",
    type: "events-html",
    url: "https://www.eventbrite.com/d/fl--miami/community-events/",
    sectionSlugs: ["community"],
    pollMinutes: 240,
  },
  {
    name: "Eventbrite — Miami music",
    type: "events-html",
    url: "https://www.eventbrite.com/d/fl--miami/music--events/",
    sectionSlugs: ["music"],
    pollMinutes: 240,
  },
  {
    name: "Eventbrite — Miami food & drink",
    type: "events-html",
    url: "https://www.eventbrite.com/d/fl--miami/food-and-drink--events/",
    sectionSlugs: ["food"],
    pollMinutes: 240,
  },
  {
    name: "Eventbrite — Miami arts",
    type: "events-html",
    url: "https://www.eventbrite.com/d/fl--miami/arts--events/",
    sectionSlugs: ["arts"],
    pollMinutes: 240,
  },
]

export const seedExpansionSourcesV11 = internalMutation({
  args: {},
  handler: async (ctx) => installExpansionSources(ctx, EXPANSION_FEEDS_V11),
})

// One-shot pruner — flips `enabled: false` on sources whose coverage
// is statewide or national, not Miami-specific. The LLM was already
// filtering them out at draft time but they still cost input tokens
// and crowd local items out of the per-source-capped 50-item batch.
//
// Idempotent: running twice is harmless. Only matches by exact URL
// to avoid accidentally disabling something we don't mean to.
//
// Run: `npx convex run seed:disableNonMiamiSources --prod`
export const disableNonMiamiSources = internalMutation({
  args: {},
  handler: async (ctx) => {
    const targets = [
      // Florida Phoenix — Tallahassee-focused statewide news.
      "https://floridaphoenix.com/feed/",
      "bluesky://floridaphoenix.com",
      "bluesky://floridapolitics.bsky.social",
      // Florida Politics — Tallahassee/Orlando.
      "https://floridapolitics.com/feed/",
      "https://feeds.feedburner.com/floridapolitics",
      // NBC 6 national/international — by definition non-Miami.
      "https://www.nbcmiami.com/news/national-international/?rss=y",
      // Sun Sentinel statewide — Broward + statewide political feed.
      "https://www.sun-sentinel.com/news/politics/feed/",
    ]
    const targetSet = new Set(targets)
    const all = await ctx.db.query("sources").collect()
    const now = Date.now()
    let disabled = 0
    let alreadyDisabled = 0
    for (const s of all) {
      if (!targetSet.has(s.url)) continue
      if (!s.enabled) {
        alreadyDisabled += 1
        continue
      }
      await ctx.db.patch(s._id, {
        enabled: false,
        autoDisabledAt: now,
        autoDisabledReason: "non-Miami coverage (manual prune)",
      })
      disabled += 1
    }
    return {
      disabled,
      alreadyDisabled,
      targetCount: targets.length,
    }
  },
})

// =====================================================================
// One-shot Books & Books cleanup — reconciles three competing seed
// rows (V6 `/events/`, V8 dup of V6, V9 `/event/` permalink-base) into
// a single canonical row. The V9 URL `/event/` is the WordPress single-
// post permalink base, not a listing — it returns at most one event,
// which is why the feed only showed one Books & Books row.
//
// Deletes the V9 row outright and patches the surviving V6 row to
// carry the section + neighborhood tags V9 was meant to provide.
//
// Idempotent: matches by exact URL. Running twice is harmless.
//
// Run: `npx convex run seed:cleanupBooksAndBooksSources --prod`
export const cleanupBooksAndBooksSources = internalMutation({
  args: {},
  handler: async (ctx) => {
    const sectionIdBySlug = new Map<string, Id<"sections">>()
    for (const s of await ctx.db.query("sections").collect()) {
      sectionIdBySlug.set(s.slug, s._id)
    }
    const all = await ctx.db.query("sources").collect()
    let deleted = 0
    let patched = 0
    for (const src of all) {
      if (src.url === "https://www.booksandbooks.com/event/") {
        await ctx.db.delete(src._id)
        deleted += 1
        continue
      }
      if (src.url === "https://www.booksandbooks.com/events/") {
        const sectionIds: Array<Id<"sections">> = []
        for (const slug of ["books", "arts"]) {
          const id = sectionIdBySlug.get(slug)
          if (id) sectionIds.push(id)
        }
        await ctx.db.patch(src._id, {
          sectionIds,
          neighborhoodSlugs: ["coral-gables"],
          pollIntervalMinutes: 180,
        })
        patched += 1
      }
    }
    return { deleted, patched }
  },
})

// =====================================================================
// One-shot prune of the legacy newspaper-style agents (News Desk,
// Politics Desk, Business Desk, Sports Desk, Food Desk, Arts &
// Culture Desk, Investigations, Miami History, Opinion, Music Desk,
// Real Estate, Climate/Science Desk). They were retired with the
// events-only pivot; the only active LLM persona is the Events Desk.
//
// Deletes the agent rows + their corresponding author rows so the
// admin agents grid + the public byline list both stop showing dead
// personas. Idempotent — running twice is harmless.
//
// Run: `npx convex run seed:cleanupLegacyAgents --prod`
export const cleanupLegacyAgents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const DEAD_AGENT_SLUGS = new Set([
      "news",
      "politics",
      "business",
      "sports",
      "food",
      "arts",
      "investigations",
      "miami-history",
      "opinion",
      "music",
      "real-estate",
      "climate",
    ])
    const DEAD_AUTHOR_SLUGS = new Set([
      "news-desk",
      "politics-desk",
      "business-desk",
      "sports-desk",
      "food-desk",
      "arts-and-culture-desk",
      "investigations-desk",
      "miami-history-desk",
      "opinion-desk",
      "music-desk",
      "real-estate-desk",
      "climate-desk",
    ])
    let agentsDeleted = 0
    let authorsDeleted = 0
    const agents = await ctx.db.query("agents").collect()
    for (const a of agents) {
      if (!DEAD_AGENT_SLUGS.has(a.slug)) continue
      await ctx.db.delete(a._id)
      agentsDeleted += 1
    }
    const authors = await ctx.db.query("authors").collect()
    for (const a of authors) {
      if (!DEAD_AUTHOR_SLUGS.has(a.slug)) continue
      await ctx.db.delete(a._id)
      authorsDeleted += 1
    }
    return { agentsDeleted, authorsDeleted }
  },
})
