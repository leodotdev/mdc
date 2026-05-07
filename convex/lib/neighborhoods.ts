// Single source of truth for Miami neighborhoods we tag stories with. The
// frontend imports this same file (`../../convex/lib/neighborhoods`) so the
// allowed list and slug→name mapping stay in lockstep.
//
// Add new entries here and they flow to: the LLM extraction tool, insert-
// time validation, the article-header chips, and the /neighborhood/$slug
// route.

// Centroid coordinates approximate the visual center of each
// neighborhood — used by the events map view to plot pins until
// per-event geocoding lands in P1. Pulled from public sources
// (OpenStreetMap / Wikipedia geo coords).
export const NEIGHBORHOODS = [
  { slug: "coconut-grove", name: "Coconut Grove", lat: 25.7281, lng: -80.2436 },
  { slug: "coral-gables", name: "Coral Gables", lat: 25.7215, lng: -80.2684 },
  { slug: "downtown", name: "Downtown", lat: 25.7743, lng: -80.1937 },
  { slug: "brickell", name: "Brickell", lat: 25.7617, lng: -80.1918 },
  { slug: "key-biscayne", name: "Key Biscayne", lat: 25.6929, lng: -80.1626 },
  { slug: "miami-beach", name: "Miami Beach", lat: 25.7907, lng: -80.1300 },
  {
    slug: "wynwood-design-district",
    name: "Wynwood + Design District",
    lat: 25.8010,
    lng: -80.1990,
  },
  { slug: "edgewater", name: "Edgewater", lat: 25.7990, lng: -80.1880 },
  { slug: "little-haiti", name: "Little Haiti", lat: 25.8243, lng: -80.1957 },
  { slug: "south-miami", name: "South Miami", lat: 25.7079, lng: -80.2935 },
] as const

export type NeighborhoodSlug = (typeof NEIGHBORHOODS)[number]["slug"]

const SLUG_SET = new Set(NEIGHBORHOODS.map((n) => n.slug)) as Set<string>

export function isNeighborhoodSlug(slug: string): boolean {
  return SLUG_SET.has(slug)
}

export function neighborhoodName(slug: string): string | null {
  return NEIGHBORHOODS.find((n) => n.slug === slug)?.name ?? null
}

export function neighborhoodCoords(
  slug: string,
): { lat: number; lng: number } | null {
  const n = NEIGHBORHOODS.find((x) => x.slug === slug)
  return n ? { lat: n.lat, lng: n.lng } : null
}

export function filterNeighborhoodSlugs(
  slugs: ReadonlyArray<string>,
): Array<string> {
  const seen = new Set<string>()
  const out: Array<string> = []
  for (const s of slugs) {
    const lower = s.toLowerCase().trim()
    if (!isNeighborhoodSlug(lower) || seen.has(lower)) continue
    seen.add(lower)
    out.push(lower)
  }
  return out
}
