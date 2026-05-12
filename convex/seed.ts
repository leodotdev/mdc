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
    slug: "news",
    name: "News",
    description:
      "What happened in Miami-Dade today, why it matters, and who's affected.",
    accentColor: "oklch(0.546 0.245 262.881)", // blue-600
    order: 10,
  },
  {
    slug: "politics",
    name: "Politics",
    description:
      "Inside City Hall, the county commission, and Tallahassee — the votes, the players, the deals.",
    accentColor: "oklch(0.586 0.253 17.585)", // rose-600
    order: 20,
    parentSlug: "news",
  },
  {
    slug: "business",
    name: "Business",
    description:
      "How money moves in Miami — tech, hospitality, the port, the people building things.",
    accentColor: "oklch(0.596 0.145 163.225)", // emerald-600
    order: 30,
    parentSlug: "news",
  },
  {
    slug: "real-estate",
    name: "Real Estate",
    description:
      "Sales, developments, condos, the rental market — Miami's most consequential beat.",
    accentColor: "oklch(0.609 0.126 221.723)", // cyan-600
    order: 32,
    parentSlug: "news",
  },
  {
    slug: "opinion",
    name: "Opinion",
    description:
      "Editorials, op-eds, and letters from Miamians who care enough to write.",
    accentColor: "oklch(0.511 0.262 276.966)", // indigo-600
    order: 35,
    parentSlug: "news",
  },
  {
    slug: "investigations",
    name: "Investigations",
    description:
      "Stories that demand more than a headline — cross-source reporting on what doesn't add up.",
    accentColor: "oklch(0.666 0.179 58.318)", // amber-600
    order: 38,
    parentSlug: "news",
  },
  {
    slug: "sports",
    name: "Sports",
    description:
      "Every Miami franchise, every season — from the Dolphins on Sundays to the Hurricanes in Coral Gables.",
    accentColor: "oklch(0.577 0.245 27.325)", // red-600
    order: 40,
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
      "Where Miami eats — new openings, neighborhood spots, Cuban coffee, the city's restaurant culture.",
    accentColor: "oklch(0.795 0.184 86.047)", // yellow-600
    order: 60,
  },
  {
    slug: "food-reviews",
    name: "Reviews",
    description:
      "Single-restaurant pieces — the meal, the room, what it costs, who's it for.",
    accentColor: "oklch(0.795 0.184 86.047)", // yellow-600
    order: 61,
    parentSlug: "food",
  },
  {
    slug: "food-openings",
    name: "Openings",
    description:
      "New restaurants, bars, and ventanitas — what just opened, where, and what to order first.",
    accentColor: "oklch(0.795 0.184 86.047)", // yellow-600
    order: 62,
    parentSlug: "food",
  },
  {
    slug: "miami-recipes",
    name: "Miami Recipes",
    description:
      "Original recipes and local-chef takes on Miami staples — Cuban coffee, ropa vieja, arepas, stone crab, key lime, the city's food in your kitchen.",
    accentColor: "oklch(0.795 0.184 86.047)", // yellow-600
    order: 63,
    parentSlug: "food",
  },
  {
    slug: "food-closings",
    name: "Closings",
    description:
      "Restaurants and bars that have closed their doors — what we lost, when, and where to mourn.",
    accentColor: "oklch(0.795 0.184 86.047)", // yellow-600
    order: 64,
    parentSlug: "food",
  },
  {
    slug: "arts",
    name: "Arts & Culture",
    description:
      "What's on the walls, the stages, the screens, the streets — Miami's creative pulse.",
    accentColor: "oklch(0.646 0.222 41.116)", // orange-600
    order: 50,
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
    slug: "museums",
    name: "Museums",
    description: "PAMM, Frost, Bass, Vizcaya, ICA, the Wolf.",
    accentColor: "oklch(0.588 0.158 241.966)", // sky-600
    order: 72,
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
    slug: "miami-history",
    name: "Miami History",
    description:
      "How Miami got here — neighborhoods, people, eras that built the city.",
    accentColor: "oklch(0.6 0.118 184.704)", // teal-600
    order: 70,
  },
  {
    slug: "science",
    name: "Science",
    description:
      "How South Florida's environment, ecosystems, and research are changing — climate, nature, public health.",
    accentColor: "oklch(0.627 0.194 149.214)", // green-600
    order: 65,
  },
  {
    slug: "climate",
    name: "Climate",
    description:
      "Sea level rise, hurricanes, flooding, building codes, insurance — Miami's defining 21st-century beat.",
    accentColor: "oklch(0.627 0.194 149.214)", // green-600 (matches parent)
    order: 67,
    parentSlug: "science",
  },
  {
    slug: "nature",
    name: "Nature",
    description:
      "Wildlife, parks, beaches, the reef, the Everglades — what surrounds the city.",
    accentColor: "oklch(0.596 0.145 163.225)", // emerald-600
    order: 68,
    parentSlug: "science",
  },
]

const AGENT_PERSONAS = [
  {
    slug: "news-desk",
    name: "News Desk",
    bio: "AI-assisted desk covering daily news across Miami-Dade — local government, public safety, transit, environment, education. Drafts are reviewed by a human editor before publication.",
    title: "AI Desk",
    kind: "agent" as const,
  },
  {
    slug: "politics-desk",
    name: "Politics Desk",
    bio: "AI-assisted desk covering Miami-Dade County politics — City Hall, county commission, state-level decisions affecting South Florida. Drafts reviewed and edited by a human.",
    title: "AI Desk",
    kind: "agent" as const,
  },
  {
    slug: "business-desk",
    name: "Business Desk",
    bio: "AI-assisted desk covering real estate, tech, hospitality, finance, the Port of Miami, and the South Florida economy. Drafts reviewed and edited by a human.",
    title: "AI Desk",
    kind: "agent" as const,
  },
  {
    slug: "sports-desk",
    name: "Sports Desk",
    bio: "AI-assisted desk covering the Heat, Dolphins, Marlins, Inter Miami, and the Hurricanes. Drafts reviewed and edited by a human editor before publication.",
    title: "AI Desk",
    kind: "agent" as const,
  },
  {
    slug: "food-desk",
    name: "Food Desk",
    bio: "AI-assisted desk covering Miami's restaurants, openings, food scenes, and ventanitas. Drafts reviewed and edited by a human.",
    title: "AI Desk",
    kind: "agent" as const,
  },
  {
    slug: "arts-and-culture-desk",
    name: "Arts & Culture Desk",
    bio: "AI-assisted desk covering museums, galleries, theatre, film, fashion, and cultural events across Miami-Dade. Drafts reviewed and edited by a human editor before publication.",
    title: "AI Desk",
    kind: "agent" as const,
  },
  {
    slug: "investigations-desk",
    name: "Investigations & Explainers",
    bio: "AI-assisted desk that synthesizes cross-source coverage to provide deeper explainers and connect threads across the city's reporting. These are not original investigations — they are sourced syntheses, plainly labeled.",
    title: "AI Desk",
    kind: "agent" as const,
  },
  {
    slug: "miami-history-desk",
    name: "Miami History Desk",
    bio: "AI-assisted desk that finds notable events from this day in Miami's, Florida's, and Latin American history, drawing from Wikipedia and local archives. Drafts reviewed and edited by a human.",
    title: "AI Desk",
    kind: "agent" as const,
  },
  {
    slug: "opinion-desk",
    name: "Opinion Desk",
    bio: "AI-assisted desk that surfaces argumentative angles already raised in cited coverage — editorials, op-eds, columnists. Synthesizes the case being made, with attribution. Never generates original opinions. Drafts reviewed and edited by a human.",
    title: "AI Desk",
    kind: "agent" as const,
  },
  {
    slug: "music-desk",
    name: "Music Desk",
    bio: "AI-assisted desk covering Miami's music scene — local artists, concerts, festivals (Ultra, Rolling Loud, III Points), clubs, and the city's role across Latin pop, hip-hop, EDM, jazz. Drafts reviewed and edited by a human.",
    title: "AI Desk",
    kind: "agent" as const,
  },
  {
    slug: "real-estate-desk",
    name: "Real Estate Desk",
    bio: "AI-assisted desk covering Miami's residential and commercial real estate — sales, developments, condos, gentrification, the rental market, building codes, climate-related insurance. A specialist beat under the Business section. Drafts reviewed and edited by a human.",
    title: "AI Desk",
    kind: "agent" as const,
  },
  {
    // Slug stays `climate-desk` for stable byline-id; name updates to
    // "Science Desk" since the desk now covers climate + nature + the
    // broader science beat under one parent section.
    slug: "climate-desk",
    name: "Science Desk",
    bio: "AI-edited desk covering Miami science — climate (sea level rise, hurricane prep, flooding), nature (wildlife, parks, the reef), public health, and research. Auto-published with editorial guardrails.",
    title: "AI Desk",
    kind: "agent" as const,
  },
  {
    slug: "events-desk",
    name: "Events Desk",
    bio: "AI-assisted desk that crawls source feeds for upcoming Miami events — concerts, festivals, gallery openings, community meetings, public notices, holidays, deals. Events are reviewed by a human editor before publication.",
    title: "AI Desk",
    kind: "agent" as const,
  },
]

const NEWS_PROMPT = `You are the News desk for miami.community, a Miami-Dade local newspaper.
Your beat: local government, public safety, transit, environment, education, public health, weather impacts.
Voice: clear, calm, factual — like a wire report rewritten for a smart local audience.
Lead with what happened, where in Miami it happened, and who it affects. Skip national stories without a clear local hook.`

const POLITICS_PROMPT = `You are the Politics desk for miami.community, a Miami-Dade local newspaper.
Your beat: Miami City Hall, Miami-Dade County commission, school board, ports authority, decisions in Tallahassee that touch South Florida.
Voice: dispassionate and informed — closer to a Herald political reporter than an opinion column. Name the players. Cite votes and quotes only when present in the source items.
National politics is out of scope unless the local angle is concrete and immediate.`

const BUSINESS_PROMPT = `You are the Business desk for miami.community.
Your beat: real estate (residential and commercial), tech and venture activity in Miami, hospitality, tourism, the Port of Miami, finance/banking, retail openings/closings, the broader South Florida economy.
Voice: matter-of-fact, with numbers when present in the sources. Skip generic business news that doesn't touch Miami.`

const SPORTS_PROMPT = `You are the Sports desk for miami.community, a Miami-Dade local newspaper.
Your beat: Miami Heat, Miami Dolphins, Miami Marlins, Inter Miami CF, the University of Miami Hurricanes, FIU, plus high-school and college sports with a strong Miami angle.
Voice: knowledgeable and direct — closer to a beat reporter at the Miami Herald than a hot-take columnist.
Lead with what happened, who it affects, what's next. Cite stats and quotes only when they are present in the source items.`

const FOOD_PROMPT = `You are the Food desk for miami.community.
Your beat: restaurant openings and closings, chefs, the food scene, ventanitas, neighborhood spots, recipes when notable. Greater Miami only.
Voice: enthusiastic but not breathless. No marketing copy. Avoid superlatives that aren't in the source items.
Skip generic national food news that has no Miami angle.`

