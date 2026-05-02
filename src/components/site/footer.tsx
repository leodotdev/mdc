import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"

import { api } from "../../../convex/_generated/api"
import { useTranslation } from "@/lib/i18n/context"
import { localizeSectionName } from "@/lib/i18n/sections"

export function Footer() {
  const { t, lang } = useTranslation()
  const { data: sections } = useQuery(convexQuery(api.sections.list, {}))
  const year = new Date().getFullYear()

  return (
    // The `dark` class flips the CSS-variable color tokens within the
    // footer subtree (the `.dark` block in styles.css overrides
    // --background, --foreground, --muted-foreground, --border, etc.),
    // so every utility that reads from those tokens auto-themes — no
    // dark-specific class lists needed in this file.
    <footer className="dark mt-16 border-t border-border bg-background text-foreground">
      <div className="container-page py-10">
        <div className="grid gap-10 md:grid-cols-[2fr_3fr]">
          <div>
            <Link to="/" className="font-brand text-3xl leading-[0.85] md:text-4xl">
              {t("brand.name")}
            </Link>
            <p className="meta mt-3 max-w-prose">{t("footer.tagline")}</p>
          </div>
          <div>
            <h2 className="kicker text-foreground">{t("footer.sections")}</h2>
            <ul className="mt-3 grid grid-cols-2 gap-y-1.5 sm:grid-cols-3">
              {(sections ?? []).map((s) => (
                <li key={s._id}>
                  <Link
                    to="/section/$slug"
                    params={{ slug: s.slug }}
                    className="text-sm hover:underline"
                  >
                    {localizeSectionName(s, lang)}
                  </Link>
                </li>
              ))}
              <li>
                <Link to="/about" className="text-sm hover:underline">
                  {t("nav.about")}
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-10 flex flex-col-reverse items-start justify-between gap-2 border-t border-border pt-6 md:flex-row md:items-center">
          <p className="meta">{t("footer.copyright", { year })}</p>
          <p className="meta">{t("footer.byline")}</p>
        </div>
      </div>
    </footer>
  )
}
