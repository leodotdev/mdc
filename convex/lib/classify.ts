// Event classifier — deterministic mapping from an event's content
// (title, body, venue, source URL) to a section slug + supplemental
// tags + neighborhoods. Replaces the old "source.sectionIds[0]"
// shortcut so a single firehose source (Eventbrite, MNT, Coral Gables
// calendar) can ship events across many sections without the editor
// pre-binding.
//
// Cascade — first rule that matches wins:
//   1. Venue map (normalized venue name → section).
//   2. Source URL host map (when the URL itself names the section,
//      e.g. miamihurricanes.com → the-u).
//   3. Keyword rules against title + body (yoga → fitness, etc.).
//   4. Existing item tags that already overlap a known section's
//      associatedTags.
//   5. Fallback: `local` (the catch-all section).
//
// Pure / synchronous. The caller resolves the returned slug to a
// `sections._id`. Designed to be cheap enough to run on every
// candidate without any LLM cost.

export type ClassifyInput = {
  title: string
  body?: string | null
  snippet?: string | null
  locationName?: string | null
  locationAddress?: string | null
  sourceUrl?: string | null
  sourceName?: string | null
  itemTags?: ReadonlyArray<string> | null
}

export type ClassifyResult = {
  sectionSlug: string
  /** Confidence in the chosen section, 0..1. 1.0 = venue-exact;
   *  ~0.85 = URL-host; ~0.7 = strong keyword; ~0.5 = tag-overlap;
   *  0.1 = fallback. Used by the quality scorer (#9) and the LLM
   *  enrichment gate (only re-classify when confidence < 0.5). */
  confidence: number
  /** Supplemental tags derived from keyword hits — these get unioned
   *  with whatever tags the adapter already returned. */
  tags: ReadonlyArray<string>
  /** Why this section won — short rule name for debugging. */
  reason: string
}

// ── 1. Venue map ──────────────────────────────────────────────────────
// Normalized venue names (lowercased, ampersand-folded, punctuation
// stripped) → section slug. Add aliases as we encounter them. The
// classifier picks the LONGEST match so "frost school of music" wins
// over "frost school" if both were listed.
const VENUE_MAP: Record<string, string> = {
  // Sports venues
  "kaseya center": "heat",
  "ftx arena": "heat",
  "miami-dade arena": "heat",
  "hard rock stadium": "dolphins",
  "loan depot park": "marlins",
  "loandepot park": "marlins",
  "marlins park": "marlins",
  "chase stadium": "inter-miami",
  "drv pnk stadium": "inter-miami",
  "watsco center": "the-u",
  "alex rodriguez park": "the-u",
  "alex rodriguez park at mark light field": "the-u",
  "cobb stadium": "the-u",
  "knight sports complex": "the-u",
  "ocean bank convocation center": "fiu-panthers",
  "fiu stadium": "fiu-panthers",

  // Arts / music
  "adrienne arsht center": "music",
  "arsht center": "music",
  "fillmore miami beach": "music",
  "the fillmore": "music",
  "olympia theater": "music",
  "knight concert hall": "music",
  "ziff ballet opera house": "theater",
  "actors playhouse": "theater",
  "miracle theatre": "theater",
  "gablestage": "theater",
  "the moore": "music",
  "north beach bandshell": "music",
  "scottish rite": "music",
  "ball and chain": "music",

  // Museums / galleries
  "perez art museum miami": "museums",
  "perez art museum": "museums",
  "pamm": "museums",
  "frost science": "museums",
  "phillip and patricia frost museum of science": "museums",
  "vizcaya museum and gardens": "museums",
  "vizcaya": "museums",
  "bass museum of art": "museums",
  "the bass": "museums",
  "moca north miami": "museums",
  "lowe art museum": "museums",
  "history miami": "museums",
  "historymiami museum": "museums",
  "jewish museum of florida": "museums",
  "wolfsonian": "museums",
  "wolfsonian-fiu": "museums",
  "the wolfsonian": "museums",
  "deering estate": "museums",
  "miami childrens museum": "museums",
  // Books / literary venues
  "books and books": "books",
  "books books": "books",
  "books books coral gables": "books",
  "books and books coral gables": "books",
  "books and books at the betsy hotel": "books",
  "books and books key west": "books",
  "fairchild tropical botanic garden": "nature",
  "pinecrest gardens": "nature",
  "miami beach botanical garden": "nature",

  // Film
  "o cinema": "film",
  "miami beach cinematheque": "film",
  "coral gables art cinema": "film",
  "tower theater miami": "film",
  "silverspot cinema": "film",

  // Education
  "frost school of music": "university-of-miami",
  "school of architecture": "university-of-miami",
  "miller school of medicine": "university-of-miami",
  "herbert business school": "university-of-miami",
  "school of communication": "university-of-miami",
  "miami dade college": "mdc",
  "wolfson campus": "mdc",
  "kendall campus": "mdc",
  "north campus": "mdc",
  "homestead campus": "mdc",
  "florida international university": "fiu",
  "fiu mmc": "fiu",
  "fiu biscayne bay": "fiu",

  // Fitness / health
  "ymca": "fitness",
  "ymca of south florida": "fitness",
  "equinox": "fitness",

  // Family / kids
  "miami seaquarium": "family",
  "jungle island": "family",
  "zoo miami": "family",

  // Civic / government
  "miami city hall": "city",
  "miami-dade county hall": "city",
  "miami beach city hall": "city",
  "coral gables city hall": "city",
}

