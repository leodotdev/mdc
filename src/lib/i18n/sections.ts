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
  dolphins: { en: "Dolphins", es: "Dolphins" },
  heat: { en: "Heat", es: "Heat" },
  marlins: { en: "Marlins", es: "Marlins" },
  panthers: { en: "Panthers", es: "Panthers" },
  "inter-miami": { en: "Inter Miami", es: "Inter Miami" },
  "the-u": { en: "Hurricanes", es: "Hurricanes" },
  "miami-fc": { en: "Miami FC", es: "Miami FC" },
  "fiu-panthers": { en: "FIU", es: "FIU" },
  food: { en: "Food", es: "Comida" },
  arts: { en: "Arts & Culture", es: "Arte y cultura" },
  music: { en: "Music", es: "Música" },
  museums: { en: "Museums", es: "Museos" },
  film: { en: "Film", es: "Cine" },
  theater: { en: "Theater", es: "Teatro" },
  galleries: { en: "Galleries", es: "Galerías" },
  books: { en: "Books", es: "Libros" },
  "street-art": { en: "Street Art", es: "Arte urbano" },
  "things-to-do": { en: "Events", es: "Eventos" },
  opinion: { en: "Opinion", es: "Opinión" },
  investigations: { en: "Investigations", es: "Investigaciones" },
  "miami-history": { en: "Miami History", es: "Historia de Miami" },
  science: { en: "Science", es: "Ciencia" },
  climate: { en: "Climate", es: "Clima" },
  nature: { en: "Nature", es: "Naturaleza" },
}

const SECTION_DESCRIPTIONS: Record<string, Record<Lang, string>> = {
  news: {
    en: "What happened in Miami-Dade today, why it matters, and who's affected.",
    es: "Lo que pasó hoy en Miami-Dade, por qué importa y a quién afecta.",
  },
  politics: {
    en: "Inside City Hall, the county commission, and Tallahassee — the votes, the players, the deals.",
    es: "Dentro del ayuntamiento, la comisión del condado y Tallahassee — votos, protagonistas, acuerdos.",
  },
  business: {
    en: "How money moves in Miami — tech, hospitality, the port, the people building things.",
    es: "Cómo se mueve el dinero en Miami — tecnología, hospitalidad, el puerto, quienes construyen.",
  },
  "real-estate": {
    en: "Sales, developments, condos, the rental market — Miami's most consequential beat.",
    es: "Ventas, desarrollos, condominios, alquileres — el tema más decisivo de Miami.",
  },
  sports: {
    en: "Every Miami franchise, every season — from the Dolphins on Sundays to the Hurricanes in Coral Gables.",
    es: "Cada franquicia de Miami, cada temporada — desde los Dolphins los domingos hasta los Hurricanes en Coral Gables.",
  },
  food: {
    en: "Where Miami eats — new openings, neighborhood spots, Cuban coffee, the city's restaurant culture.",
    es: "Dónde come Miami — nuevas aperturas, lugares de barrio, café cubano, la cultura gastronómica de la ciudad.",
  },
  arts: {
    en: "What's on the walls, the stages, the screens, the streets — Miami's creative pulse.",
    es: "Lo que pasa en paredes, escenarios, pantallas y calles — el pulso creativo de Miami.",
  },
  music: {
    en: "Concerts, clubs, local artists, festivals.",
    es: "Conciertos, clubes, artistas locales, festivales.",
  },
  theater: {
    en: "Stages across the city — Adrienne Arsht, GableStage, Miami New Drama, dance companies, performing arts.",
    es: "Los escenarios de la ciudad — Adrienne Arsht, GableStage, Miami New Drama, compañías de danza, artes escénicas.",
  },
  galleries: {
    en: "Wynwood, Little River, the Design District — opening nights, art fairs, the working-artist scene around Art Basel.",
    es: "Wynwood, Little River, el Design District — inauguraciones, ferias de arte y la escena de artistas que trabaja alrededor de Art Basel.",
  },
  books: {
    en: "Miami's literary scene — the Book Fair, indie bookstores, local authors, readings, and what the city is reading.",
    es: "La escena literaria de Miami — la Feria del Libro, librerías independientes, autores locales, lecturas y lo que la ciudad está leyendo.",
  },
  "street-art": {
    en: "Murals, public installations, Wynwood Walls, the artists painting Miami's exteriors.",
    es: "Murales, instalaciones públicas, Wynwood Walls y los artistas que pintan las fachadas de Miami.",
  },
  "things-to-do": {
    en: "What's happening this weekend, this week, this month — concerts, festivals, public meetings, free finds.",
    es: "Lo que pasa este fin de semana, esta semana, este mes — conciertos, festivales, reuniones públicas, planes gratis.",
  },
  opinion: {
    en: "Editorials, op-eds, and letters from Miamians who care enough to write.",
    es: "Editoriales, columnas y cartas de miamenses que se preocupan lo suficiente para escribir.",
  },
  investigations: {
    en: "Stories that demand more than a headline — cross-source reporting on what doesn't add up.",
    es: "Historias que exigen más que un titular — reporteo multifuente sobre lo que no cuadra.",
  },
  "miami-history": {
    en: "How Miami got here — neighborhoods, people, eras that built the city.",
    es: "Cómo llegó Miami hasta aquí — barrios, personas y épocas que construyeron la ciudad.",
  },
  science: {
    en: "How South Florida's environment, ecosystems, and research are changing — climate, nature, public health.",
    es: "Cómo cambian el medio ambiente, los ecosistemas y la investigación del sur de Florida — clima, naturaleza, salud pública.",
  },
  climate: {
    en: "Sea level rise, hurricanes, flooding, building codes, insurance — Miami's defining 21st-century beat.",
    es: "Aumento del nivel del mar, huracanes, inundaciones, códigos de construcción, seguros — el tema definitorio del siglo XXI en Miami.",
  },
  nature: {
    en: "Wildlife, parks, beaches, the reef, the Everglades — what surrounds the city.",
    es: "Vida silvestre, parques, playas, el arrecife, los Everglades — lo que rodea a la ciudad.",
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
