import { Outlet, createFileRoute } from "@tanstack/react-router"

import { ArticleDrawer } from "@/components/site/article-drawer"
import { EventDrawer } from "@/components/site/event-drawer"
import { Footer } from "@/components/site/footer"
import { Masthead } from "@/components/site/masthead"
import { SearchCommandProvider } from "@/components/site/search-command"

type SiteSearch = {
  article?: string
  event?: string
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