// ── 2. URL host map ───────────────────────────────────────────────────
// Source hostname → section slug. Used when the source name itself
// telegraphs the topic (sports team site, museum site, etc.).
const HOST_MAP: Record<string, string> = {
  "miamihurricanes.com": "the-u",
  "marlins.com": "marlins",
  "mlb.com": "marlins",
  "heat.com": "heat",
  "miamiheat.com": "heat",
  "miamidolphins.com": "dolphins",
  "floridapanthers.com": "panthers",
  "nhl.com": "panthers",
  "intermiamicf.com": "inter-miami",
  "miamifc.com": "miami-fc",
  "fiusports.com": "fiu-panthers",
  "hardrockstadium.com": "dolphins",
  "kaseyacenter.com": "heat",
  "loandepotpark.com": "marlins",

  "pamm.org": "museums",
  "frostscience.org": "museums",
  "vizcaya.org": "museums",
  "bassmuseum.org": "museums",
  "mocanomi.org": "museums",
  "lowemuseum.org": "museums",
  "historymiami.org": "museums",
  "jewishmuseum.com": "museums",
  "wolfsonian.org": "museums",
  "deeringestate.org": "museums",
  "miamichildrensmuseum.org": "museums",
  "booksandbooks.com": "books",
  "fairchildgarden.org": "nature",
  "pinecrestgardens.org": "nature",
  "mbgarden.org": "nature",

  "arshtcenter.org": "music",
  "fillmoremb.com": "music",
  "olympiatheater.org": "music",
  "northbeachbandshell.com": "music",
  "themoore.com": "music",
  "actorsplayhouse.org": "theater",
  "gablestage.org": "theater",

  "ocinema.org": "film",
  "mbcinema.com": "film",
  "gablescinema.com": "film",
  "towertheatermiami.com": "film",

  "miami.edu": "university-of-miami",
  "miamioh.edu": "university-of-miami",
  "events.miami.edu": "university-of-miami",
  "mdc.edu": "mdc",
  "calendar.mdc.edu": "mdc",
  "fiu.edu": "fiu",
  "calendar.fiu.edu": "fiu",

  "zoomiami.org": "family",
  "jungleisland.com": "family",
  "miamiseaquarium.com": "family",

  "miamidade.gov": "city",
  "miami.gov": "city",
  "miamigov.com": "city",
  "miamibeachfl.gov": "city",
  "coralgables.com": "city",
  "miamibeachapi.com": "city",
}