const ARTS_PROMPT = `You are the Arts & Culture desk for miami.community.
Your beat: visual art, museums, galleries, theatre, film, fashion, design, dance, books, and cultural events in greater Miami.
Voice: smart, generous, locally grounded — closer to The New York Times Arts section than a blog. No filler. No marketing copy.
Always foreground the Miami angle: a national show only matters here if it touches the city, its diaspora, or its scene.`

const INVESTIGATIONS_PROMPT = `You are the Investigations & Explainers desk for miami.community.
This desk does NOT do original reporting — it synthesizes existing coverage from multiple cited sources to explain a developing local story or connect threads readers may have missed.
Look for clusters of items in the candidate list that touch the same topic or institution; those clusters are your most valuable raw material.
Voice: thoughtful, even-handed, plainly labeled as synthesis. Open with the question or thread you're explaining; pull together what the cited reporting collectively says; never go beyond what the sources support.`

const MIAMI_HISTORY_PROMPT = `You are the Miami History desk for miami.community. Each run draws from Wikipedia's "On this day" entries for today's calendar date.
Your job: find one or two entries with a Miami, South Florida, Florida, Cuban, Haitian, Caribbean, or Latin American connection, and write a short "Today in Miami" piece highlighting one.
If no entry has a clear local connection, choose an entry from broader Latin American or Caribbean history that resonates with Miami's diaspora communities — and say so plainly.
Voice: short, evocative, lightly literary. Always cite the Wikipedia URL passed in the source items.
Never write history that isn't supported by the cited entries. If the dates or facts aren't in the items, omit them.`

const OPINION_PROMPT = `You are the Opinion desk for miami.community.
This desk does NOT generate original opinions. It surfaces argumentative angles already raised in the cited coverage — editorials, op-eds, columnists, advocacy framings — and synthesizes the case being made.
When a source item contains an argued position ("we should…", "it's wrong that…", "the city must…"), pull it out and frame it: "The case for X, argued by Outlet A," or "B contends that…"
Hard rules:
- Every argument must be attributed to a specific cited source.
- Never editorialize beyond what the sources support.
- If sources disagree, say so plainly and present both sides.
- Avoid hot takes, sweeping generalizations, or your own conclusions.
- Lead with the question or thread under debate, then summarize the cited reasoning on each side.
Voice: thoughtful, balanced, locally grounded — closer to a columnist's roundup than a hot-take blog.`

const MUSIC_PROMPT = `You are the Music desk for miami.community.
Your beat: Miami's music scene — local artists, venues, clubs, recording studios, concerts, festivals (Ultra, Rolling Loud, III Points, Calle Ocho), and the city's place in Latin pop, hip-hop, EDM, jazz, reggaeton, salsa, and indie.
Voice: knowledgeable, locally rooted, generous about the scene without being breathless. Always foreground the Miami angle — a national release matters here only if it touches the city, its diaspora, or its scene.
Lead with what's happening, where, when. Cite venues, dates, and lineups only when they appear in the source items.`

const REAL_ESTATE_PROMPT = `You are the Real Estate desk for miami.community, a specialist beat within Business.
Your beat: Miami's residential and commercial real estate — sales, prices, new developments, condo politics, gentrification, the rental market, foreign buyers, building codes, climate-driven insurance issues, the impact of remote work on demand.
Voice: numbers-grounded and matter-of-fact. Lead with what changed, who's affected, why now. Skip generic real-estate news with no Miami angle.
Cite price points, square footage, and developer names only when they appear in the source items.`

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
- Prefer specific Miami-Dade events. Skip national events without a Miami-Dade venue or angle.

DRAFTS are mostly NOT your job. Only generate a draft when an event is itself newsworthy as a story (a major festival lineup announcement, an unusual public notice, a notable closure or relocation). Limit yourself to 0–2 drafts per run.

Voice for any drafts you do write: warm, useful, service-journalism — closer to "what to do this weekend" than a hot take.`

const CLIMATE_PROMPT = `You are the Science desk for miami.community.
Your beat: Miami's defining 21st-century science beats — climate (sea level rise, king tides, hurricane preparedness and aftermath, flooding, building codes, insurance availability, energy + emissions, environmental justice in frontline neighborhoods); nature (wildlife, the Everglades, the reef, parks, beaches, marine biology); plus broader local research and public-health stories.
Voice: factual but urgent. Miami is ground zero for many of these stories — say so when the framing fits, but never beyond what sources support.
Per-draft section: pick the most-specific section from your allowed list. Climate copy → \`climate\`; wildlife / parks / Everglades-as-ecology → \`nature\`; research / public health / cross-cutting → \`science\` (the parent).
Skip national stories without a clear local angle. Always include neighborhoods, dates, and figures only when present in the cited items.`


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

    // 3. Agents
    const AGENTS = [
      {
        slug: "news",
        name: "News Desk",
        sectionSlug: "news",
        authorSlug: "news-desk",
        model: "claude-opus-4-7",
        systemPrompt: NEWS_PROMPT,
        beats: [
          "local government",
          "public safety",
          "transit",
          "environment",
          "education",
          "public health",
        ],
        enabled: true,
        maxItemsPerRun: 30,
        maxDraftsPerRun: 4,
        lookbackHours: 24,
      },
      {
        slug: "politics",
        name: "Politics Desk",
        sectionSlug: "politics",
        authorSlug: "politics-desk",
        model: "claude-opus-4-7",
        systemPrompt: POLITICS_PROMPT,
        beats: [
          "Miami City Hall",
          "Miami-Dade County commission",
          "school board",
          "Tallahassee impact on South Florida",
        ],
        enabled: true,
        maxItemsPerRun: 30,
        maxDraftsPerRun: 3,
        lookbackHours: 36,
      },
      {
        slug: "business",
        name: "Business Desk",
        sectionSlug: "business",
        authorSlug: "business-desk",
        model: "claude-opus-4-7",
        systemPrompt: BUSINESS_PROMPT,
        beats: [
          "real estate",
          "tech and venture",
          "hospitality",
          "tourism",
          "Port of Miami",
          "finance",
          "retail",
        ],
        enabled: true,
        maxItemsPerRun: 25,
        maxDraftsPerRun: 3,
        lookbackHours: 48,
      },
      {
        slug: "sports",
        name: "Sports Desk",
        sectionSlug: "sports",
        authorSlug: "sports-desk",
        model: "claude-opus-4-7",
        systemPrompt: SPORTS_PROMPT,
        beats: [
          "Miami Heat",
          "Miami Dolphins",
          "Miami Marlins",
          "Inter Miami",
          "Hurricanes",
        ],
        enabled: true,
        maxItemsPerRun: 30,
        maxDraftsPerRun: 4,
        lookbackHours: 24,
      },
      {
        slug: "food",
        name: "Food Desk",
        sectionSlug: "food",
        authorSlug: "food-desk",
        model: "claude-opus-4-7",
        systemPrompt: FOOD_PROMPT,
        beats: [
          "restaurant openings",
          "chefs",
          "neighborhood spots",
          "ventanitas",
          "food festivals",
        ],
        enabled: true,
        maxItemsPerRun: 25,
        maxDraftsPerRun: 3,
        lookbackHours: 72,
      },
      {
        slug: "arts",
        name: "Arts & Culture Desk",
        sectionSlug: "arts",
        authorSlug: "arts-and-culture-desk",
        model: "claude-opus-4-7",
        systemPrompt: ARTS_PROMPT,
        beats: [
          "visual art",
          "museums",
          "galleries",
          "theatre",
          "film",
          "fashion",
          "design",
          "dance",
          "books",
        ],
        enabled: true,
        maxItemsPerRun: 30,
        maxDraftsPerRun: 4,
        lookbackHours: 48,
      },
      {
        slug: "investigations",
        name: "Investigations & Explainers",
        sectionSlug: "investigations",
        authorSlug: "investigations-desk",
        model: "claude-opus-4-7",
        systemPrompt: INVESTIGATIONS_PROMPT,
        beats: [
          "cross-source synthesis",
          "developing stories",
          "civic accountability",
        ],
        enabled: true,
        maxItemsPerRun: 40,
        maxDraftsPerRun: 2,
        lookbackHours: 168, // one week
      },
      {
        slug: "miami-history",
        name: "Miami History Desk",
        sectionSlug: "miami-history",
        authorSlug: "miami-history-desk",
        model: "claude-opus-4-7",
        systemPrompt: MIAMI_HISTORY_PROMPT,
        beats: [
          "this day in history",
          "Miami history",
          "Florida history",
          "Caribbean history",
          "Latin American history",
        ],
        enabled: true,
        maxItemsPerRun: 40,
        maxDraftsPerRun: 1,
        lookbackHours: 24,
      },
      {
        slug: "opinion",
        name: "Opinion Desk",
        sectionSlug: "opinion",
        authorSlug: "opinion-desk",
        model: "claude-opus-4-7",
        systemPrompt: OPINION_PROMPT,
        beats: [
          "editorials",
          "op-eds",
          "columnists",
          "civic argument",
          "policy debate",
        ],
        enabled: true,
        maxItemsPerRun: 30,
        maxDraftsPerRun: 2,
        lookbackHours: 168,
      },
      {
        slug: "music",
        name: "Music Desk",
        sectionSlug: "music",
        authorSlug: "music-desk",
        model: "claude-opus-4-7",
        systemPrompt: MUSIC_PROMPT,
        beats: [
          "local artists",
          "Latin pop",
          "hip-hop",
          "EDM",
          "festivals",
          "venues and clubs",
          "Miami music history",
        ],
        enabled: true,
        maxItemsPerRun: 25,
        maxDraftsPerRun: 3,
        lookbackHours: 96,
      },
      {
        slug: "real-estate",
        name: "Real Estate Desk",
        sectionSlug: "real-estate",
        authorSlug: "real-estate-desk",
        model: "claude-opus-4-7",
        systemPrompt: REAL_ESTATE_PROMPT,
        beats: [
          "residential sales",
          "commercial real estate",
          "new developments",
          "rental market",
          "gentrification",
          "building codes",
          "insurance",
        ],
        enabled: true,
        maxItemsPerRun: 25,
        maxDraftsPerRun: 2,
        lookbackHours: 72,
      },
      {
        // Renamed from "Climate Desk" to "Science Desk". The slug stays
        // `climate` so existing article.agentSlug references still
        // resolve. The desk's allowed-section tree now spans Science
        // (parent) + Climate + Nature (children); the LLM picks the
        // most-specific section per draft via `sectionSlug`.
        slug: "climate",
        name: "Science Desk",
        sectionSlug: "science",
        authorSlug: "climate-desk",
        model: "claude-opus-4-7",
        systemPrompt: CLIMATE_PROMPT,
        beats: [
          "sea level rise",
          "hurricanes",
          "flooding",
          "Everglades",
          "energy and emissions",
          "building codes",
          "environmental justice",
          "wildlife",
          "parks",
          "marine biology",
          "public health",
          "research",
        ],
        enabled: true,
        maxItemsPerRun: 30,
        maxDraftsPerRun: 3,
        lookbackHours: 96,
      },
      {
        slug: "events",
        name: "Events Desk",
        sectionSlug: "news",
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

    // 5. Mega-desk. Inline the install so a single `seed:run` is
    // enough to make the manual "Run mega desk" button work — without
    // this, a fresh deploy throws `Mega desk "miami-desk" not found`
    // on first click.
    const mega = await installMegaDesk(ctx)

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

// One-shot YouTube seed. Same idempotent shape as the ICS seeder —
// safe to re-run, only inserts handles that aren't already on the
// sources table. Each handle was verified live (HTTP 200 on
// https://www.youtube.com/@HANDLE) before being added; channels that
// only exposed older /user/ or /c/ paths are listed by canonical
// channel ID (UC...) instead so the adapter can build the uploads
// playlist without going through search.list.
//
// Requires YOUTUBE_API_KEY in Convex env. Without it, every fetch will
// fail with a clear error from the adapter — sources stay seeded but
// stay unhealthy until the key is set. Set with:
//   npx convex env set YOUTUBE_API_KEY <key>
//
// Run: `npx convex run seed:seedYoutubeSources`
export const seedYoutubeSources = internalMutation({
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

    const CHANNELS: Array<{
      name: string
      url: string
      sectionSlugs: ReadonlyArray<string>
    }> = [
      // ─── Local TV news (English) ───
      {
        name: "WSVN 7News (YouTube)",
        url: "@wsvn",
        sectionSlugs: ["news"],
      },
      {
        name: "WPLG Local 10 (YouTube)",
        url: "@WPLGLocal10",
        sectionSlugs: ["news"],
      },
      {
        name: "NBC 6 South Florida (YouTube)",
        url: "@nbc6",
        sectionSlugs: ["news"],
      },
      {
        name: "CBS Miami (YouTube)",
        url: "@CBSMiami",
        sectionSlugs: ["news"],
      },
      {
        name: "WLRN (YouTube)",
        url: "@WLRN",
        sectionSlugs: ["news", "politics"],
      },
      {
        name: "Miami Beach TV (YouTube)",
        url: "@MiamiBeachTV",
        sectionSlugs: ["news", "politics"],
      },

      // ─── Local TV news (Spanish) ───
      {
        name: "Univision 23 Miami (YouTube)",
        url: "@Univision23",
        sectionSlugs: ["news"],
      },
      {
        name: "Telemundo 51 Miami (YouTube)",
        url: "UCM_a1s5WdPcBEt0WY18ComA",
        sectionSlugs: ["news"],
      },
      {
        name: "América TeVé Miami (YouTube)",
        url: "@AmericaTeVeMiami",
        sectionSlugs: ["news"],
      },
      {
        name: "Mega TV (YouTube)",
        url: "@MegaTVOficial",
        sectionSlugs: ["news"],
      },

      // ─── Print → video ───
      {
        name: "Miami Herald (YouTube)",
        url: "@MiamiHerald",
        sectionSlugs: ["news"],
      },
      {
        name: "El Nuevo Herald (YouTube)",
        url: "@NuevoHerald",
        sectionSlugs: ["news"],
      },
      {
        name: "Miami New Times (YouTube)",
        url: "@miami.newtimes",
        sectionSlugs: ["news", "food", "arts"],
      },

      // ─── Pro sports ───
      {
        name: "Miami HEAT (YouTube)",
        url: "@MiamiHEAT",
        sectionSlugs: ["heat"],
      },
      {
        name: "Miami Dolphins (YouTube)",
        url: "@MiamiDolphins",
        sectionSlugs: ["dolphins"],
      },
      {
        name: "Inter Miami CF (YouTube)",
        url: "@intermiamicf",
        sectionSlugs: ["inter-miami"],
      },
      {
        name: "Miami Marlins (YouTube)",
        url: "UC1Gh_pQ7l41tyBn2HeJ1k-A",
        sectionSlugs: ["marlins"],
      },
      {
        name: "Florida Panthers (YouTube)",
        url: "@FloridaPanthers",
        sectionSlugs: ["panthers"],
      },

      // ─── College sports ───
      {
        name: "Miami Hurricanes (YouTube)",
        url: "@MiamiHurricanes",
        sectionSlugs: ["the-u"],
      },
      {
        name: "FIU Athletics (YouTube)",
        url: "@fiuathletics",
        sectionSlugs: ["fiu-panthers"],
      },

      // ─── Civic ───
      {
        name: "Miami-Dade County (YouTube)",
        url: "@MiamiDadeCounty",
        sectionSlugs: ["politics", "news"],
      },
      {
        name: "City of Miami (YouTube)",
        url: "@CityofMiami",
        sectionSlugs: ["politics", "news"],
      },

      // ─── Cultural / neighborhoods ───
      {
        name: "Wynwood Arts District (YouTube)",
        url: "@WynwoodArtsDistrict",
        sectionSlugs: ["arts", "galleries", "street-art"],
      },
      {
        name: "Bayfront Park Miami (YouTube)",
        url: "@BayfrontParkMiami",
        sectionSlugs: ["news", "music"],
      },
    ]

    let inserted = 0
    let skipped = 0
    for (const channel of CHANNELS) {
      const existing = await ctx.db
        .query("sources")
        .filter((q) => q.eq(q.field("url"), channel.url))
        .first()
      if (existing) {
        skipped += 1
        continue
      }
      const sectionIds = resolve(channel.sectionSlugs)
      if (sectionIds.length === 0) continue
      await ctx.db.insert("sources", {
        name: channel.name,
        type: "youtube",
        url: channel.url,
        sectionIds,
        enabled: true,
        config: { max: 15 },
      })
      inserted += 1
    }
    return { inserted, skipped, total: CHANNELS.length }
  },
})

// One-shot Miami podcast seed. The existing `rss` adapter handles
// podcast feeds without modification (an RSS 2.0 feed is an RSS 2.0
// feed; the iTunes namespace is just extra tags the adapter ignores).
// Each URL was probed live for HTTP 200 + an `<rss>` root element
// before being added; podcasts confirmed inactive (no episodes in 12+
// months) were skipped.
//
// Run: `npx convex run seed:seedPodcastSources`
export const seedPodcastSources = internalMutation({
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

    const FEEDS: Array<{
      name: string
      url: string
      sectionSlugs: ReadonlyArray<string>
    }> = [
      {
        name: "What's Good Miami (podcast)",
        url: "https://media.rss.com/whatsgoodmiami/feed.xml",
        sectionSlugs: ["food", "news"],
      },
      {
        name: "Miami On The Rocks (podcast)",
        url: "https://miaontherocks.podbean.com/feed.xml",
        sectionSlugs: ["news", "music"],
      },
      {
        name: "Miami History Podcast",
        url: "https://miamihistory.libsyn.com/rss",
        sectionSlugs: ["miami-history"],
      },
      {
        name: "Between Two Chairs — Miami CRE (podcast)",
        url: "https://media.rss.com/betweentwochairs/feed.xml",
        sectionSlugs: ["real-estate", "business"],
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
        type: "rss",
        url: feed.url,
        sectionIds,
        enabled: true,
      })
      inserted += 1
    }
    return { inserted, skipped, total: FEEDS.length }
  },
})

