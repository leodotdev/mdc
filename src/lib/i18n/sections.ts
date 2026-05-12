import type { Lang } from "./strings"

// Per-section translations. Keyed by section.slug; falls through to the
// English `name` from the section doc when the slug isn't in this table or
// the locale isn't available. Less invasive than a schema migration for v1.
const SECTION_NAMES: Record<string, Record<Lang, string>> = {
  politics: { en: "Politics", es: "Política" },
  business: { en: "Business", es: "Negocios" },
  tech: { en: "Tech", es: "Tecnología" },
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
  film: { en: "Film", es: "Cine" },
  theater: { en: "Theater", es: "Teatro" },
  galleries: { en: "Galleries", es: "Galerías" },
  books: { en: "Books", es: "Libros" },
  "street-art": { en: "Street Art", es: "Arte urbano" },
  science: { en: "Science", es: "Ciencia" },
  museums: { en: "Museums", es: "Museos" },
  history: { en: "History", es: "Historia" },
  climate: { en: "Climate", es: "Clima" },
  nature: { en: "Nature", es: "Naturaleza" },
}

const SECTION_DESCRIPTIONS: Record<string, Record<Lang, string>> = {
  politics: {
    en: "Civic life in Miami-Dade — commission meetings, town halls, candidate forums, neighborhood-association meetups, public-comment nights.",
    es: "Vida cívica en Miami-Dade — reuniones de la comisión, asambleas, foros de candidatos, encuentros vecinales, audiencias públicas.",
  },
  business: {
    en: "Business events across Miami — conferences, ribbon-cuttings, mixers, networking, port and trade.",
    es: "Eventos de negocios en Miami — conferencias, inauguraciones, mixers, networking, puerto y comercio.",
  },
  tech: {
    en: "Tech meetups, hackathons, demo days, founder gatherings — Refresh Miami, eMerge, CIC, Endeavor.",
    es: "Meetups de tecnología, hackathons, demo days y encuentros de founders — Refresh Miami, eMerge, CIC, Endeavor.",
  },
  "real-estate": {
    en: "Open houses, developer briefings, broker meetups, real-estate panels and tours.",
    es: "Open houses, presentaciones de developers, encuentros de brokers, paneles y recorridos inmobiliarios.",
  },
  sports: {
    en: "Every Miami franchise, every season — from the Dolphins on Sundays to the Hurricanes in Coral Gables.",
    es: "Cada franquicia de Miami, cada temporada — desde los Dolphins los domingos hasta los Hurricanes en Coral Gables.",
  },
  food: {
    en: "Food events across Miami — restaurant openings, markets, festivals, tastings.",
    es: "Eventos gastronómicos en Miami — aperturas de restaurantes, mercados, festivales, catas.",
  },
  arts: {
    en: "Concerts, exhibitions, theater, film, gallery openings, street art — Miami's creative pulse on stage, on screen, on the walls.",
    es: "Conciertos, exposiciones, teatro, cine, inauguraciones de galerías, arte urbano — el pulso creativo de Miami en escenarios, pantallas y paredes.",
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
  science: {
    en: "Museum nights, lectures, history walks, climate panels, nature programs — Miami's research and learning beats. Sub-sections: museums, history, climate, nature.",
    es: "Noches de museo, charlas, caminatas históricas, paneles climáticos, programas de naturaleza — los temas de investigación y aprendizaje de Miami. Sub-secciones: museos, historia, clima, naturaleza.",
  },
  museums: {
    en: "PAMM, Frost, Bass, Vizcaya, ICA, HistoryMiami — exhibition openings, members nights, lectures, family days.",
    es: "PAMM, Frost, Bass, Vizcaya, ICA, HistoryMiami — inauguraciones, noches de miembros, charlas, días familiares.",
  },
  history: {
    en: "Historical events — heritage walks, archival exhibits, talks on Miami's past.",
    es: "Eventos históricos — caminatas patrimoniales, exposiciones de archivo, charlas sobre el pasado de Miami.",
  },
  climate: {
    en: "Climate-focused events — sea-level-rise talks, hurricane prep, sustainability panels, resilience workshops.",
    es: "Eventos sobre el clima — charlas sobre el aumento del nivel del mar, preparación para huracanes, paneles de sostenibilidad, talleres de resiliencia.",
  },
  nature: {
    en: "Everglades programs, wildlife events, beach cleanups, bird walks, reef and park talks.",
    es: "Programas en los Everglades, eventos de vida silvestre, limpiezas de playa, recorridos de aves, charlas sobre el arrecife y los parques.",
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
