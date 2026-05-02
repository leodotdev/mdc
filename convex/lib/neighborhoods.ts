// Single source of truth for Miami neighborhoods we tag stories with. The
// frontend imports this same file (`../../convex/lib/neighborhoods`) so the
// allowed list and slug→name mapping stay in lockstep.
//
// Add new entries here and they flow to: the LLM extraction tool, insert-
// time validation, the article-header chips, and the /neighborhood/$slug
// route.

export const NEIGHBORHOODS = [
  { slug: "coconut-grove", name: "Coconut Grove" },
  { slug: "coral-gables", name: "Coral Gables" },
  { slug: "downtown", name: "Downtown" },
  { slug: "brickell", name: "Brickell" },
  { slug: "key-biscayne", name: "Key Biscayne" },
  { slug: "miami-beach", name: "Miami Beach" },
  { slug: "wynwood-design-district", name: "Wynwood + Design District" },
  { slug: "edgewater", name: "Edgewater" },
  { slug: "little-haiti", name: "Little Haiti" },
  { slug: "south-miami", name: "South Miami" },
] as const

export type NeighborhoodSlug = (typeof NEIGHBORHOODS)[number]["slug"]

const SLUG_SET = new Set(NEIGHBORHOODS.map((n) => n.slug)) as Set<string>

export function isNeighborhoodSlug(slug: string): boolean {
  return SLUG_SET.has(slug)
}

export function neighborhoodName(slug: string): string | null {
  return NEIGHBORHOODS.find((n) => n.slug === slug)?.name ?? null
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