// ── 3. Keyword rules (title + body) ───────────────────────────────────
// Each entry: [section slug, regex, tag tokens to add]. Order matters
// for ambiguous matches — first hit wins, so put the most specific
// rule first (e.g. "5k" → fitness BEFORE generic "run" patterns).
const KEYWORD_RULES: ReadonlyArray<{
  section: string
  pattern: RegExp
  tags: ReadonlyArray<string>
}> = [
  // Fitness — high-precision tokens
  {
    section: "fitness",
    pattern:
      /\b(yoga|pilates|barre|spin\s+class|hiit|crossfit|zumba|cycle\s+class|5k\b|10k\b|half[\s-]marathon|marathon|run\s+club|running\s+club|fun\s+run|bootcamp|boot\s+camp)\b/i,
    tags: ["fitness"],
  },
  // Wellness (lower-cal, contemplative)
  {
    section: "wellness",
    pattern:
      /\b(meditation|sound\s+bath|breathwork|reiki|mindfulness|wellness\s+retreat)\b/i,
    tags: ["wellness"],
  },
  // Sports — generic
  {
    section: "sports",
    pattern:
      /\b(game\s+day|tailgate|matchday|kickoff\s+\d|home\s+(?:game|opener)|away\s+game|playoff|tournament|championship\s+game)\b/i,
    tags: ["sports"],
  },
  // Music
  {
    section: "music",
    pattern:
      /\b(concert|live\s+music|dj\s+set|jazz\s+(?:night|brunch|trio|quartet|quintet)|symphony|philharmonic|recital|open\s+mic|salsa\s+night|reggaeton|hip[\s-]hop\s+show|edm\s+show|festival\s+(?:lineup|stage)|tour\s+stop)\b/i,
    tags: ["music"],
  },
  // Film
  {
    section: "film",
    pattern:
      /\b(screening|premiere|film\s+festival|cinema|movie\s+night|short\s+films?\s+block|q&a\s+with\s+(?:director|filmmaker))\b/i,
    tags: ["film"],
  },
  // Theater / dance
  {
    section: "theater",
    pattern:
      /\b(theatre|theater|play\b|musical\b|on\s+broadway|off[\s-]broadway|opera|ballet|dance\s+(?:performance|recital|company)|stand[\s-]up\s+comedy)\b/i,
    tags: ["theater"],
  },
  // Museums / galleries — bare "museum" word catches any
  // "X Museum" event whose venue / host wasn't in the curated map
  // (e.g. Balloon Museum's traveling Pop Air exhibit).
  {
    section: "museums",
    pattern:
      /\b(museum|exhibition|exhibit\b|opening\s+reception|gallery\s+(?:opening|walk)|art\s+walk|first\s+friday|second\s+saturday|art\s+basel|design\s+miami)\b/i,
    tags: ["museums", "exhibition"],
  },
  // Food
  {
    section: "food",
    pattern:
      /\b(food\s+(?:fest|festival|truck|tasting)|chef('s)?\s+(?:dinner|table|pop[\s-]up)|tasting\s+menu|wine\s+(?:tasting|dinner)|cocktail\s+(?:class|tasting)|happy\s+hour|brunch|pop[\s-]up\s+(?:dinner|kitchen|restaurant))\b/i,
    tags: ["food"],
  },
  // Books / literature — bookstore events have a recognizable
  // vocabulary that the title alone doesn't always contain
  // ("An Evening with X", "Miami Writers Workshop", etc.).
  {
    section: "books",
    pattern:
      /\b(book\s+(?:launch|signing|reading|club|fair)|author\s+(?:talk|reading)|literary\s+(?:salon|reading)|miami\s+book\s+fair|writers?\s+(?:workshop|critique|panel|salon|circle)|in\s+conversation\s+with|an\s+evening\s+with|an\s+afternoon\s+with|book\s+club\s+meeting|reading\s+series|poetry\s+(?:slam|reading|night))\b/i,
    tags: ["books"],
  },
  // Family
  {
    section: "family",
    pattern:
      /\b(family[\s-]friendly|kids?\s+(?:day|club|story\s*time|workshop)|storytime|story\s+time|playgroup|petting\s+zoo|easter\s+egg\s+hunt|trick[\s-]or[\s-]treat|carnival\b)\b/i,
    tags: ["family"],
  },
  // Civic / politics
  {
    section: "city",
    pattern:
      /\b(commission\s+(?:meeting|hearing)|council\s+meeting|public\s+(?:hearing|comment)|town\s+hall|board\s+meeting|zoning\s+(?:hearing|meeting)|workshop\s+\(public\)|budget\s+hearing)\b/i,
    tags: ["civic"],
  },
  // Real estate
  {
    section: "real-estate",
    pattern:
      /\b(open\s+house|broker\s+(?:tour|preview)|real\s+estate\s+(?:panel|summit)|housing\s+forum|property\s+tour)\b/i,
    tags: ["real-estate"],
  },
  // Tech
  {
    section: "tech",
    pattern:
      /\b(hackathon|tech\s+(?:meetup|conference|summit|talk)|startup\s+(?:pitch|night|demo\s+day)|ai\s+(?:meetup|panel|summit)|web3|crypto\s+(?:meetup|summit))\b/i,
    tags: ["tech"],
  },
  // Business
  {
    section: "business",
    pattern:
      /\b(chamber\s+(?:luncheon|breakfast|mixer)|business\s+(?:expo|summit|breakfast)|networking\s+(?:event|breakfast|lunch|mixer)|career\s+fair|entrepreneur(?:ship)?\s+(?:talk|summit))\b/i,
    tags: ["business"],
  },
  // Science / nature
  {
    section: "science",
    pattern:
      /\b(astronomy\s+(?:night|talk)|planetarium\s+show|lecture\s+(?:on|about)\s+(?:climate|ocean|coral|species)|citizen\s+science|stargazing|bird\s+walk|nature\s+walk|guided\s+hike)\b/i,
    tags: ["science"],
  },
  // Education
  {
    section: "education",
    pattern:
      /\b(open\s+house|school\s+(?:fair|tour)|college\s+(?:fair|info\s+session)|admissions\s+(?:event|tour))\b/i,
    tags: ["education"],
  },
]

// ── 4. Section-fallback ───────────────────────────────────────────────
// When nothing matches, drop the event into `local` — the catch-all
// city-life section. Confidence stays low so the LLM enrichment pass
// can override.
const FALLBACK_SECTION = "local"

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase()
  } catch {
    return null
  }
}

