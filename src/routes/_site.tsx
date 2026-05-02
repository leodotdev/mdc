import { Outlet, createFileRoute } from "@tanstack/react-router"

import { ArticleDrawer } from "@/components/site/article-drawer"
import { Footer } from "@/components/site/footer"
import { Masthead } from "@/components/site/masthead"

type SiteSearch = {
  article?: string
}

export const Route = createFileRoute("/_site")({
  validateSearch: (search: Record<string, unknown>): SiteSearch => ({
    article:
      typeof search.article === "string" && search.article.length > 0
        ? search.article
        : undefined,
  }),
  component: SiteLayout,
})

function SiteLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <Masthead />
      <main className="container-page flex-1 py-8 md:py-12">
        <Outlet />
      </main>
      <Footer />
      <ArticleDrawer />
    </div>
  )
}
