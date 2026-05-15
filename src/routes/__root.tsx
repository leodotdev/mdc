import {
  HeadContent,
  Link,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router"
import { TanStackDevtools } from "@tanstack/react-devtools"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"

// Static asset URLs for the two most-used local fonts. Vite resolves
// these to hashed `/assets/*.woff2` paths at build time so we can emit a
// `<link rel="preload">` for each — without this, the font request can't
// kick off until the CSS bundle has been parsed (the `@font-face` rule
// is what triggers it). Preloading parallelizes font fetch with HTML
// parsing, eliminating the 600ms+ render block we were paying for them.
import bodoniLatinWght from "@fontsource-variable/bodoni-moda/files/bodoni-moda-latin-wght-normal.woff2?url"
import franklinLatinWght from "@fontsource-variable/libre-franklin/files/libre-franklin-latin-wght-normal.woff2?url"
import appCss from "../styles.css?url"
import type { QueryClient } from "@tanstack/react-query"
import { Toaster } from "@/components/ui/sonner"
import { WatercolorFilterDefs } from "@/components/widgets/wildlife-illustration"
import { LangProvider } from "@/lib/i18n/context"
import { ViewModeProvider } from "@/lib/view-mode"
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
      // Preload local font woff2 so the request runs in parallel with
      // HTML parsing instead of waiting for the CSS bundle to be parsed.
      // `crossOrigin: anonymous` is required for the preload to match
      // the eventual `@font-face` request (fonts are always cross-origin
      // by spec). We only preload the latin subset normal-weight files —
      // latin-ext / italic / cyrillic / vietnamese are handled by the
      // `@font-face` rules' `unicode-range` gating and don't fetch
      // unless those glyphs render.
      {
        rel: "preload",
        as: "font",
        type: "font/woff2",
        href: bodoniLatinWght,
        crossOrigin: "anonymous",
      },
      {
        rel: "preload",
        as: "font",
        type: "font/woff2",
        href: franklinLatinWght,
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
      </div>
    </main>
  ),
  shellComponent: RootDocument,
})

// Pre-hydration script that flips `<html lang>` to the user's stored
// preference (cookie first, falling back to localStorage) before React
// mounts. Avoids a brief mismatch where assistive tech / browser UI
// reads English while the page itself renders Spanish. Mirrors the
// dark-mode FOUC-prevention pattern.
const LANG_INIT_SCRIPT = `
(function() {
  try {
    var m = document.cookie.match(/(?:^|; )miami\\.lang=(en|es)/);
    var v = m ? m[1] : null;
    if (!v) v = localStorage.getItem('miami.lang');
    if (v === 'en' || v === 'es') document.documentElement.lang = v;
  } catch (e) {}
})();
`

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{ __html: LANG_INIT_SCRIPT }}
        />
      </head>
      <body>
        <ThemeProvider>
          <LangProvider>
            <ViewModeProvider>{children}</ViewModeProvider>
          </LangProvider>
        </ThemeProvider>
        <Toaster richColors closeButton />
        <WatercolorFilterDefs />
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
