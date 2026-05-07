// Data-source adapters — distinct from article adapters because their
// output is metric records (number, line, bars, rank, compare),
// NOT raw items destined for an LLM-drafted article.
//
// A `data` source carries an adapter key in its `url` field (kept as
// a single-string identifier, not an HTTP URL): `census-acs:miami-dade-population`,
// `bls:miami-metro-unemployment`. The dispatcher routes to the right
// fetcher and returns a `DataMetric[]` payload that the caller upserts
// via `metrics.upsertFromAgent`.
//
// Adapters MUST cite their source URL on every metric they emit —
// the data table's `citations` field is required.

export type DataMetric = {
  slug: string
  title: string
  subtitle?: string
  kind: "number" | "number-with-delta" | "line" | "bars" | "rank" | "compare"
  data: unknown
  unit?: string
  relatedTags: Array<string>
  relatedSectionSlugs: Array<string>
  citations: Array<{
    url: string
    title: string
    publisher: string
    fetchedAt: number
  }>
}

export async function fetchDataMetrics(opts: {
  /** The source's `url` field — used as the adapter key. */
  url: string
}): Promise<Array<DataMetric>> {
  const trimmed = opts.url.trim().toLowerCase()
  if (trimmed.startsWith("census-acs:")) {
    const slug = trimmed.slice("census-acs:".length)
    return await fetchCensusAcs(slug)
  }
  if (trimmed.startsWith("bls:")) {
    const slug = trimmed.slice("bls:".length)
    return await fetchBls(slug)
  }
  throw new Error(`Unknown data adapter for "${opts.url}"`)
}

// =====================================================================
// Census ACS adapter — pulls Miami-Dade county-level demographics from
// the Census Bureau's free public API. No key required for low
// volume. Single-shot per slug; the caller decides cron cadence.
//
// Reference: https://www.census.gov/data/developers/data-sets/acs-5year.html
// Tested endpoint: returns total population for Miami-Dade County (FIPS 12086).
// =====================================================================

const CENSUS_VINTAGE = "2023"
const CENSUS_BASE = `https://api.census.gov/data/${CENSUS_VINTAGE}/acs/acs5`
const CENSUS_PUBLISHER = "U.S. Census Bureau ACS 5-year"

async function fetchCensusAcs(slug: string): Promise<Array<DataMetric>> {
  if (slug === "miami-dade-population") {
    // ACS variable B01003_001E = Total Population
    const url = `${CENSUS_BASE}?get=NAME,B01003_001E&for=county:086&in=state:12`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Census ACS → ${res.status}`)
    const json = (await res.json()) as Array<Array<string>>
    // Response shape: [["NAME", "B01003_001E", "state", "county"], ["Miami-Dade County, Florida", "2722000", "12", "086"]]
    const row = json[1]
    if (!row) return []
    const value = Number(row[1])
    if (!Number.isFinite(value)) return []
    const now = Date.now()
    return [
      {
        slug: "miami-dade-population",
        title: "Miami-Dade population",
        subtitle: `Census ACS ${CENSUS_VINTAGE} 5-year`,
        kind: "number",
        data: { value },
        unit: "people",
        relatedTags: ["population", "demographics"],
        relatedSectionSlugs: ["news"],
        citations: [
          {
            url: `https://data.census.gov/profile/Miami-Dade_County,_Florida?g=050XX00US12086`,
            title: "Miami-Dade County profile",
            publisher: CENSUS_PUBLISHER,
            fetchedAt: now,
          },
        ],
      },
    ]
  }
  throw new Error(`Unknown Census ACS slug "${slug}"`)
}

// =====================================================================
// BLS unemployment adapter — Miami metro Local Area Unemployment
// Statistics. Free public API, no key for low volume (≤25 queries/day).
//
// Reference: https://www.bls.gov/developers/api_signature_v2.htm
// Series LAUMT123310000000003 = Miami-Fort Lauderdale-West Palm Beach
// metro, unemployment rate, NSA.
// =====================================================================

const BLS_PUBLISHER = "U.S. Bureau of Labor Statistics LAUS"
const BLS_MIAMI_METRO_SERIES = "LAUMT123310000000003"

async function fetchBls(slug: string): Promise<Array<DataMetric>> {
  if (slug === "miami-metro-unemployment") {
    const url = `https://api.bls.gov/publicAPI/v2/timeseries/data/${BLS_MIAMI_METRO_SERIES}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`BLS → ${res.status}`)
    const json = (await res.json()) as {
      Results?: {
        series?: Array<{
          data?: Array<{
            year: string
            periodName: string
            value: string
          }>
        }>
      }
    }
    const series = json.Results?.series?.[0]?.data ?? []
    if (series.length === 0) return []
    // BLS returns most-recent first. Build a 12-point line series
    // (one per month) from the latest 12 entries.
    const last12 = series.slice(0, 12).reverse()
    const points = last12
      .map((d) => ({
        label: `${d.periodName.slice(0, 3)} ${d.year.slice(2)}`,
        value: parseFloat(d.value),
      }))
      .filter((p) => Number.isFinite(p.value))
    if (points.length === 0) return []
    const latest = points[points.length - 1]
    const previous = points[points.length - 2]
    const delta = previous
      ? { value: latest.value - previous.value, period: "MoM" }
      : undefined
    const now = Date.now()
    return [
      {
        slug: "miami-metro-unemployment",
        title: "Miami-Fort Lauderdale unemployment",
        subtitle: `BLS LAUS, ${latest.label}`,
        kind: "line",
        data: { points, delta },
        unit: "%",
        relatedTags: ["unemployment", "labor-market", "economy"],
        relatedSectionSlugs: ["business", "news"],
        citations: [
          {
            url: `https://data.bls.gov/timeseries/${BLS_MIAMI_METRO_SERIES}`,
            title: "Miami-Fort Lauderdale-West Palm Beach unemployment rate",
            publisher: BLS_PUBLISHER,
            fetchedAt: now,
          },
        ],
      },
    ]
  }
  throw new Error(`Unknown BLS slug "${slug}"`)
}
