import type { Lang } from "./strings"

// Per-section translations. Keyed by section.slug; falls through to the
// English `name` from the section doc when the slug isn't in this table or
// the locale isn't available. Less invasive than a schema migration for v1.
const SECTION_NAMES: Record<string, Record<Lang, string>> = {
  news: { en: "News", es: "Noticias" },
  politics: { en: "Politics", es: "Política" },
  business: { en: "Business", es: "Negocios" },
  "real-estate": { en: "Real Estate", es: "Bienes raíces" },
  sports: { en: "Sports", es: "Deportes" },
  food: { en: "Food", es: "Comida" },
  arts: { en: "Arts & Culture", es: "Arte y cultura" },
  music: { en: "Music", es: "Música" },
  "things-to-do": { en: "Events", es: "Eventos" },
  opinion: { en: "Opinion", es: "Opinión" },
  investigations: { en: "Investigations", es: "Investigaciones" },
  "miami-history": { en: "Miami History", es: "Historia de Miami" },
  climate: { en: "Climate", es: "Clima" },
}

const SECTION_DESCRIPTIONS: Record<string, Record<Lang, string>> = {
  news: {
    en: "Local news from across Miami-Dade.",
    es: "Noticias locales de todo Miami-Dade.",
  },
  politics: {
    en: "City Hall, county commission, Tallahassee.",
    es: "Ayuntamiento, comisión del condado, Tallahassee.",
  },
  business: {
    en: "Real estate, tech, hospitality, the port.",
    es: "Bienes raíces, tecnología, hospitalidad, el puerto.",
  },
  "real-estate": {
    en: "Sales, developments, condos, the rental market.",
    es: "Ventas, desarrollos, condominios, el mercado de alquiler.",
  },
  sports: {
    en: "Heat, Dolphins, Marlins, Inter Miami, the U.",
    es: "Heat, Dolphins, Marlins, Inter Miami, los Hurricanes.",
  },
  food: {
    en: "Restaurants, openings, recipes, Cuban coffee.",
    es: "Restaurantes, aperturas, recetas, café cubano.",
  },
  arts: {
    en: "Museums, galleries, theatre, film, fashion.",
    es: "Museos, galerías, teatro, cine, moda.",
  },
  music: {
    en: "Concerts, clubs, local artists, festivals.",
    es: "Conciertos, clubes, artistas locales, festivales.",
  },
  "things-to-do": {
    en: "Concerts, openings, festivals, and stories about the Miami scene.",
    es: "Conciertos, aperturas, festivales y reportajes de la escena de Miami.",
  },
  opinion: {
    en: "Editorials, op-eds, letters.",
    es: "Editoriales, columnas de opinión, cartas.",
  },
  investigations: {
    en: "Cross-source synthesis on stories that demand more.",
    es: "Síntesis multifuente de historias que requieren más profundidad.",
  },
  "miami-history": {
    en: "This day in Miami history.",
    es: "Hoy en la historia de Miami.",
  },
  climate: {
    en: "Sea level, hurricanes, flooding, the Everglades.",
    es: "Nivel del mar, huracanes, inundaciones, los Everglades.",
  },
}

export function localizeSectionName(
  section: { slug: string; name: string } | null | undefined,
  lang: Lang,
): string {
  if (!section) return ""
  return SECTION_NAMES[section.slug]?.[lang] ?? section.name
}

export function localizeSectionDescription(
  section: { slug: string; description: string } | null | undefined,
  lang: Lang,
): string {
  if (!section) return ""
  return (
    SECTION_DESCRIPTIONS[section.slug]?.[lang] ?? section.description
  )
}