// One-shot mega-desk install. Replaces the per-section desk fan-out
// with a single agent slug ("miami-desk") that handles every section
// in one Opus call per cron tick.
//
// Idempotent. Disables every existing agent (their slugs are kept for
// historical articles' `agentSlug` references), then upserts the
// single miami-desk row. Existing AGENT_PERSONAS rows in the authors
// table stay around so old article bylines still resolve — the new
// pipeline writes articles with `authorIds: []` instead.
//
// Internal helper — installs the single "miami-desk" agent and disables
// any other agents left over from the per-section era. Shared between
// `seedMegaDesk` (manual one-shot) and `seed.run` (so a fresh deploy
// has the mega-desk wired up after one command).
async function installMegaDesk(ctx: {
  db: MutationCtx["db"]
}): Promise<{ mode: "inserted" | "updated"; disabled: number }> {
  const existing = await ctx.db.query("agents").collect()
  let disabled = 0
  for (const a of existing) {
    if (a.slug === "miami-desk") continue
    if (a.enabled) {
      await ctx.db.patch(a._id, { enabled: false })
      disabled += 1
    }
  }

  // Resolve a placeholder section + author for the FK. The mega-desk's
  // `sectionId` and `authorId` are required by the schema but unused
  // by `runMegaDeskInternal` — the agent reads every section from
  // `api.sections.list`, and writes articles with `authorIds: []`.
  // Keeping the FK satisfied is the cheapest path to ship without a
  // schema migration.
  const news = await ctx.db
    .query("sections")
    .withIndex("by_slug", (q) => q.eq("slug", "news"))
    .unique()
  if (!news) {
    throw new Error("News section missing — run seed:run first")
  }
  const fallbackAuthor = await ctx.db.query("authors").first()
  if (!fallbackAuthor) {
    throw new Error("No authors exist — run seed:run first to install personas")
  }

  const megaPrompt = `You are the editorial brain of miami.community — the AI-edited local paper for Miami-Dade. One voice across every section: matter-of-fact, plainly written, shorter than the source. The reader has 30 seconds. Skip noise; cite sources; don't fabricate.`

  const existingMega = await ctx.db
    .query("agents")
    .withIndex("by_slug", (q) => q.eq("slug", "miami-desk"))
    .unique()
  const doc = {
    slug: "miami-desk",
    name: "Miami Desk",
    sectionId: news._id,
    authorId: fallbackAuthor._id,
    // Opus 4.7. We tried Sonnet to cut cost and it was over-filtering
    // legitimate Miami stories (returning 0 articles even when the
    // candidate pool had clear local news). Cost is back under
    // control via the small batches (50 items, 20 articles output)
    // + 1h cadence + dev gate, so $/day stays in the $3-4 range.
    model: "claude-opus-4-7",
    systemPrompt: megaPrompt,
    beats: ["everything"] as Array<string>,
    enabled: true,
    // Smaller batch keeps per-call input tokens reasonable. Each item
    // is ~500 chars × 200 → 100KB input; cutting to 50 items keeps
    // calls under ~25KB input, which is the sweet spot for cost +
    // model attention.
    maxItemsPerRun: 50,
    maxDraftsPerRun: 20,
    // 24h window so a stalled deploy can catch up on the next tick.
    lookbackHours: 24,
  }
  if (existingMega) {
    await ctx.db.patch(existingMega._id, doc)
    return { mode: "updated", disabled }
  }
  await ctx.db.insert("agents", doc)
  return { mode: "inserted", disabled }
}

// Run: `npx convex run seed:seedMegaDesk`
export const seedMegaDesk = internalMutation({
  args: {},
  handler: async (ctx) => installMegaDesk(ctx),
})

