// Centralized UI string table. Add a new key in both `en` and `es`; the
// types ensure callers pass a known key. Article content (title, dek, body)
// is NOT translated here — that needs a per-article translation pipeline.

export const STRINGS = {
  en: {
    // Masthead / chrome
    "brand.name": "miami.community",
    "masthead.aria.home": "miami.community — home",
    "trending.label": "Trending",
    "search.aria": "Search",
    "search.kicker": "Search",
    "search.title": "Find an event",
    "search.subtitle":
      "Search across every published event — by title, venue, neighborhood, or tag.",
    "search.placeholder": "Titles, venues, neighborhoods…",
    "search.tooShort": "Type at least two characters to search.",
    "search.searching": "Searching…",
    "search.empty.prefix": "No results for",
    "search.empty.suffix":
      "Try a broader term or a neighborhood name. Or browse",
    "search.results.count":
      "{count} {label} for",
    "search.results.singular": "result",
    "search.results.plural": "results",
    "searchPalette.events": "Events",
    "searchPalette.sections": "Sections",
    "searchPalette.neighborhoods": "Neighborhoods",
    "lang.label": "Language",
    "lang.english": "English",
    "lang.spanish": "Español",
    "theme.label": "Theme",
    "theme.light": "Light",
    "theme.dark": "Dark",

    // Nav
    "nav.events": "Events",
    "nav.neighborhoods": "Neighborhoods",
    "nav.menu": "Open menu",
    "nav.signOut": "Sign out",

    // Mobile drawer
    "drawer.sections": "Sections",
    "drawer.more": "More",
    "drawer.edition": "Edition",

    // Homepage
    "home.empty.title": "Today's edition is being prepared",
    "home.empty.body":
      "Once the calendars publish their first events, they'll appear here.",
    "home.subtitle.todaysEdition": "Today's edition",
    "home.thingsToDo": "Things to Do",
    "home.onTheCalendar": "On the Calendar",
    "home.opinion": "Opinion",
    "home.trending": "Trending",
    "home.moreTopStories": "More Top Events",
    "home.allLink": "All →",
    "home.empty.calendar": "Nothing on the calendar yet.",
    "home.section.more": "More →",

    // Events
    "events.kicker": "Events",
    "rail.popular": "Popular",
    "rail.popularIn": "Popular in {name}",
    "events.subtitle":
      "Concerts, openings, festivals, neighborhood happenings — every approved event in Miami this month.",
    "events.fullSchedule": "The full schedule",
    "events.empty.title": "No events scheduled for {month} yet.",
    "events.empty.bodyPrefix":
      "Editors add events from the admin tools. Check back soon, or jump to",
    "events.today": "Today",
    "events.prevMonth.label": "Previous month: {month}",
    "events.nextMonth.label": "Next month: {month}",

    // Section page
    "section.empty.title": "No published events in {section} yet.",
    "section.empty.body": "Browse the front page or check another section.",
    "section.alsoIn": "Also in {section}",

    // Article meta
    "article.relatedTitle": "Event series",
    "article.relatedSubtitle": "{count} events · in order",
    "article.moreFromSection": "More from {section}",

    // Footer
    "footer.sections": "Sections",
    "footer.tagline":
      "Every event in Miami, gathered from the calendars that run the city — concerts, openings, council meetings, ballgames, gallery nights — and put in one place.",
    "footer.copyright": "© {year} miami.community",
    "footer.byline": "Established 2026",

    // 404
    "notFound.kicker": "404",
    "notFound.title": "That page is not part of today's edition.",
    "notFound.body":
      "The event you're looking for may have been moved, archived, or simply never added.",
    "notFound.home": "Back to the front page",
    "notFound.about": "About miami.community",
  },
  es: {
    // Masthead / chrome
    "brand.name": "miami.comunidad",
    "masthead.aria.home": "miami.comunidad — inicio",
    "trending.label": "Tendencias",
    "search.aria": "Buscar",
    "search.kicker": "Buscar",
    "search.title": "Encuentra un evento",
    "search.subtitle":
      "Busca entre todos los eventos publicados — por título, lugar, barrio o etiqueta.",
    "search.placeholder": "Títulos, lugares, barrios…",
    "search.tooShort": "Escribe al menos dos caracteres para buscar.",
    "search.searching": "Buscando…",
    "search.empty.prefix": "Sin resultados para",
    "search.empty.suffix":
      "Prueba con un término más amplio o el nombre de un barrio. O explora",
    "search.results.count": "{count} {label} para",
    "search.results.singular": "resultado",
    "search.results.plural": "resultados",
    "searchPalette.events": "Eventos",
    "searchPalette.sections": "Secciones",
    "searchPalette.neighborhoods": "Barrios",
    "lang.label": "Idioma",
    "theme.label": "Tema",
    "theme.light": "Claro",
    "theme.dark": "Oscuro",
    "lang.english": "English",
    "lang.spanish": "Español",

    // Nav
    "nav.events": "Eventos",
    "nav.neighborhoods": "Barrios",
    "nav.menu": "Abrir menú",
    "nav.signOut": "Cerrar sesión",

    // Mobile drawer
    "drawer.sections": "Secciones",
    "drawer.more": "Más",
    "drawer.edition": "Edición",

    // Homepage
    "home.empty.title": "La edición de hoy está en preparación",
    "home.empty.body":
      "Cuando los calendarios publiquen sus primeros eventos, aparecerán aquí.",
    "home.subtitle.todaysEdition": "Edición de hoy",
    "home.thingsToDo": "Qué hacer",
    "home.onTheCalendar": "En la agenda",
    "home.opinion": "Opinión",
    "home.trending": "Tendencias",
    "home.moreTopStories": "Más eventos destacados",
    "home.allLink": "Todos →",
    "home.empty.calendar": "Aún no hay nada en la agenda.",
    "home.section.more": "Más →",

    // Events
    "events.kicker": "Eventos",
    "rail.popular": "Populares",
    "rail.popularIn": "Populares en {name}",
    "events.subtitle":
      "Conciertos, aperturas, festivales, eventos de barrio — todos los eventos aprobados en Miami este mes.",
    "events.fullSchedule": "Agenda completa",
    "events.empty.title": "Aún no hay eventos para {month}.",
    "events.empty.bodyPrefix":
      "Los editores añaden eventos desde las herramientas de administración. Vuelve pronto o salta a",
    "events.today": "Hoy",
    "events.prevMonth.label": "Mes anterior: {month}",
    "events.nextMonth.label": "Mes siguiente: {month}",

    // Section page
    "section.empty.title": "Aún no hay eventos publicados en {section}.",
    "section.empty.body": "Explora la portada o revisa otra sección.",
    "section.alsoIn": "También en {section}",

    // Article meta
    "article.relatedTitle": "Serie de eventos",
    "article.relatedSubtitle": "{count} eventos · en orden",
    "article.moreFromSection": "Más de {section}",

    // Footer
    "footer.sections": "Secciones",
    "footer.tagline":
      "Todos los eventos de Miami, reunidos desde los calendarios que mueven la ciudad — conciertos, inauguraciones, reuniones del concejo, partidos, noches de galerías — en un solo lugar.",
    "footer.copyright": "© {year} miami.community",
    "footer.byline": "Fundado en 2026",

    // 404
    "notFound.kicker": "404",
    "notFound.title": "Esa página no forma parte de la edición de hoy.",
    "notFound.body":
      "El evento que buscas puede haber sido movido, archivado, o simplemente nunca se añadió.",
    "notFound.home": "Volver a la portada",
    "notFound.about": "Sobre miami.community",
  },
} as const

export type Lang = keyof typeof STRINGS
export type StringKey = keyof (typeof STRINGS)["en"]

export function interpolate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`))
}
