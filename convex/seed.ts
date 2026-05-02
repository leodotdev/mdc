import { internalMutation } from "./_generated/server"
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
    description: "Local news from across Miami-Dade.",
    accentColor: "oklch(0.577 0.245 27.325)", // red-600
    order: 10,
  },
  {
    slug: "politics",
    name: "Politics",
    description: "City Hall, county commission, Tallahassee.",
    accentColor: "oklch(0.586 0.253 17.585)", // rose-600
    order: 20,
    parentSlug: "news",
  },
  {
    slug: "business",
    name: "Business",
    description: "Real estate, tech, hospitality, the port.",
    accentColor: "oklch(0.596 0.145 163.225)", // emerald-600
    order: 30,
  },
  {
    slug: "real-estate",
    name: "Real Estate",
    description: "Sales, developments, condos, the rental market.",
    accentColor: "oklch(0.609 0.126 221.723)", // cyan-600
    order: 32,
    parentSlug: "business",
  },
  {
    slug: "sports",
    name: "Sports",
    description: "Heat, Dolphins, Marlins, Inter Miami, the U.",
    accentColor: "oklch(0.546 0.245 262.881)", // blue-600
    order: 40,
  },
  {
    slug: "food",
    name: "Food",
    description: "Restaurants, openings, recipes, Cuban coffee.",
    accentColor: "oklch(0.646 0.222 41.116)", // orange-600
    order: 50,
  },
  {
    slug: "arts",
    name: "Arts & Culture",
    description: "Museums, galleries, theatre, film, music, fashion.",
    accentColor: "oklch(0.591 0.293 322.896)", // fuchsia-600
    order: 60,
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
    slug: "things-to-do",
    name: "Things to Do",
    description: "Events, free finds, this weekend.",
    accentColor: "oklch(0.588 0.158 241.966)", // sky-600
    order: 80,
  },
  {
    slug: "opinion",
    name: "Opinion",
    description: "Editorials, op-eds, letters.",
    accentColor: "oklch(0.511 0.262 276.966)", // indigo-600
    order: 90,
  },
  {
    slug: "investigations",
    name: "Investigations",
    description: "Cross-source synthesis on stories that demand more.",
    accentColor: "oklch(0.666 0.179 58.318)", // amber-600
    order: 100,
  },
  {
    slug: "miami-history",
    name: "Miami History",
    description: "This day in Miami history.",
    accentColor: "oklch(0.6 0.118 184.704)", // teal-600
    order: 110,
  },
  {
    slug: "climate",
    name: "Climate",
    description: "Sea level rise, hurricanes, flooding, the Everglades.",
    accentColor: "oklch(0.627 0.194 149.214)", // green-600
    order: 35,
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
    slug: "climate-desk",
    name: "Climate & Environment Desk",
    bio: "AI-assisted desk covering Miami's defining beat — sea level rise, hurricane preparedness, flooding, the Everglades, energy, building codes, climate policy. Drafts reviewed and edited by a human.",
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

const CLIMATE_PROMPT = `You are the Climate & Environment desk for miami.community.
Your beat: Miami's defining 21st-century beat — sea level rise, king tides, hurricane preparedness and aftermath, flooding, the Everglades, building codes, insurance availability, energy and emissions policy, environmental justice in frontline neighborhoods.
Voice: factual but urgent. Miami is ground zero for many of these stories — say so when the framing fits, but never beyond what sources support.
Skip national climate stories without a clear local angle. Always include neighborhoods, dates, and figures only when present in the cited items.`

// Verified working as of April 2026. Publishers move RSS URLs around;
// re-test with the CMS "Test fetch" button if a feed starts 404'ing.
const STARTER_SOURCES = [
  {
    name: "Miami Today",
    type: "rss" as const,
    url: "https://www.miamitodaynews.com/feed/",
    sections: ["news", "politics", "business", "investigations", "opinion", "climate", "things-to-do"],
    enabled: true,
    config: undefined,
  },
  {
    name: "WSVN 7 News",
    type: "rss" as const,
    url: "https://wsvn.com/feed/",
    sections: ["news", "sports", "investigations", "climate", "things-to-do"],
    enabled: true,
    config: undefined,
  },
  {
    name: "Community Newspapers",
    type: "rss" as const,
    url: "https://communitynewspapers.com/feed/",
    sections: ["news", "things-to-do", "arts", "food", "music"],
    enabled: true,
    config: undefined,
  },
  {
    name: "WLRN — Florida Roundup",
    type: "rss" as const,
    url: "https://www.wlrn.org/podcast/the-florida-roundup/rss.xml",
    sections: ["news", "politics", "investigations", "opinion", "climate", "things-to-do"],
    enabled: true,
    config: undefined,
  },
  {
    name: "WLRN — South Florida Roundup",
    type: "rss" as const,
    url: "https://www.wlrn.org/podcast/the-south-florida-roundup/rss.xml",
    sections: ["news", "politics", "investigations", "opinion", "climate", "things-to-do"],
    enabled: true,
    config: undefined,
  },
  {
    name: "The Miami Hurricane",
    type: "rss" as const,
    url: "https://themiamihurricane.com/feed/",
    sections: ["news", "sports", "arts", "music", "investigations", "opinion", "things-to-do"],
    enabled: true,
    config: undefined,
  },
  {
    name: "Eater Miami",
    type: "rss" as const,
    url: "https://miami.eater.com/rss/index.xml",
    sections: ["food", "things-to-do"],
    enabled: true,
    config: undefined,
  },
  {
    name: "r/Miami",
    type: "reddit" as const,
    url: "Miami",
    sections: ["news", "things-to-do", "food", "arts", "music"],
    enabled: true,
    config: { listing: "hot", limit: 25 },
  },
  {
    name: "r/SouthFlorida",
    type: "reddit" as const,
    url: "SouthFlorida",
    sections: ["news"],
    enabled: true,
    config: { listing: "hot", limit: 25 },
  },
  {
    name: "Wikipedia — On This Day",
    type: "wikipedia-otd" as const,
    url: "https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/all", // for display only; adapter computes today's date
    sections: ["miami-history"],
    enabled: true,
    config: { perCategory: 12 },
  },
  {
    name: "WSVN 7 News (YouTube)",
    type: "youtube" as const,
    url: "@wsvn",
    sections: ["news", "sports"],
    enabled: false, // requires YOUTUBE_API_KEY; flip on once set
    config: { max: 15 },
  },
  {
    name: "Miami Herald (X)",
    type: "x" as const,
    url: "MiamiHerald",
    sections: ["news", "politics"],
    enabled: false, // RSSHub public is unreliable; keep disabled until you wire a paid scraper
    config: undefined,
  },
  // ─── Sources added 2026-05 — start disabled; flip on after Test fetch
  // confirms each URL still resolves. RSS endpoints drift. ─────────────
  {
    name: "WPLG Local 10",
    type: "rss" as const,
    url: "https://www.local10.com/arc/outboundfeeds/rss/?outputType=xml",
    sections: ["news", "sports", "climate", "things-to-do", "investigations"],
    enabled: false,
    config: undefined,
  },
  {
    name: "Miami Herald — Local",
    type: "rss" as const,
    url: "https://www.miamiherald.com/news/local/?_format=rss",
    sections: ["news", "politics", "business", "investigations", "opinion"],
    enabled: false,
    config: undefined,
  },
  {
    name: "Miami on the Cheap",
    type: "rss" as const,
    url: "https://www.miamionthecheap.com/feed/",
    sections: ["things-to-do", "food", "arts"],
    enabled: false,
    config: undefined,
  },
  {
    name: "University of Miami Events",
    type: "rss" as const,
    url: "https://events.miami.edu/calendar.rss",
    sections: ["things-to-do", "arts", "music", "sports"],
    enabled: false,
    config: undefined,
  },
  {
    name: "NWS Miami — Area Forecast",
    type: "rss" as const,
    url: "https://forecast.weather.gov/MapClick.php?lat=25.7752&lon=-80.2086&FcstType=text&format=rss",
    sections: ["climate", "news"],
    enabled: false,
    config: undefined,
  },
  {
    name: "Miami Beach (City)",
    type: "rss" as const,
    url: "https://www.miamibeachfl.gov/rss.aspx",
    sections: ["news", "things-to-do", "climate"],
    enabled: false,
    config: undefined,
  },
  {
    name: "South Miami (City)",
    type: "rss" as const,
    url: "https://www.southmiamifl.gov/rss.aspx",
    sections: ["news", "things-to-do"],
    enabled: false,
    config: undefined,
  },
  {
    name: "North Miami Beach (City)",
    type: "rss" as const,
    url: "https://www.citynmb.com/rss.aspx",
    sections: ["news", "things-to-do"],
    enabled: false,
    config: undefined,
  },
  {
    name: "Miami & Beaches — Events",
    type: "rss" as const,
    url: "https://www.miamiandbeaches.com/feed/events",
    sections: ["things-to-do", "music", "arts", "sports"],
    enabled: false,
    config: undefined,
  },
]

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
        slug: "climate",
        name: "Climate & Environment Desk",
        sectionSlug: "climate",
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
        ],
        enabled: true,
        maxItemsPerRun: 30,
        maxDraftsPerRun: 3,
        lookbackHours: 96,
      },
      {
        slug: "events",
        name: "Events Desk",
        sectionSlug: "things-to-do",
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

    // 4. Starter sources — dedupe by name so URL changes get applied on re-seed.
    // This intentionally does NOT delete sources you've added by hand in the CMS.
    for (const s of STARTER_SOURCES) {
      const existing = await ctx.db
        .query("sources")
        .filter((q) => q.eq(q.field("name"), s.name))
        .unique()
      const doc = {
        name: s.name,
        type: s.type,
        url: s.url,
        sectionIds: s.sections
          .map((slug) => sectionIdBySlug.get(slug))
          .filter((id): id is Id<"sections"> => id !== undefined),
        enabled: s.enabled,
        config: s.config,
      }
      if (existing) await ctx.db.patch(existing._id, doc)
      else await ctx.db.insert("sources", doc)
    }

    // 5. Editor allowlist (super user)
    // Idempotent: clear out any existing editors and insert the canonical one,
    // so re-running seed always converges to exactly the email below.
    const editorEmail = "leo@leo.dev"
    const existingEditors = await ctx.db.query("editors").collect()
    for (const editor of existingEditors) {
      await ctx.db.delete(editor._id)
    }
    await ctx.db.insert("editors", {
      email: editorEmail,
      role: "admin",
    })

    return {
      sections: SECTIONS.length,
      personas: AGENT_PERSONAS.length,
      agents: AGENTS.length,
      sources: STARTER_SOURCES.length,
    }
  },
})