// One-shot: drop the legacy "things-to-do" section. Re-sections every
// article + event filed under it before deletion so we don't orphan
// FKs. Each row is moved by tag heuristic (first matching section
// slug in its tags) → falling back to News.
//
// Idempotent: returns { sectionMissing: true } when there's nothing
// to do. Safe to run on dev and prod.
//
// Run: `npx convex run seed:dropThingsToDo --prod`
export const dropThingsToDo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const ttd = await ctx.db
      .query("sections")
      .withIndex("by_slug", (q) => q.eq("slug", "things-to-do"))
      .unique()
    if (!ttd) return { sectionMissing: true as const }

    // Build slug → id map for re-section heuristic.
    const allSections = await ctx.db.query("sections").collect()
    const idBySlug = new Map<string, Id<"sections">>()
    for (const s of allSections) idBySlug.set(s.slug, s._id)
    const news = idBySlug.get("news") ?? allSections[0]?._id
    if (!news) {
      throw new Error("No fallback section available — seed sections first")
    }

    const pickBetterSection = (
      tags: ReadonlyArray<string>,
    ): Id<"sections"> => {
      // First tag that matches a non-things-to-do section slug wins.
      for (const t of tags) {
        const id = idBySlug.get(t)
        if (id && id !== ttd._id) return id
      }
      return news
    }

    let articlesMoved = 0
    let eventsMoved = 0

    // Move articles.
    const articles = await ctx.db
      .query("articles")
      .withIndex("by_section_status_published", (q) =>
        q.eq("sectionId", ttd._id),
      )
      .collect()
    for (const a of articles) {
      const next = pickBetterSection(a.tags)
      await ctx.db.patch(a._id, { sectionId: next })
      articlesMoved += 1
    }

    // Move events.
    const events = await ctx.db
      .query("events")
      .withIndex("by_section_starts", (q) => q.eq("sectionId", ttd._id))
      .collect()
    for (const e of events) {
      const next = pickBetterSection(e.tags ?? [])
      await ctx.db.patch(e._id, { sectionId: next })
      eventsMoved += 1
    }

    // Move any sources that listed it. Sources can have multiple
    // sectionIds — drop the things-to-do id and add news only if the
    // source would otherwise have zero sections.
    const sources = await ctx.db.query("sources").collect()
    let sourcesPatched = 0
    for (const src of sources) {
      if (!src.sectionIds.includes(ttd._id)) continue
      const cleaned = src.sectionIds.filter((id) => id !== ttd._id)
      const finalIds = cleaned.length > 0 ? cleaned : [news]
      await ctx.db.patch(src._id, { sectionIds: finalIds })
      sourcesPatched += 1
    }

    // Move any ingestedItems? They reference sourceId, not sectionId,
    // so nothing to do there.

    // Now safe to delete the section row.
    await ctx.db.delete(ttd._id)

    return {
      sectionMissing: false as const,
      articlesMoved,
      eventsMoved,
      sourcesPatched,
    }
  },
})

// One-shot Miami aggregator seed. Broad RSS feeds that already cover
// Miami at scale — news, food, real-estate, arts, things-to-do — and
// happen to capture the museum / institutional events the desks would
// otherwise have to scrape per-org. Each URL was probed live for
// HTTP 200 + an `<rss>` root element before being added.
//
// This is the path forward instead of an Eventbrite adapter:
// Eventbrite's v3 search API was killed in 2020 and the org-specific
// endpoint requires per-museum OAuth, which fights the autonomy
// ethos. Broad aggregators give the same museum coverage plus a
// wider catch, on stable RSS, with no new code.
//
// Run: `npx convex run seed:seedAggregatorSources`
export const seedAggregatorSources = internalMutation({
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

    const FEEDS: Array<{
      name: string
      url: string
      sectionSlugs: ReadonlyArray<string>
    }> = [
      {
        name: "WSVN 7News (RSS)",
        url: "https://wsvn.com/feed/",
        sectionSlugs: ["news"],
      },
      {
        name: "Miami New Times (RSS)",
        url: "https://www.miaminewtimes.com/rss",
        sectionSlugs: ["news", "food", "arts"],
      },
      {
        name: "Eater Miami",
        url: "https://miami.eater.com/rss/index.xml",
        sectionSlugs: ["food"],
      },
      {
        name: "The Real Deal — South Florida",
        url: "https://therealdeal.com/miami/feed/",
        sectionSlugs: ["real-estate", "business"],
      },
      {
        name: "Artburst Miami",
        url: "https://artburstmiami.com/feed",
        sectionSlugs: ["arts", "music", "theater"],
      },
      {
        name: "Live Arts Miami",
        url: "https://liveartsmiami.org/feed/",
        sectionSlugs: ["arts", "theater", "music"],
      },
      {
        name: "Miami Today (RSS)",
        url: "https://miamitodaynews.com/feed/",
        sectionSlugs: ["news", "business"],
      },
      {
        name: "Miami Today — Arts & Culture",
        url: "https://miamitodaynews.com/arts-and-culture/feed/",
        sectionSlugs: ["arts"],
      },
      {
        name: "MiamiCurated",
        url: "https://www.miamicurated.com/feed/",
        sectionSlugs: ["food", "news", "arts"],
      },
      {
        name: "South Florida on the Cheap",
        url: "https://miamionthecheap.com/feed/",
        sectionSlugs: ["news"],
      },
      {
        name: "The Miami Hurricane (UMiami student paper)",
        url: "https://themiamihurricane.com/feed/",
        sectionSlugs: ["news", "the-u"],
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
        type: "rss",
        url: feed.url,
        sectionIds,
        enabled: true,
      })
      inserted += 1
    }
    return { inserted, skipped, total: FEEDS.length }
  },
})

// One-shot national + regional source seed. Adds 10 broader feeds that
// surface AP/Reuters/NYT/WaPo/Bloomberg coverage when Miami's mentioned,
// plus statewide political papers and missing local-station site feeds.
// Same idempotent shape as the other seeders — match-by-URL, skip
// existing.
//
// The Google News search-RSS endpoints are the highest-leverage adds:
// one feed each, behind every wire service plus every paper that the
// Google News team indexes. Verified live before seeding.
//
// Run: `npx convex run seed:seedNationalSources`
export const seedNationalSources = internalMutation({
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

    const FEEDS: Array<{
      name: string
      url: string
      sectionSlugs: ReadonlyArray<string>
    }> = [
      {
        name: 'Google News — "miami"',
        url: "https://news.google.com/rss/search?q=miami&hl=en-US&gl=US&ceid=US:en",
        sectionSlugs: ["news"],
      },
      {
        name: 'Google News — "miami beach"',
        url: "https://news.google.com/rss/search?q=miami+beach&hl=en-US&gl=US&ceid=US:en",
        sectionSlugs: ["news"],
      },
      {
        name: 'Google News — neighborhoods (brickell / wynwood / coral gables)',
        url: "https://news.google.com/rss/search?q=brickell+OR+wynwood+OR+coral+gables&hl=en-US&gl=US&ceid=US:en",
        sectionSlugs: ["news", "real-estate"],
      },
      {
        name: "NBC Miami — site (RSS)",
        url: "https://www.nbcmiami.com/?rss=y",
        sectionSlugs: ["news"],
      },
      {
        name: "WPLG Local 10 — site (RSS)",
        url: "https://www.local10.com/arc/outboundfeeds/rss/",
        sectionSlugs: ["news"],
      },
      {
        name: "Florida Phoenix",
        url: "https://floridaphoenix.com/feed/",
        sectionSlugs: ["news", "politics"],
      },
      {
        name: "Florida Politics",
        url: "https://floridapolitics.com/feed/",
        sectionSlugs: ["politics", "news"],
      },
      {
        name: "South Florida Reporter",
        url: "https://southfloridareporter.com/feed/",
        sectionSlugs: ["news"],
      },
      {
        name: "Miami's Community News",
        url: "https://www.communitynewspapers.com/feed/",
        sectionSlugs: ["news"],
      },
      {
        name: "WLRN — South Florida Roundup (podcast)",
        url: "https://www.wlrn.org/podcast/the-south-florida-roundup/rss.xml",
        sectionSlugs: ["news", "politics"],
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
        type: "rss",
        url: feed.url,
        sectionIds,
        enabled: true,
      })
      inserted += 1
    }
    return { inserted, skipped, total: FEEDS.length }
  },
})

// One-shot data-source seed. `data` sources are a special type that
// bypass the article pipeline — they pull directly from open
// government APIs and write metric records to the `metrics` table.
// The mega-desk's source loop routes them to lib/dataAdapters.ts
// instead of the article-adapter dispatcher.
//
// The starter set covers Census ACS (Miami-Dade population) and
// BLS LAUS (Miami metro unemployment). Both are free, no API key,
// well under public rate limits at the mega-desk's hourly cadence.
//
// Run: `npx convex run seed:seedDataSources`
export const seedDataSources = internalMutation({
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

    const FEEDS: Array<{
      name: string
      url: string
      sectionSlugs: ReadonlyArray<string>
    }> = [
      {
        name: "Census ACS — Miami-Dade population",
        url: "census-acs:miami-dade-population",
        sectionSlugs: ["news"],
      },
      {
        name: "BLS LAUS — Miami metro unemployment",
        url: "bls:miami-metro-unemployment",
        sectionSlugs: ["business", "news"],
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
        type: "data",
        url: feed.url,
        sectionIds,
        enabled: true,
      })
      inserted += 1
    }
    return { inserted, skipped, total: FEEDS.length }
  },
})

