import { Outlet, createFileRoute } from "@tanstack/react-router"

import { ArticleDrawer } from "@/components/site/article-drawer"
import { EventDrawer } from "@/components/site/event-drawer"
import { Footer } from "@/components/site/footer"
import { Masthead } from "@/components/site/masthead"
import { SearchCommandProvider } from "@/components/site/search-command"

type SiteSearch = {
  article?: string
  event?: string
  /** View-mode override (Newspaper / List / Month / Map). Persisted
   *  via ViewModeProvider in localStorage; this param wins when
   *  present for shareable links. */
  view?: "default" | "list" | "month" | "map"
  /** Month-view current month, "YYYY-MM". */
  month?: string
}

export const Route = createFileRoute("/_site")({
  validateSearch: (search: Record<string, unknown>): SiteSearch => ({
    article:
      typeof search.article === "string" && search.article.length > 0
        ? search.article
        : undefined,
    event:
      typeof search.event === "string" && search.event.length > 0
        ? search.event
        : undefined,
    view:
      search.view === "list" ||
      search.view === "month" ||
      search.view === "map" ||
      search.view === "default"
        ? search.view
        : undefined,
    month:
      typeof search.month === "string" && /^\d{4}-\d{2}$/.test(search.month)
        ? search.month
        : undefined,
  }),
  component: SiteLayout,
})

function SiteLayout() {
  return (
    <SearchCommandProvider>
      <div className="flex min-h-dvh flex-col bg-background">
        <Masthead />
        <main className="container-page flex-1 py-8 md:py-12">
          <Outlet />
        </main>
        <Footer />
        <ArticleDrawer />
        <EventDrawer />
      </div>
    </SearchCommandProvider>
  )
}