// DB-backed overrides. Loaded once per ingest pass via
// `internal.taxonomy.snapshot` and passed in as `overrides` — DB hits
// take precedence over the hardcoded baseline above, so editors can
// patch a misclassification live from /admin/taxonomy without a
// redeploy. Pure data; no fetch happens in this function.
export type ClassifyOverrides = {
  venues?: ReadonlyArray<{ venueKey: string; sectionSlug: string }>
  hosts?: ReadonlyArray<{ host: string; sectionSlug: string }>
  keywords?: ReadonlyArray<{
    pattern: string
    sectionSlug: string
    tags: ReadonlyArray<string>
    order: number
  }>
}

// Walk every keyword rule (DB overrides + baseline) against the
// haystack and collect every tag token they produce. Used to seed
// `events.tags` even when the section pick came from a venue or
// host match — keeps Haiku enrichment off the hook for any event
// whose copy already hits 2+ rule tags.
function gatherKeywordTags(
  haystack: string,
  overrides?: ClassifyOverrides,
): Array<string> {
  const tags = new Set<string>()
  for (const r of overrides?.keywords ?? []) {
    try {
      if (new RegExp(r.pattern, "i").test(haystack)) {
        for (const t of r.tags) tags.add(t)
      }
    } catch {
      // skip bad regex
    }
  }
  for (const r of KEYWORD_RULES) {
    if (r.pattern.test(haystack)) {
      for (const t of r.tags) tags.add(t)
    }
  }
  return Array.from(tags)
}

export function classifyEvent(
  input: ClassifyInput,
  overrides?: ClassifyOverrides,
): ClassifyResult {
  const venue = normalize(input.locationName ?? "")
  const haystack = [
    input.title,
    input.snippet ?? "",
    input.body ?? "",
    input.locationName ?? "",
    input.locationAddress ?? "",
  ].join(" ")
  const inner = classifyInner(input, overrides, venue, haystack)
  // Enrich whatever path won with every keyword-rule tag that fires
  // on the haystack. Lets venue/host matches still stamp 1-3 tags
  // without needing the post-insert Haiku enrichment.
  const extraTags = gatherKeywordTags(haystack, overrides)
  if (extraTags.length === 0) return inner
  const merged = Array.from(new Set([...inner.tags, ...extraTags]))
  return { ...inner, tags: merged }
}