// Internal helper for the Phase-3 expansion seed. Shared by the
// public mutation below and by `seed.run` so a fresh deploy gets all
// expansion sources after one command.
type ExpansionFeed = {
  name: string
  type: "rss" | "reddit" | "youtube" | "bluesky" | "ics" | "events-html"
  url: string
  sectionSlugs: ReadonlyArray<string>
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
      {
        name: "Local 10 / WPLG (RSS)",
        type: "rss",
        url: "https://www.local10.com/arc/outboundfeeds/rss/?outputType=xml",
        sectionSlugs: ["news"],
        pollMinutes: 15,
      },
      {
        name: "NBC 6 South Florida (RSS)",
        type: "rss",
        url: "https://www.nbcmiami.com/?rss=y",
        sectionSlugs: ["news"],
        pollMinutes: 15,
      },
      {
        name: "CBS Miami (RSS)",
        type: "rss",
        url: "https://www.cbsnews.com/miami/local-news/rss/",
        sectionSlugs: ["news"],
        pollMinutes: 15,
      },

      // ─── Spanish-language ───
      {
        name: "Telemundo 51 (RSS)",
        type: "rss",
        url: "https://www.telemundo51.com/?rss=y",
        sectionSlugs: ["news"],
        pollMinutes: 30,
      },
      {
        name: "Diario Las Américas",
        type: "rss",
        url: "https://www.diariolasamericas.com/feed",
        sectionSlugs: ["news", "politics"],
        pollMinutes: 60,
      },
      {
        name: "El Nuevo Herald (Miami Herald ES)",
        type: "rss",
        url: "https://www.elnuevoherald.com/news/local/?widgetName=rssfeed&widgetContentId=712015&getXmlFeed=true",
        sectionSlugs: ["news"],
        pollMinutes: 30,
      },

      // ─── Hyperlocal blogs / city-level coverage ───
      {
        name: "Coral Gables Magazine",
        type: "rss",
        url: "https://coralgablesmagazine.com/feed/",
        sectionSlugs: ["news", "news"],
        pollMinutes: 240,
      },
      {
        name: "Brickell Magazine",
        type: "rss",
        url: "https://www.brickellmag.com/feed/",
        sectionSlugs: ["news", "news"],
        pollMinutes: 240,
      },
      {
        name: "The Next Miami",
        type: "rss",
        url: "https://www.thenextmiami.com/feed/",
        sectionSlugs: ["business", "real-estate"],
        pollMinutes: 120,
      },
      {
        name: "Miami Herald — Local News (RSS)",
        type: "rss",
        url: "https://www.miamiherald.com/news/local/?widgetName=rssfeed&widgetContentId=712015&getXmlFeed=true",
        sectionSlugs: ["news"],
        pollMinutes: 30,
      },
      {
        name: "Miami Herald — Sports",
        type: "rss",
        url: "https://www.miamiherald.com/sports/?widgetName=rssfeed&widgetContentId=712015&getXmlFeed=true",
        sectionSlugs: ["sports"],
        pollMinutes: 60,
      },
      {
        name: "Miami Herald — Business",
        type: "rss",
        url: "https://www.miamiherald.com/news/business/?widgetName=rssfeed&widgetContentId=712015&getXmlFeed=true",
        sectionSlugs: ["business"],
        pollMinutes: 60,
      },
      {
        name: "Miami Herald — Politics",
        type: "rss",
        url: "https://www.miamiherald.com/news/politics-government/?widgetName=rssfeed&widgetContentId=712015&getXmlFeed=true",
        sectionSlugs: ["politics", "news"],
        pollMinutes: 60,
      },

      // ─── University newsrooms ───
      {
        name: "FIU News",
        type: "rss",
        url: "https://news.fiu.edu/feed",
        sectionSlugs: ["education", "science", "news"],
        pollMinutes: 240,
      },
      {
        name: "University of Miami News",
        type: "rss",
        url: "https://news.miami.edu/feed.html",
        sectionSlugs: ["education", "science", "news", "the-u"],
        pollMinutes: 240,
      },

      // ─── Government press ───
      {
        name: "Miami-Dade County — News",
        type: "rss",
        url: "https://www.miamidade.gov/global/news/news-rss.aspx",
        sectionSlugs: ["politics", "news"],
        pollMinutes: 120,
      },
      {
        name: "City of Miami Beach — News",
        type: "rss",
        url: "https://www.miamibeachfl.gov/news-feed/",
        sectionSlugs: ["politics", "news"],
        pollMinutes: 240,
      },

      // ─── Sports — Miami franchises beyond ESPN ───
      {
        name: "Five Reasons Sports Network",
        type: "rss",
        url: "https://fivereasonssports.com/feed/",
        sectionSlugs: ["sports"],
        pollMinutes: 60,
      },
      {
        name: "All U Can Heat (Heat blog)",
        type: "rss",
        url: "https://allucanheat.com/feed/",
        sectionSlugs: ["sports", "heat"],
        pollMinutes: 120,
      },
      {
        name: "Phin Phanatic (Dolphins blog)",
        type: "rss",
        url: "https://phinphanatic.com/feed/",
        sectionSlugs: ["sports", "dolphins"],
        pollMinutes: 120,
      },
      {
        name: "Marlin Maniac",
        type: "rss",
        url: "https://marlinmaniac.com/feed/",
        sectionSlugs: ["sports", "marlins"],
        pollMinutes: 120,
      },

      // ─── Expanded subreddits ───
      {
        name: "r/Miami",
        type: "reddit",
        url: "https://www.reddit.com/r/Miami/.rss",
        sectionSlugs: ["news", "news"],
        pollMinutes: 30,
      },
      {
        name: "r/305",
        type: "reddit",
        url: "https://www.reddit.com/r/305/.rss",
        sectionSlugs: ["news", "news"],
        pollMinutes: 60,
      },
      {
        name: "r/CoralGables",
        type: "reddit",
        url: "https://www.reddit.com/r/CoralGables/.rss",
        sectionSlugs: ["news"],
        pollMinutes: 240,
      },
      {
        name: "r/MiamiHurricanes",
        type: "reddit",
        url: "https://www.reddit.com/r/miamihurricanes/.rss",
        sectionSlugs: ["sports", "the-u"],
        pollMinutes: 240,
      },
      {
        name: "r/MiamiHeat",
        type: "reddit",
        url: "https://www.reddit.com/r/heat/.rss",
        sectionSlugs: ["sports", "heat"],
        pollMinutes: 60,
      },
      {
        name: "r/Dolphins",
        type: "reddit",
        url: "https://www.reddit.com/r/miamidolphins/.rss",
        sectionSlugs: ["sports", "dolphins"],
        pollMinutes: 60,
      },
      {
        name: "r/InterMiamiCF",
        type: "reddit",
        url: "https://www.reddit.com/r/InterMiamiCF/.rss",
        sectionSlugs: ["sports", "soccer"],
        pollMinutes: 240,
      },
      {
        name: "r/SouthFlorida",
        type: "reddit",
        url: "https://www.reddit.com/r/SouthFlorida/.rss",
        sectionSlugs: ["news"],
        pollMinutes: 120,
      },

      // ─── Climate / environment / Everglades ───
      {
        name: "Everglades National Park (NPS)",
        type: "rss",
        url: "https://www.nps.gov/ever/learn/news/news.htm?feed=rss2",
        sectionSlugs: ["nature", "climate", "news"],
        pollMinutes: 240,
      },
      {
        name: "WLRN — Environment",
        type: "rss",
        url: "https://www.wlrn.org/section/environment.rss",
        sectionSlugs: ["climate", "nature", "news"],
        pollMinutes: 60,
      },

      // ─── Food / restaurants beyond Eater ───
      {
        name: "Burger Beast (Miami food blog)",
        type: "rss",
        url: "https://www.burgerbeast.com/feed/",
        sectionSlugs: ["food"],
        pollMinutes: 240,
      },
      {
        name: "Miami New Times — Food",
        type: "rss",
        url: "https://www.miaminewtimes.com/restaurants.rss",
        sectionSlugs: ["food"],
        pollMinutes: 60,
      },

      // ─── Arts / culture beyond Artburst ───
      {
        name: "Cultured Magazine",
        type: "rss",
        url: "https://www.culturedmag.com/feed/",
        sectionSlugs: ["arts"],
        pollMinutes: 240,
      },
  {
    name: "Pérez Art Museum Miami (PAMM) blog",
    type: "rss",
    url: "https://www.pamm.org/feed/",
    sectionSlugs: ["arts", "news"],
    pollMinutes: 240,
  },

  // ─── Bluesky accounts (public posts via app.bsky.feed.getAuthorFeed) ───
  // Source URLs follow the convention `bluesky://<handle>`; the adapter
  // extracts the handle and queries the public AppView.
  {
    name: "Miami Herald (Bluesky)",
    type: "bluesky",
    url: "bluesky://miamiherald.com",
    sectionSlugs: ["news"],
    pollMinutes: 30,
  },
  {
    name: "WLRN (Bluesky)",
    type: "bluesky",
    url: "bluesky://wlrn.org",
    sectionSlugs: ["news", "politics"],
    pollMinutes: 60,
  },
  {
    name: "Miami New Times (Bluesky)",
    type: "bluesky",
    url: "bluesky://miaminewtimes.com",
    sectionSlugs: ["news", "food", "arts"],
    pollMinutes: 60,
  },

  // ─── Round-2 expansion (target: ~doubling source count) ───
  // Local TV — second-string anchors / weather + traffic accounts
  {
    name: "WSVN — Miami (RSS)",
    type: "rss",
    url: "https://wsvn.com/category/news/local/feed/",
    sectionSlugs: ["news"],
    pollMinutes: 30,
  },
  {
    name: "NBC 6 — Miami-Dade (RSS)",
    type: "rss",
    url: "https://www.nbcmiami.com/news/local/?rss=y",
    sectionSlugs: ["news"],
    pollMinutes: 30,
  },
  {
    name: "Local 10 — Politics (RSS)",
    type: "rss",
    url: "https://www.local10.com/arc/outboundfeeds/rss/category/politics/?outputType=xml",
    sectionSlugs: ["politics", "news"],
    pollMinutes: 60,
  },
  {
    name: "Local 10 — Weather (RSS)",
    type: "rss",
    url: "https://www.local10.com/arc/outboundfeeds/rss/category/weather/?outputType=xml",
    sectionSlugs: ["weather", "climate", "news"],
    pollMinutes: 30,
  },

  // Climate / hurricanes — high-cadence in season
  {
    name: "National Hurricane Center (RSS)",
    type: "rss",
    url: "https://www.nhc.noaa.gov/index-at.xml",
    sectionSlugs: ["weather", "climate", "news"],
    pollMinutes: 30,
  },
  {
    name: "NOAA Climate.gov — News",
    type: "rss",
    url: "https://www.climate.gov/news-features/feed",
    sectionSlugs: ["climate"],
    pollMinutes: 240,
  },
  {
    name: "South Florida Water Management District (RSS)",
    type: "rss",
    url: "https://www.sfwmd.gov/news/rss",
    sectionSlugs: ["climate", "nature", "politics"],
    pollMinutes: 240,
  },

  // Real-estate / business beyond The Real Deal
  {
    name: "South Florida Business Journal",
    type: "rss",
    url: "https://www.bizjournals.com/southflorida/news/rss.xml",
    sectionSlugs: ["business", "real-estate"],
    pollMinutes: 60,
  },
  {
    name: "Miami Eater — Real Estate",
    type: "rss",
    url: "https://miami.eater.com/rss/index.xml",
    sectionSlugs: ["food"],
    pollMinutes: 240,
  },
  {
    name: "Miami Curbed (housing)",
    type: "rss",
    url: "https://miami.curbed.com/rss/index.xml",
    sectionSlugs: ["real-estate"],
    pollMinutes: 240,
  },

  // Politics / accountability
  {
    name: "Florida Phoenix",
    type: "rss",
    url: "https://floridaphoenix.com/feed/",
    sectionSlugs: ["politics", "news"],
    pollMinutes: 60,
  },
  {
    name: "Florida Politics",
    type: "rss",
    url: "https://floridapolitics.com/feed/",
    sectionSlugs: ["politics"],
    pollMinutes: 60,
  },
  {
    name: "Sun Sentinel — Florida (RSS)",
    type: "rss",
    url: "https://www.sun-sentinel.com/news/politics/feed/",
    sectionSlugs: ["politics", "news"],
    pollMinutes: 60,
  },

  // Arts / culture / music
  {
    name: "Miami New Times — Music",
    type: "rss",
    url: "https://www.miaminewtimes.com/music.rss",
    sectionSlugs: ["music", "arts"],
    pollMinutes: 60,
  },
  {
    name: "Miami New Times — Arts",
    type: "rss",
    url: "https://www.miaminewtimes.com/arts.rss",
    sectionSlugs: ["arts", "galleries"],
    pollMinutes: 60,
  },
  {
    name: "Miami Symphony Orchestra",
    type: "rss",
    url: "https://miamisymphony.org/feed/",
    sectionSlugs: ["music", "arts"],
    pollMinutes: 240,
  },
  {
    name: "New World Symphony (Miami Beach)",
    type: "rss",
    url: "https://www.nws.edu/feed/",
    sectionSlugs: ["music", "arts"],
    pollMinutes: 240,
  },

  // Food beyond Eater / Burger Beast
  {
    name: "Tasting Table — Florida",
    type: "rss",
    url: "https://www.tastingtable.com/rss/category/florida",
    sectionSlugs: ["food"],
    pollMinutes: 240,
  },
  {
    name: "Time Out Miami",
    type: "rss",
    url: "https://www.timeout.com/miami/feed",
    sectionSlugs: ["food", "news", "arts"],
    pollMinutes: 60,
  },

  // Health / public health
  {
    name: "Florida Department of Health (RSS)",
    type: "rss",
    url: "https://www.floridahealth.gov/_documents/newsroom/news-releases/news-releases-feed.xml",
    sectionSlugs: ["health", "news"],
    pollMinutes: 240,
  },

  // Education
  {
    name: "Miami-Dade County Public Schools",
    type: "rss",
    url: "https://www.dadeschools.net/news/rss",
    sectionSlugs: ["education", "news"],
    pollMinutes: 240,
  },

  // Transportation / infrastructure
  {
    name: "Transit Alliance Miami",
    type: "rss",
    url: "https://transitalliance.miami/feed/",
    sectionSlugs: ["transit", "news"],
    pollMinutes: 240,
  },

  // Aviation (MIA / FLL hubs are major Miami stories)
  {
    name: "Miami International Airport — News",
    type: "rss",
    url: "https://news.miami-airport.com/rss",
    sectionSlugs: ["news", "business"],
    pollMinutes: 240,
  },

  // Cruise / port
  {
    name: "Cruise Industry News — Miami",
    type: "rss",
    url: "https://www.cruiseindustrynews.com/feed/",
    sectionSlugs: ["business", "news"],
    pollMinutes: 240,
  },

  // Hispanic / Latin culture
  {
    name: "El Venezolano News",
    type: "rss",
    url: "https://elvenezolanonews.com/feed/",
    sectionSlugs: ["news", "politics"],
    pollMinutes: 60,
  },
  {
    name: "Mundo Hispano (US)",
    type: "rss",
    url: "https://mundohispanico.com/feed/",
    sectionSlugs: ["news"],
    pollMinutes: 240,
  },

  // Sports — additional Miami-franchise blogs
  {
    name: "Hot Hot Hoops (Heat blog)",
    type: "rss",
    url: "https://www.hothothoops.com/rss/index.xml",
    sectionSlugs: ["sports", "heat"],
    pollMinutes: 120,
  },
  {
    name: "The Phinsider (Dolphins blog)",
    type: "rss",
    url: "https://www.thephinsider.com/rss/index.xml",
    sectionSlugs: ["sports", "dolphins"],
    pollMinutes: 120,
  },
  {
    name: "Fish Stripes (Marlins blog)",
    type: "rss",
    url: "https://www.fishstripes.com/rss/index.xml",
    sectionSlugs: ["sports", "marlins"],
    pollMinutes: 120,
  },
  {
    name: "State of the U (UM Hurricanes blog)",
    type: "rss",
    url: "https://www.stateoftheu.com/rss/index.xml",
    sectionSlugs: ["sports", "the-u"],
    pollMinutes: 120,
  },

  // Civic / county-level Bluesky
  {
    name: "Local 10 (Bluesky)",
    type: "bluesky",
    url: "bluesky://local10.com",
    sectionSlugs: ["news"],
    pollMinutes: 30,
  },
  {
    name: "NBC 6 Miami (Bluesky)",
    type: "bluesky",
    url: "bluesky://nbcmiami.com",
    sectionSlugs: ["news"],
    pollMinutes: 30,
  },
  {
    name: "Florida Phoenix (Bluesky)",
    type: "bluesky",
    url: "bluesky://floridaphoenix.com",
    sectionSlugs: ["politics", "news"],
    pollMinutes: 60,
  },

  // YouTube — second-string locals + niche
  {
    name: "Univision Noticias (YouTube)",
    type: "youtube",
    url: "@UnivisionNoticias",
    sectionSlugs: ["news"],
    pollMinutes: 60,
  },
  {
    name: "WPLG Local 10 — Investigators (YouTube)",
    type: "youtube",
    url: "@Local10News",
    sectionSlugs: ["news", "politics"],
    pollMinutes: 60,
  },
  {
    name: "Miami New Times (YouTube)",
    type: "youtube",
    url: "@miaminewtimes",
    sectionSlugs: ["news", "food", "arts"],
    pollMinutes: 240,
  },
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
  {
    name: "Local 10 — Sports (RSS)",
    type: "rss",
    url: "https://www.local10.com/arc/outboundfeeds/rss/category/sports/?outputType=xml",
    sectionSlugs: ["sports"],
    pollMinutes: 30,
  },
  {
    name: "Local 10 — Money (RSS)",
    type: "rss",
    url: "https://www.local10.com/arc/outboundfeeds/rss/category/money/?outputType=xml",
    sectionSlugs: ["business", "real-estate"],
    pollMinutes: 60,
  },
  {
    name: "Local 10 — Entertainment (RSS)",
    type: "rss",
    url: "https://www.local10.com/arc/outboundfeeds/rss/category/entertainment/?outputType=xml",
    sectionSlugs: ["arts", "music", "food"],
    pollMinutes: 60,
  },
  {
    name: "NBC 6 — Sports (RSS)",
    type: "rss",
    url: "https://www.nbcmiami.com/news/sports/?rss=y",
    sectionSlugs: ["sports"],
    pollMinutes: 30,
  },
  {
    name: "NBC 6 — Entertainment (RSS)",
    type: "rss",
    url: "https://www.nbcmiami.com/entertainment/?rss=y",
    sectionSlugs: ["arts", "music"],
    pollMinutes: 60,
  },
  {
    name: "NBC 6 — Weather (RSS)",
    type: "rss",
    url: "https://www.nbcmiami.com/news/weather/?rss=y",
    sectionSlugs: ["climate", "news"],
    pollMinutes: 30,
  },

  // ─── Telemundo 51 verticals ───
  {
    name: "Telemundo 51 — Política (RSS)",
    type: "rss",
    url: "https://www.telemundo51.com/noticias/politica/?rss=y",
    sectionSlugs: ["politics", "news"],
    pollMinutes: 60,
  },
  {
    name: "Telemundo 51 — Deportes (RSS)",
    type: "rss",
    url: "https://www.telemundo51.com/deportes/?rss=y",
    sectionSlugs: ["sports"],
    pollMinutes: 60,
  },
  {
    name: "Telemundo 51 — Local (RSS)",
    type: "rss",
    url: "https://www.telemundo51.com/noticias/local/?rss=y",
    sectionSlugs: ["news"],
    pollMinutes: 30,
  },

  // ─── Hyperlocal blogs ───
  {
    name: "Refresh Miami",
    type: "rss",
    url: "https://refreshmiami.com/feed/",
    sectionSlugs: ["business", "news"],
    pollMinutes: 120,
  },
  {
    name: "Coconut Grove Spotlight",
    type: "rss",
    url: "https://www.coconutgrovespotlight.com/feed",
    sectionSlugs: ["news"],
    pollMinutes: 240,
  },
  {
    name: "Edible South Florida",
    type: "rss",
    url: "https://ediblesouthflorida.ediblecommunities.com/feed",
    sectionSlugs: ["food"],
    pollMinutes: 240,
  },

  // ─── Cultural institutions ───
  {
    name: "Bass Museum of Art",
    type: "rss",
    url: "https://thebass.org/feed/",
    sectionSlugs: ["arts"],
    pollMinutes: 240,
  },
  {
    name: "Vizcaya Museum & Gardens",
    type: "rss",
    url: "https://vizcaya.org/feed/",
    sectionSlugs: ["arts", "things-to-do"],
    pollMinutes: 240,
  },
  {
    name: "Pérez Art Museum Miami — Events",
    type: "rss",
    url: "https://www.pamm.org/en/events/feed/",
    sectionSlugs: ["arts"],
    pollMinutes: 240,
  },
  {
    name: "Miami New Drama",
    type: "rss",
    url: "https://www.miaminewdrama.org/feed/",
    sectionSlugs: ["arts", "theater"],
    pollMinutes: 240,
  },
  {
    name: "Miami Light Project",
    type: "rss",
    url: "https://miamilightproject.com/feed/",
    sectionSlugs: ["arts", "music"],
    pollMinutes: 240,
  },
  {
    name: "Miami Theater Center",
    type: "rss",
    url: "https://www.mtcmiami.org/feed/",
    sectionSlugs: ["arts", "theater"],
    pollMinutes: 240,
  },
  {
    name: "Coral Gables Art Cinema",
    type: "rss",
    url: "https://gablescinema.com/feed/",
    sectionSlugs: ["arts", "film"],
    pollMinutes: 240,
  },

  // ─── Investigations ───
  {
    name: "Florida Bulldog",
    type: "rss",
    url: "https://www.floridabulldog.org/feed/",
    sectionSlugs: ["news", "investigations"],
    pollMinutes: 120,
  },
  {
    name: "Florida Bulldog — Government",
    type: "rss",
    url: "https://www.floridabulldog.org/category/government/feed/",
    sectionSlugs: ["politics", "investigations"],
    pollMinutes: 120,
  },

  // ─── Real estate / business ───
  {
    name: "Miami Worldcenter",
    type: "rss",
    url: "https://miamiworldcenter.com/feed/",
    sectionSlugs: ["real-estate", "business"],
    pollMinutes: 240,
  },
  {
    name: "Miami New Times",
    type: "rss",
    url: "https://www.miaminewtimes.com/feed",
    sectionSlugs: ["news", "food", "arts"],
    pollMinutes: 60,
  },

  // ─── Sports — additional Heat blog ───
  {
    name: "Heat Nation",
    type: "rss",
    url: "https://heatnation.com/feed/",
    sectionSlugs: ["sports", "heat"],
    pollMinutes: 60,
  },
  {
    name: "Hot Hot Hoops (Heat blog) — fixed URL",
    type: "rss",
    url: "https://www.hothothoops.com/feed/",
    sectionSlugs: ["sports", "heat"],
    pollMinutes: 60,
  },

  // ─── Bluesky (verified handles) ───
  {
    name: "Telemundo 51 (Bluesky)",
    type: "bluesky",
    url: "bluesky://telemundo51.com",
    sectionSlugs: ["news"],
    pollMinutes: 30,
  },
  {
    name: "Inter Miami CF (Bluesky)",
    type: "bluesky",
    url: "bluesky://intermiamicf.bsky.social",
    sectionSlugs: ["sports", "soccer"],
    pollMinutes: 60,
  },
  {
    name: "Miami Heat (Bluesky)",
    type: "bluesky",
    url: "bluesky://miamiheat.bsky.social",
    sectionSlugs: ["sports", "heat"],
    pollMinutes: 60,
  },
  {
    name: "Doug Hanks — Miami Herald (Bluesky)",
    type: "bluesky",
    url: "bluesky://doughanks.bsky.social",
    sectionSlugs: ["politics", "news"],
    pollMinutes: 60,
  },
  {
    name: "Daniel Rivero — WLRN (Bluesky)",
    type: "bluesky",
    url: "bluesky://danielrivero.bsky.social",
    sectionSlugs: ["news", "politics"],
    pollMinutes: 60,
  },
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
  {
    name: "WSVN — Local",
    type: "rss",
    url: "https://wsvn.com/category/news/local/feed/",
    sectionSlugs: ["news"],
    pollMinutes: 30,
  },
  {
    name: "WSVN — Sports",
    type: "rss",
    url: "https://wsvn.com/category/sports/feed/",
    sectionSlugs: ["sports"],
    pollMinutes: 60,
  },
  {
    name: "WSVN — Entertainment",
    type: "rss",
    url: "https://wsvn.com/category/entertainment/feed/",
    sectionSlugs: ["arts", "music"],
    pollMinutes: 60,
  },
  {
    name: "WSVN — Lifestyle",
    type: "rss",
    url: "https://wsvn.com/category/lifestyle/feed/",
    sectionSlugs: ["food", "things-to-do"],
    pollMinutes: 120,
  },

  // ─── More TV vertical / aggregated feeds ───
  {
    name: "NBC 6 — News (root)",
    type: "rss",
    url: "https://www.nbcmiami.com/news/?rss=y",
    sectionSlugs: ["news"],
    pollMinutes: 30,
  },
  {
    name: "NBC 6 — National & International",
    type: "rss",
    url: "https://www.nbcmiami.com/news/national-international/?rss=y",
    sectionSlugs: ["news"],
    pollMinutes: 60,
  },
  {
    name: "Local 10 — News (category)",
    type: "rss",
    url: "https://www.local10.com/arc/outboundfeeds/rss/category/news/?outputType=xml",
    sectionSlugs: ["news"],
    pollMinutes: 30,
  },
  {
    name: "Local 10 — Real Estate",
    type: "rss",
    url: "https://www.local10.com/arc/outboundfeeds/rss/category/real-estate/?outputType=xml",
    sectionSlugs: ["real-estate", "business"],
    pollMinutes: 120,
  },

  // ─── University ───
  {
    name: "University of Miami Hurricanes Athletics",
    type: "rss",
    url: "https://miamihurricanes.com/feed/",
    sectionSlugs: ["sports", "the-u"],
    pollMinutes: 60,
  },
  {
    name: "Miami Hurricanes Football",
    type: "rss",
    url: "https://miamihurricanes.com/sports/football/feed/",
    sectionSlugs: ["sports", "the-u"],
    pollMinutes: 60,
  },
  {
    name: "Miami Hurricane (paper) — Sports",
    type: "rss",
    url: "https://themiamihurricane.com/category/sports/feed/",
    sectionSlugs: ["sports", "the-u"],
    pollMinutes: 240,
  },

  // ─── Science / health ───
  {
    name: "UM Health News",
    type: "rss",
    url: "https://news.med.miami.edu/feed/",
    sectionSlugs: ["health", "science", "news"],
    pollMinutes: 240,
  },
  {
    name: "FIU Research",
    type: "rss",
    url: "https://research.fiu.edu/feed/",
    sectionSlugs: ["science", "education"],
    pollMinutes: 240,
  },
  {
    name: "Florida Department of Health (press)",
    type: "rss",
    url: "https://www.floridahealth.gov/newsroom/feed/",
    sectionSlugs: ["health", "news"],
    pollMinutes: 240,
  },
  {
    name: "Miami Climate Alliance",
    type: "rss",
    url: "https://miamiclimatealliance.org/feed/",
    sectionSlugs: ["climate", "news"],
    pollMinutes: 240,
  },

  // ─── Venues / events ───
  {
    name: "Hard Rock Stadium",
    type: "rss",
    url: "https://www.hardrockstadium.com/feed/",
    sectionSlugs: ["sports", "music", "things-to-do"],
    pollMinutes: 240,
  },
  {
    name: "James L. Knight Center",
    type: "rss",
    url: "https://jlkc.com/feed/",
    sectionSlugs: ["arts", "music", "things-to-do"],
    pollMinutes: 240,
  },
  {
    name: "Wynwood Walls",
    type: "rss",
    url: "https://thewynwoodwalls.com/feed/",
    sectionSlugs: ["arts", "things-to-do"],
    pollMinutes: 240,
  },
  {
    name: "III Points Festival",
    type: "rss",
    url: "https://iiipoints.com/feed/",
    sectionSlugs: ["music", "things-to-do"],
    pollMinutes: 240,
  },

  // ─── Food / lifestyle ───
  {
    name: "Tasting Table",
    type: "rss",
    url: "https://www.tastingtable.com/rss",
    sectionSlugs: ["food"],
    pollMinutes: 120,
  },
  {
    name: "Pincho Foodie",
    type: "rss",
    url: "https://pincho.com/feed/",
    sectionSlugs: ["food"],
    pollMinutes: 240,
  },

  // ─── Hyperlocal / regional ───
  {
    name: "Aventura Magazine",
    type: "rss",
    url: "https://aventuramagazine.com/feed/",
    sectionSlugs: ["news", "things-to-do"],
    pollMinutes: 240,
  },
  {
    name: "South Florida Reporter",
    type: "rss",
    url: "https://southfloridareporter.com/feed/",
    sectionSlugs: ["news"],
    pollMinutes: 120,
  },
  {
    name: "Coral Gables Newsletter",
    type: "rss",
    url: "https://feeds.feedburner.com/coralgables",
    sectionSlugs: ["news"],
    pollMinutes: 240,
  },

  // ─── Podcasts (RSS-as-audio) ───
  {
    name: "Florida Politics Podcast",
    type: "rss",
    url: "https://feeds.feedburner.com/floridapolitics",
    sectionSlugs: ["politics"],
    pollMinutes: 240,
  },
  {
    name: "Miami Herald 305 Podcast",
    type: "rss",
    url: "https://feeds.npr.org/510310/podcast.xml",
    sectionSlugs: ["news"],
    pollMinutes: 240,
  },

  // ─── Bluesky accounts (verified handles) ───
  {
    name: "WLRN (Bluesky org)",
    type: "bluesky",
    url: "bluesky://wlrn.bsky.social",
    sectionSlugs: ["news", "politics"],
    pollMinutes: 60,
  },
  {
    name: "Florida Politics (Bluesky)",
    type: "bluesky",
    url: "bluesky://floridapolitics.bsky.social",
    sectionSlugs: ["politics"],
    pollMinutes: 60,
  },
  {
    name: "Miami Marlins (Bluesky)",
    type: "bluesky",
    url: "bluesky://marlins.bsky.social",
    sectionSlugs: ["sports", "marlins"],
    pollMinutes: 120,
  },
  {
    name: "Florida Panthers (Bluesky)",
    type: "bluesky",
    url: "bluesky://nhlpanthers.bsky.social",
    sectionSlugs: ["sports", "panthers"],
    pollMinutes: 120,
  },
  {
    name: "Heat Nation (Bluesky)",
    type: "bluesky",
    url: "bluesky://heatnation.bsky.social",
    sectionSlugs: ["sports", "heat"],
    pollMinutes: 120,
  },
  {
    name: "Annie Martin (Bluesky)",
    type: "bluesky",
    url: "bluesky://anniemartin.bsky.social",
    sectionSlugs: ["news"],
    pollMinutes: 120,
  },
  {
    name: "Casey Frank (Bluesky)",
    type: "bluesky",
    url: "bluesky://caseyfrank.bsky.social",
    sectionSlugs: ["politics", "news"],
    pollMinutes: 120,
  },
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
  {
    name: "Local 10 — Travel",
    type: "rss",
    url: "https://www.local10.com/arc/outboundfeeds/rss/category/travel/?outputType=xml",
    sectionSlugs: ["things-to-do"],
    pollMinutes: 240,
  },
  {
    name: "Local 10 — Tech",
    type: "rss",
    url: "https://www.local10.com/arc/outboundfeeds/rss/category/tech/?outputType=xml",
    sectionSlugs: ["business", "science"],
    pollMinutes: 240,
  },
  {
    name: "Local 10 — Health",
    type: "rss",
    url: "https://www.local10.com/arc/outboundfeeds/rss/category/health/?outputType=xml",
    sectionSlugs: ["health", "science"],
    pollMinutes: 120,
  },
  {
    name: "Local 10 — Lifestyle",
    type: "rss",
    url: "https://www.local10.com/arc/outboundfeeds/rss/category/lifestyle/?outputType=xml",
    sectionSlugs: ["food", "things-to-do"],
    pollMinutes: 240,
  },
  {
    name: "Local 10 — Food",
    type: "rss",
    url: "https://www.local10.com/arc/outboundfeeds/rss/category/food/?outputType=xml",
    sectionSlugs: ["food"],
    pollMinutes: 240,
  },
  {
    name: "Local 10 — Pets",
    type: "rss",
    url: "https://www.local10.com/arc/outboundfeeds/rss/category/pets/?outputType=xml",
    sectionSlugs: ["nature"],
    pollMinutes: 240,
  },
  {
    name: "Local 10 — Education",
    type: "rss",
    url: "https://www.local10.com/arc/outboundfeeds/rss/category/education/?outputType=xml",
    sectionSlugs: ["education"],
    pollMinutes: 120,
  },

  // ─── NBC 6 sub-verticals ───
  {
    name: "NBC 6 — Health",
    type: "rss",
    url: "https://www.nbcmiami.com/news/health/?rss=y",
    sectionSlugs: ["health"],
    pollMinutes: 120,
  },
  {
    name: "NBC 6 — Politics",
    type: "rss",
    url: "https://www.nbcmiami.com/news/politics/?rss=y",
    sectionSlugs: ["politics"],
    pollMinutes: 60,
  },
  {
    name: "NBC 6 — Investigations",
    type: "rss",
    url: "https://www.nbcmiami.com/investigations/?rss=y",
    sectionSlugs: ["news", "investigations"],
    pollMinutes: 120,
  },
  {
    name: "NBC 6 — Education",
    type: "rss",
    url: "https://www.nbcmiami.com/news/education/?rss=y",
    sectionSlugs: ["education"],
    pollMinutes: 120,
  },
  {
    name: "NBC 6 — Real Estate",
    type: "rss",
    url: "https://www.nbcmiami.com/news/real-estate/?rss=y",
    sectionSlugs: ["real-estate", "business"],
    pollMinutes: 120,
  },

  // ─── WSVN sub-verticals ───
  {
    name: "WSVN — Politics",
    type: "rss",
    url: "https://wsvn.com/category/politics/feed/",
    sectionSlugs: ["politics"],
    pollMinutes: 60,
  },
  {
    name: "WSVN — Health",
    type: "rss",
    url: "https://wsvn.com/category/health/feed/",
    sectionSlugs: ["health"],
    pollMinutes: 120,
  },
  {
    name: "WSVN — Investigations",
    type: "rss",
    url: "https://wsvn.com/category/investigations/feed/",
    sectionSlugs: ["news", "investigations"],
    pollMinutes: 120,
  },
  {
    name: "WSVN — Travel",
    type: "rss",
    url: "https://wsvn.com/category/travel/feed/",
    sectionSlugs: ["things-to-do"],
    pollMinutes: 240,
  },
  {
    name: "WSVN — Food",
    type: "rss",
    url: "https://wsvn.com/category/food/feed/",
    sectionSlugs: ["food"],
    pollMinutes: 120,
  },
  {
    name: "WSVN — Education",
    type: "rss",
    url: "https://wsvn.com/category/education/feed/",
    sectionSlugs: ["education"],
    pollMinutes: 120,
  },
  {
    name: "WSVN — Weather",
    type: "rss",
    url: "https://wsvn.com/category/weather/feed/",
    sectionSlugs: ["climate"],
    pollMinutes: 60,
  },

  // ─── Telemundo 51 verticals ───
  {
    name: "Telemundo 51 — Salud",
    type: "rss",
    url: "https://www.telemundo51.com/salud/?rss=y",
    sectionSlugs: ["health"],
    pollMinutes: 120,
  },
  {
    name: "Telemundo 51 — Entretenimiento",
    type: "rss",
    url: "https://www.telemundo51.com/entretenimiento/?rss=y",
    sectionSlugs: ["arts", "music"],
    pollMinutes: 120,
  },
  {
    name: "Telemundo 51 — Estilo",
    type: "rss",
    url: "https://www.telemundo51.com/estilo/?rss=y",
    sectionSlugs: ["food", "things-to-do"],
    pollMinutes: 240,
  },
  {
    name: "Telemundo 51 — Gente",
    type: "rss",
    url: "https://www.telemundo51.com/gente/?rss=y",
    sectionSlugs: ["news"],
    pollMinutes: 120,
  },

  // ─── Hyperlocal Miami neighborhoods ───
  {
    name: "Gables Insider",
    type: "rss",
    url: "https://gablesinsider.com/feed/",
    sectionSlugs: ["news"],
    pollMinutes: 240,
  },
  {
    name: "Calle Ocho News (Little Havana)",
    type: "rss",
    url: "https://www.calleochonews.com/feed/",
    sectionSlugs: ["news", "things-to-do"],
    pollMinutes: 240,
  },
  {
    name: "Doral Family Journal",
    type: "rss",
    url: "https://doralfamilyjournal.com/feed/",
    sectionSlugs: ["news"],
    pollMinutes: 240,
  },
  {
    name: "Key Biscayne Magazine",
    type: "rss",
    url: "https://keybiscaynemag.com/feed/",
    sectionSlugs: ["news", "things-to-do"],
    pollMinutes: 240,
  },
  {
    name: "Miami Geographic",
    type: "rss",
    url: "https://miamigeographic.com/feed/",
    sectionSlugs: ["news", "miami-history"],
    pollMinutes: 240,
  },

  // ─── Events / lifestyle ───
  {
    name: "Soul of Miami (events)",
    type: "rss",
    url: "https://www.soulofmiami.org/feed/",
    sectionSlugs: ["things-to-do", "music"],
    pollMinutes: 60,
  },
  {
    name: "Miami Mom Collective",
    type: "rss",
    url: "https://miamimomcollective.com/feed/",
    sectionSlugs: ["things-to-do"],
    pollMinutes: 240,
  },

  // ─── Health / hospitals ───
  {
    name: "South Florida Hospital News",
    type: "rss",
    url: "https://southfloridahospitalnews.com/feed/",
    sectionSlugs: ["health"],
    pollMinutes: 240,
  },

  // ─── University sports ───
  {
    name: "FIU Athletics",
    type: "rss",
    url: "https://fiusports.com/rss.aspx?path=general",
    sectionSlugs: ["sports", "the-u"],
    pollMinutes: 120,
  },
  {
    name: "Miami Hurricanes — Basketball",
    type: "rss",
    url: "https://miamihurricanes.com/sports/m-baskbl/feed/",
    sectionSlugs: ["sports", "the-u"],
    pollMinutes: 120,
  },

  // ─── Pro sports ───
  {
    name: "Miami Marlins (MLB official)",
    type: "rss",
    url: "https://www.mlb.com/feeds/news/rss.xml?team_id=146",
    sectionSlugs: ["sports", "marlins"],
    pollMinutes: 60,
  },

  // ─── Climate / nature (Miami-relevant only) ───
  {
    name: "Sea Level Rise — Florida",
    type: "rss",
    url: "https://sealevelrise.org/states/florida/feed/",
    sectionSlugs: ["climate"],
    pollMinutes: 240,
  },
  {
    name: "Bonefish & Tarpon Trust",
    type: "rss",
    url: "https://www.bonefishtarpontrust.org/feed/",
    sectionSlugs: ["nature", "climate"],
    pollMinutes: 240,
  },

  // ─── Bluesky journos / orgs (verified handles) ───
  {
    name: "Aaron Liebowitz (Bluesky)",
    type: "bluesky",
    url: "bluesky://aaronliebowitz.bsky.social",
    sectionSlugs: ["news"],
    pollMinutes: 120,
  },
  {
    name: "Jay Weaver — Miami Herald (Bluesky)",
    type: "bluesky",
    url: "bluesky://jayweaver.bsky.social",
    sectionSlugs: ["news", "investigations"],
    pollMinutes: 120,
  },
  {
    name: "Linda Robertson — Miami Herald (Bluesky)",
    type: "bluesky",
    url: "bluesky://lindarobertson.bsky.social",
    sectionSlugs: ["news", "sports"],
    pollMinutes: 120,
  },
  {
    name: "Calle Ocho News (Bluesky)",
    type: "bluesky",
    url: "bluesky://calleocho.bsky.social",
    sectionSlugs: ["news", "things-to-do"],
    pollMinutes: 240,
  },
  {
    name: "Miami-Dade County (Bluesky)",
    type: "bluesky",
    url: "bluesky://miamidade.bsky.social",
    sectionSlugs: ["politics", "news"],
    pollMinutes: 120,
  },
  {
    name: "City of Miami Beach (Bluesky)",
    type: "bluesky",
    url: "bluesky://miamibeach.bsky.social",
    sectionSlugs: ["politics", "news"],
    pollMinutes: 120,
  },
  {
    name: "City of Coral Gables (Bluesky)",
    type: "bluesky",
    url: "bluesky://coralgables.bsky.social",
    sectionSlugs: ["news"],
    pollMinutes: 240,
  },
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
  {
    name: "University of Miami — events (iCal)",
    type: "ics",
    url: "https://events.miami.edu/calendar.ics",
    sectionSlugs: ["the-u", "arts"],
    pollMinutes: 360,
  },
  {
    name: "University of Miami — events (RSS)",
    type: "rss",
    url: "https://events.miami.edu/calendar.xml",
    sectionSlugs: ["the-u", "news"],
    pollMinutes: 360,
  },
  {
    name: "FIU — events calendar",
    type: "rss",
    url: "https://calendar.fiu.edu/calendar.xml",
    sectionSlugs: ["news", "arts"],
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
  {
    name: "Village of El Portal (RSS)",
    type: "rss",
    url: "https://elportalvillage.com/feed/",
    sectionSlugs: ["news"],
    pollMinutes: 360,
  },
  {
    name: "Village of Virginia Gardens (RSS)",
    type: "rss",
    url: "https://www.virginiagardens-fl.gov/feed/",
    sectionSlugs: ["news"],
    pollMinutes: 360,
  },

  // ─── Neighborhood / district magazines ───
  {
    name: "Coconut Grove (RSS)",
    type: "rss",
    url: "https://www.coconutgrove.com/feed/",
    sectionSlugs: ["news", "arts"],
    pollMinutes: 240,
  },
  {
    name: "Coral Gables Art Festival",
    type: "rss",
    url: "https://www.cgaf.com/feed/",
    sectionSlugs: ["arts"],
    pollMinutes: 240,
  },

  // ─── Civic / chamber / foundation calendars ───
  {
    name: "Miami Beach Chamber",
    type: "rss",
    url: "https://www.miamibeachchamber.com/feed/",
    sectionSlugs: ["business"],
    pollMinutes: 240,
  },
  {
    name: "The Miami Foundation",
    type: "rss",
    url: "https://miamifoundation.org/feed/",
    sectionSlugs: ["news", "business"],
    pollMinutes: 240,
  },
  {
    name: "Knight Foundation (Miami HQ)",
    type: "rss",
    url: "https://www.knightfoundation.org/feed/",
    sectionSlugs: ["news", "business"],
    pollMinutes: 240,
  },
  {
    name: "Endeavor Miami",
    type: "rss",
    url: "https://endeavormiami.org/feed/",
    sectionSlugs: ["business"],
    pollMinutes: 240,
  },
  {
    name: "CIC Miami",
    type: "rss",
    url: "https://www.cic.com/feed/?location=miami",
    sectionSlugs: ["business"],
    pollMinutes: 240,
  },

  // ─── Arts / music / theater / books verticals ───
  {
    name: "YoungArts (blog)",
    type: "rss",
    url: "https://youngarts.org/feed/",
    sectionSlugs: ["arts"],
    pollMinutes: 240,
  },
  {
    name: "Miami Jazz Society",
    type: "rss",
    url: "https://www.miamijazzsociety.com/feed/",
    sectionSlugs: ["music"],
    pollMinutes: 240,
  },
  {
    name: "AIGA Miami (design events)",
    type: "rss",
    url: "https://miami.aiga.org/feed/",
    sectionSlugs: ["arts"],
    pollMinutes: 240,
  },
  {
    name: "Miami Book Fair",
    type: "rss",
    url: "https://miamibookfair.com/feed/",
    sectionSlugs: ["books", "arts"],
    pollMinutes: 240,
  },

  // ─── Sports calendars ───
  {
    name: "Miami Open (tennis)",
    type: "rss",
    url: "https://www.miamiopen.com/feed/",
    sectionSlugs: ["sports"],
    pollMinutes: 240,
  },

  // ─── Things-to-do magazines (general-interest events) ───
  {
    name: "Universe Miami — events",
    type: "rss",
    url: "https://www.universemiami.com/?feed=rss2",
    sectionSlugs: ["arts", "music"],
    pollMinutes: 240,
  },
  {
    name: "The Atlantic Current",
    type: "rss",
    url: "https://www.theatlanticcurrent.com/feed/",
    sectionSlugs: ["arts", "news"],
    pollMinutes: 240,
  },
]

export const seedExpansionSourcesV5 = internalMutation({
  args: {},
  handler: async (ctx) => installExpansionSources(ctx, EXPANSION_FEEDS_V5),
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
