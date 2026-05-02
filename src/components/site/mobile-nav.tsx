import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Menu } from "lucide-react"
import { useState } from "react"

import { api } from "../../../convex/_generated/api"
import { LanguageSwitcher } from "./language-switcher"
import { ThemeSwitcher } from "./theme-switcher"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { useTranslation } from "@/lib/i18n/context"
import { localizeSectionName } from "@/lib/i18n/sections"

export function MobileNav() {
  const [open, setOpen] = useState(false)
  const { lang, t } = useTranslation()
  const { data: sections } = useQuery(convexQuery(api.sections.list, {}))

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={t("nav.menu")}>
            <Menu />
          </Button>
        }
      />
      <SheetContent side="left" className="flex w-80 flex-col p-0">
        <SheetHeader className="border-b border-foreground px-6 pt-6 pb-4">
          <SheetTitle className="font-brand text-2xl leading-[0.85]">
            {t("brand.name")}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <p className="kicker mb-3 text-foreground">{t("drawer.sections")}</p>
          <ul className="flex flex-col divide-y divide-border">
            {(sections ?? []).map((s) => (
              <li key={s._id}>
                <Link
                  to="/section/$slug"
                  params={{ slug: s.slug }}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between py-3 font-sans text-base font-semibold text-foreground transition-colors hover:text-primary"
                >
                  <span>{localizeSectionName(s, lang)}</span>
                  <span
                    aria-hidden
                    className="size-1.5 rounded-full opacity-70"
                    style={{ background: s.accentColor }}
                  />
                </Link>
              </li>
            ))}
            <li>
              <Link
                to="/events"
                onClick={() => setOpen(false)}
                className="flex items-center justify-between py-3 font-sans text-base font-semibold text-foreground transition-colors hover:text-primary"
              >
                {t("nav.events")}
              </Link>
            </li>
          </ul>

          <p className="kicker mt-8 mb-3 text-foreground">{t("drawer.more")}</p>
          <ul className="flex flex-col divide-y divide-border">
            <li>
              <Link
                to="/search"
                onClick={() => setOpen(false)}
                className="block py-3 font-sans text-base font-semibold text-foreground transition-colors hover:text-primary"
              >
                {t("search.kicker")}
              </Link>
            </li>
            <li>
              <Link
                to="/about"
                onClick={() => setOpen(false)}
                className="block py-3 font-sans text-base font-semibold text-foreground transition-colors hover:text-primary"
              >
                {t("nav.about")}
              </Link>
            </li>
          </ul>
        </div>

        <div className="border-t border-foreground px-6 py-4">
          <p className="kicker mb-2 text-muted-foreground">
            {t("drawer.edition")}
          </p>
          <div className="flex items-center gap-4">
            <LanguageSwitcher />
            <span aria-hidden className="h-3 w-px bg-foreground/20" />
            <ThemeSwitcher />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
