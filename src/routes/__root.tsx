import type { QueryClient } from "@tanstack/react-query"
import {
  HeadContent,
  Link,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router"
import { TanStackDevtools } from "@tanstack/react-devtools"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"

import appCss from "../styles.css?url"
import { Toaster } from "@/components/ui/sonner"
import { LangProvider } from "@/lib/i18n/context"
import { ThemeProvider } from "@/lib/theme/context"

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        name: "description",
        content:
          "Hyper-local Miami news, culture, sports, food, and the things that make Miami Miami. Aggregated from local sources, edited by humans, sourced and cited.",
      },
      { title: "miami.community" },
      { property: "og:site_name", content: "miami.community" },
      { property: "og:type", content: "website" },
    ],
    links: [
      // Momo Signature (brand display): served from Google Fonts. We load
      // it via a <link> here rather than @import in CSS because Tailwind
      // v4 / Vite hoist @import to the top of the bundled stylesheet but
      // can drop external @imports during the JIT pass — the link tag is
      // the reliable path. preconnect speeds up the round trip.
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Momo+Signature&display=swap",
      },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico" },
    ],
  }),
  notFoundComponent: () => (
    <main className="mx-auto max-w-xl px-4 py-16">
      <p className="kicker text-muted-foreground">404</p>
      <h1 className="display-lg mt-2">
        That page is not part of today's edition.
      </h1>
      <p className="font-editorial mt-4 text-lg text-muted-foreground">
        The story you're looking for may have been moved, archived, or simply
        never written.
      </p>
      <div className="mt-8 flex flex-wrap gap-4 text-sm">
        <Link
          to="/"
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/85"
        >
          Back to the front page
        </Link>
        <Link
          to="/about"
          className="rounded-md border px-4 py-2 hover:bg-muted"
        >
          About miami.community
        </Link>
      </div>
    </main>
  ),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider>
          <LangProvider>{children}</LangProvider>
        </ThemeProvider>
        <Toaster richColors closeButton />
        {import.meta.env.DEV ? (
          <TanStackDevtools
            config={{ position: "bottom-right" }}
            plugins={[
              {
                name: "Tanstack Router",
                render: <TanStackRouterDevtoolsPanel />,
              },
            ]}
          />
        ) : null}
        <Scripts />
      </body>
    </html>
  )
}