function classifyInner(
  input: ClassifyInput,
  overrides: ClassifyOverrides | undefined,
  venue: string,
  haystack: string,
): ClassifyResult {

  // 1. Venue match — longest key first across DB + baseline.
  if (venue.length > 0) {
    const allVenues: Array<{ key: string; section: string; source: string }> = []
    for (const v of overrides?.venues ?? []) {
      allVenues.push({ key: v.venueKey, section: v.sectionSlug, source: "db" })
    }
    for (const k of Object.keys(VENUE_MAP)) {
      allVenues.push({ key: k, section: VENUE_MAP[k], source: "base" })
    }
    let best: { key: string; section: string; source: string } | null = null
    for (const v of allVenues) {
      if (!venue.includes(v.key)) continue
      if (best === null || v.key.length > best.key.length) best = v
    }
    if (best) {
      return {
        sectionSlug: best.section,
        confidence: 1.0,
        tags: [],
        reason: `venue:${best.key}${best.source === "db" ? "(db)" : ""}`,
      }
    }
  }

  // 2. URL host match — DB first, then baseline.
  const host = hostOf(input.sourceUrl)
  const hostOverride = overrides?.hosts?.find((h) => h.host === host)
  if (host && hostOverride) {
    return {
      sectionSlug: hostOverride.sectionSlug,
      confidence: 0.9,
      tags: [],
      reason: `host:${host}(db)`,
    }
  }
  if (host && HOST_MAP[host]) {
    return {
      sectionSlug: HOST_MAP[host],
      confidence: 0.85,
      tags: [],
      reason: `host:${host}`,
    }
  }
  if (host) {
    const parts = host.split(".")
    if (parts.length > 2) {
      const parent = parts.slice(-2).join(".")
      const parentOverride = overrides?.hosts?.find((h) => h.host === parent)
      if (parentOverride) {
        return {
          sectionSlug: parentOverride.sectionSlug,
          confidence: 0.85,
          tags: [],
          reason: `host:${parent}(db)`,
        }
      }
      if (HOST_MAP[parent]) {
        return {
          sectionSlug: HOST_MAP[parent],
          confidence: 0.8,
          tags: [],
          reason: `host:${parent}`,
        }
      }
    }
  }

  // 3. Keyword rules — DB overrides + baseline, DB sorted by `order`.
  const dbKeywords = (overrides?.keywords ?? [])
    .slice()
    .sort((a, b) => b.order - a.order)
  for (const rule of dbKeywords) {
    let re: RegExp
    try {
      re = new RegExp(rule.pattern, "i")
    } catch {
      continue
    }
    if (re.test(haystack)) {
      return {
        sectionSlug: rule.sectionSlug,
        confidence: 0.75,
        tags: rule.tags,
        reason: `keyword(db):${rule.sectionSlug}`,
      }
    }
  }
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(haystack)) {
      return {
        sectionSlug: rule.section,
        confidence: 0.7,
        tags: rule.tags,
        reason: `keyword:${rule.section}`,
      }
    }
  }

  // 4. Tag overlap against the section's associatedTags. Cheap signal —
  // the adapter or upstream enrichment may already have tagged it.
  // Only used when itemTags is provided.
  const itemTags = new Set((input.itemTags ?? []).map((t) => t.toLowerCase()))
  if (itemTags.size > 0) {
    // Inline minimal map — keep in sync with the canonical
    // SECTION_ASSOCIATED_TAGS in migrations.ts. Only listing the most
    // common cross-section tags here for speed.
    const TAG_TO_SECTION: Record<string, string> = {
      music: "music",
      concert: "music",
      jazz: "music",
      film: "film",
      cinema: "film",
      theater: "theater",
      theatre: "theater",
      museum: "museums",
      exhibition: "museums",
      gallery: "museums",
      food: "food",
      restaurant: "food",
      family: "family",
      kids: "family",
      tech: "tech",
      business: "business",
      "real-estate": "real-estate",
      fitness: "fitness",
      yoga: "fitness",
      wellness: "wellness",
      sports: "sports",
      science: "science",
      books: "books",
      civic: "city",
      politics: "politics",
    }
    for (const tag of itemTags) {
      const sec = TAG_TO_SECTION[tag]
      if (sec) {
        return {
          sectionSlug: sec,
          confidence: 0.5,
          tags: [],
          reason: `tag:${tag}`,
        }
      }
    }
  }

  // 5. Fallback.
  return {
    sectionSlug: FALLBACK_SECTION,
    confidence: 0.1,
    tags: [],
    reason: "fallback:local",
  }
}
