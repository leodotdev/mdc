// Centralized UI string table. Add a new key in both `en` and `es`; the
// types ensure callers pass a known key. Article content (title, dek, body)
// is NOT translated here — that needs a per-article translation pipeline.

export const STRINGS = {
  en: {
    // Masthead / chrome
    "brand.name": "miami.community",
    "masthead.tagline": "Sourced. Cited. Local.",
    "masthead.aria.home": "miami.community — home",
    "trending.label": "Trending",
    "search.aria": "Search",
    "search.kicker": "Search",
    "search.title": "Find a story",
    "search.subtitle":
      "Search across every published article — by headline, standfirst, or tag.",
    "search.placeholder": "Headlines, neighborhoods, beats…",
    "search.tooShort": "Type at least two characters to search.",
    "search.searching": "Searching…",
    "search.empty.prefix": "No results for",
    "search.empty.suffix":
      "Try a broader term or a neighborhood name. Or browse",
    "search.results.count":
      "{count} {label} for",
    "search.results.singular": "result",
    "search.results.plural": "results",
    "lang.label": "Language",
    "lang.english": "English",
    "lang.spanish": "Español",
    "theme.label": "Theme",
    "theme.light": "Light",
    "theme.dark": "Dark",

    // Nav
    "nav.events": "Events",
    "nav.about": "About",
    "nav.menu": "Open menu",
    "nav.signOut": "Sign out",

    // Mobile drawer
    "drawer.sections": "Sections",
    "drawer.more": "More",
    "drawer.edition": "Edition",

    // Homepage
    "home.empty.title": "Today's edition is being prepared",
    "home.empty.body":
      "Once the desks file their first stories and an editor publishes them, they'll appear here.",
    "home.subtitle.todaysEdition": "Today's edition",
    "home.thingsToDo": "Things to Do",
    "home.onTheCalendar": "On the Calendar",
    "home.opinion": "Opinion",
    "home.mostRead": "Most Read",
    "home.moreTopStories": "More Top Stories",
    "home.allLink": "All →",
    "home.empty.calendar": "Nothing on the calendar yet.",
    "home.section.more": "More →",

    // Events
    "events.kicker": "Events",
    "events.subtitle":
      "Concerts, openings, festivals, neighborhood happenings — every approved event in Miami this month.",
    "events.fullSchedule": "The full schedule",
    "events.stories": "Stories",
    "events.empty.title": "No events scheduled for {month} yet.",
    "events.empty.bodyPrefix":
      "Editors add events from the admin tools. Check back soon, or jump to",
    "events.today": "Today",
    "events.prevMonth.label": "Previous month: {month}",
    "events.nextMonth.label": "Next month: {month}",

    // Section page
    "section.empty.title": "No published stories in {section} yet.",
    "section.empty.body": "Browse the front page or check how the newsroom works.",
    "section.alsoIn": "Also in {section}",

    // Article meta
    "article.relatedTitle": "Story arc",
    "article.relatedSubtitle": "{count} stories · in order",
    "article.moreFromSection": "More from {section}",

    // Footer
    "footer.sections": "Sections",
    "footer.tagline":
      "Hyper-local Miami news, aggregated from the city's best sources, edited by humans, sourced and cited.",
    "footer.copyright": "© {year} miami.community",
    "footer.byline":
      "Articles are AI-drafted from cited sources and edited by a human.",

    // 404
    "notFound.kicker": "404",
    "notFound.title": "That page is not part of today's edition.",
    "notFound.body":
      "The story you're looking for may have been moved, archived, or simply never written.",
    "notFound.home": "Back to the front page",
    "notFound.about": "About miami.community",
  },
  es: {
    // Masthead / chrome
    "brand.name": "miami.comunidad",
    "masthead.tagline": "Con fuentes. Citado. Local.",
    "masthead.aria.home": "miami.comunidad — inicio",
    "trending.label": "Tendencias",
    "search.aria": "Buscar",
    "search.kicker": "Buscar",
    "search.title": "Encuentra una historia",
    "search.subtitle":
      "Busca en todos los artículos publicados — por titular, sumario o etiqueta.",
    "search.placeholder": "Titulares, barrios, secciones…",
    "search.tooShort": "Escribe al menos dos caracteres para buscar.",
    "search.searching": "Buscando…",
    "search.empty.prefix": "Sin resultados para",
    "search.empty.suffix":
      "Prueba con un término más amplio o el nombre de un barrio. O explora",
    "search.results.count": "{count} {label} para",
    "search.results.singular": "resultado",
    "search.results.plural": "resultados",
    "lang.label": "Idioma",
    "theme.label": "Tema",
    "theme.light": "Claro",
    "theme.dark": "Oscuro",
    "lang.english": "English",
    "lang.spanish": "Español",

    // Nav
    "nav.events": "Eventos",
    "nav.about": "Acerca de",
    "nav.menu": "Abrir menú",
    "nav.signOut": "Cerrar sesión",

    // Mobile drawer
    "drawer.sections": "Secciones",
    "drawer.more": "Más",
    "drawer.edition": "Edición",

    // Homepage
    "home.empty.title": "La edición de hoy está en preparación",
    "home.empty.body":
      "Cuando las redacciones presenten sus primeras historias y un editor las publique, aparecerán aquí.",
    "home.subtitle.todaysEdition": "Edición de hoy",
    "home.thingsToDo": "Qué hacer",
    "home.onTheCalendar": "En la agenda",
    "home.opinion": "Opinión",
    "home.mostRead": "Lo más leído",
    "home.moreTopStories": "Más noticias",
    "home.allLink": "Todos →",
    "home.empty.calendar": "Aún no hay nada en la agenda.",
    "home.section.more": "Más →",

    // Events
    "events.kicker": "Eventos",
    "events.subtitle":
      "Conciertos, aperturas, festivales, eventos de barrio — todos los eventos aprobados en Miami este mes.",
    "events.fullSchedule": "Agenda completa",
    "events.stories": "Historias",
    "events.empty.title": "Aún no hay eventos para {month}.",
    "events.empty.bodyPrefix":
      "Los editores añaden eventos desde las herramientas de administración. Vuelve pronto o salta a",
    "events.today": "Hoy",
    "events.prevMonth.label": "Mes anterior: {month}",
    "events.nextMonth.label": "Mes siguiente: {month}",

    // Section page
    "section.empty.title": "Aún no hay historias publicadas en {section}.",
    "section.empty.body": "Explora la portada o revisa cómo funciona la redacción.",
    "section.alsoIn": "También en {section}",

    // Article meta
    "article.relatedTitle": "Hilo de la historia",
    "article.relatedSubtitle": "{count} historias · en orden",
    "article.moreFromSection": "Más de {section}",

    // Footer
    "footer.sections": "Secciones",
    "footer.tagline":
      "Noticias hiperlocales de Miami, reunidas de las mejores fuentes de la ciudad, editadas por personas, con citas y referencias.",
    "footer.copyright": "© {year} miami.community",
    "footer.byline":
      "Los artículos se redactan con IA a partir de fuentes citadas y los edita una persona.",

    // 404
    "notFound.kicker": "404",
    "notFound.title": "Esa página no forma parte de la edición de hoy.",
    "notFound.body":
      "La historia que buscas puede haber sido movida, archivada, o simplemente nunca se escribió.",
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
