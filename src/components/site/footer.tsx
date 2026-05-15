import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"

import { api } from "../../../convex/_generated/api"
import { useTranslation } from "@/lib/i18n/context"
import { localizeSectionName } from "@/lib/i18n/sections"
import { sectionThemeStyle, useSectionAccent } from "@/lib/section-theme"

export function Footer() {
  const { t, lang } = useTranslation()
  const { data: sections } = useQuery(convexQuery(api.sections.list, {}))
  const year = new Date().getFullYear()
  const sectionAccent = useSectionAccent()
  const themed = sectionAccent !== null

  // Build the section taxonomy: top-level sections become column heads,
  // each with its sub-sections listed beneath. This mirrors the editorial
  // structure (News → Politics, Business…; Sports → Heat, Marlins…)
  // instead of the previous flat alphabetized dump.
  const all = sections ?? []
  const topLevels = all
    .filter((s) => !s.parentId)
    .sort((a, b) => a.order - b.order)
  const childrenOf = (parentId: string) =>
    all
      .filter((s) => (s.parentId as string | undefined) === parentId)
      .sort((a, b) => a.order - b.order)

  return (
    // Off-section: keep the `.dark` class flip so the footer reads as
    // the high-contrast bottom of the page.
    // On-section: take a tinted background AND repaint the foreground
    // tokens via `.themed-chrome` (same class the masthead uses) so the
    // logo, byline, and section links all read in the section's -950 /
    // -200 voice. The top border-t takes the section's full accent color
    // — mirror of the heavy rule under the masthead's MainNav.
    <footer
      className={
        themed
          ? "themed-chrome mt-16 bg-[var(--section-bg-light)] dark:bg-[var(--section-bg-dark)]"
          : "dark mt-16 bg-background text-foreground"
      }
      style={
        themed && sectionAccent ? sectionThemeStyle(sectionAccent) : undefined
      }
    >
      {/* Top accent rule lives on the inner `container-page` div, not the
          full-bleed footer, so it visually mirrors the masthead's bottom
          rule under the MainNav (also container-width). */}
      <div
        className={
          themed
            ? "container-page border-t pt-10 pb-10"
            : "container-page border-t border-foreground pt-10 pb-10"
        }
        style={themed && sectionAccent ? { borderColor: sectionAccent } : undefined}
      >
        {/* Brand block on top, taxonomy grid below — gives the brand a
            full-width line so it reads as the publication mark, not as
            another column. */}
        <div className="flex flex-col gap-4 pb-8 md:max-w-prose">
          <Link to="/" className="font-brand text-3xl leading-[0.85] md:text-4xl">
            {t("brand.name")}
          </Link>
          <p className="meta">{t("footer.tagline")}</p>
        </div>

        {/* Taxonomy grid. One column per top-level section (header is
            the section link; sub-sections list under it). Independent
            top-level sections without children still get their own
            column — the heading itself is the destination. */}
        <nav
          aria-label={t("footer.sections")}
          className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
        >
          {topLevels.map((parent) => {
            const children = childrenOf(parent._id)
            return (
              <div key={parent._id}>
                <h3 className="font-sans text-sm font-semibold tracking-tight">
                  <Link
                    to="/section/$slug"
                    params={{ slug: parent.slug }}
                    className="hover:underline"
                  >
                    {localizeSectionName(parent, lang)}
                  </Link>
                </h3>
                {children.length > 0 ? (
                  <ul className="flex flex-col gap-1 mt-2">
                    {children.map((child) => (
                      <li key={child._id}>
                        <Link
                          to="/section/$slug"
                          params={{ slug: child.slug }}
                          className="text-sm text-muted-foreground hover:underline hover:text-foreground"
                        >
                          {localizeSectionName(child, lang)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )
          })}
        </nav>

        <div className="mt-10 flex flex-col-reverse items-start justify-between gap-2 border-t border-border pt-6 md:flex-row md:items-center">
          <p className="meta">{t("footer.copyright", { year })}</p>
          <p className="meta">{t("footer.byline")}</p>
        </div>
      </div>
    </footer>
  )
}
