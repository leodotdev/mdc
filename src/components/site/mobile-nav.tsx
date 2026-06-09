import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Menu } from "lucide-react"
import { useState } from "react"

import { api } from "../../../convex/_generated/api"
import { LanguageSwitcher } from "./language-switcher"
import { useSearchCommand } from "./search-command"
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
  const { setOpen: setSearchOpen } = useSearchCommand()

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
          <SheetTitle className="font-brand text-4xl leading-[0.85]">
            {t("brand.name")}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <p className="kicker mb-3 text-foreground">{t("drawer.sections")}</p>
          <SectionTree
            sections={sections ?? []}
            onPick={() => setOpen(false)}
            lang={lang}
          />
          <p className="kicker mt-8 mb-3 text-foreground">{t("drawer.more")}</p>
          <ul className="flex flex-col divide-y divide-border">
            <li>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  setSearchOpen(true)
                }}
                className="block w-full py-3 text-start font-sans text-base font-semibold text-foreground transition-colors hover:text-primary"
              >
                {t("search.kicker")}
              </button>
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

// Hierarchical section list — top-level sections render at full
// weight, sub-sections indent under their parent at lighter weight.
// Mirrors the editorial taxonomy (News → Politics, Business; Sports
// → Heat, Marlins; etc.) so the drawer reads as a sitemap, not a
// flat dump.
function SectionTree({
  sections,
  onPick,
  lang,
}: {
  sections: Array<{
    _id: unknown
    slug: string
    name: string
    accentColor: string
    parentId?: unknown
    order: number
  }>
  onPick: () => void
  lang: "en" | "es"
}) {
  const topLevel = sections
    .filter((s) => !s.parentId)
    .sort((a, b) => a.order - b.order)
  const childrenOf = (parentId: unknown) =>
    sections
      .filter((s) => (s.parentId as string | undefined) === (parentId as string))
      .sort((a, b) => a.order - b.order)
  return (
    <ul className="flex flex-col">
      {topLevel.map((parent) => {
        const kids = childrenOf(parent._id)
        return (
          <li key={parent._id as string}>
            <Link
              to="/section/$slug"
              params={{ slug: parent.slug }}
              onClick={onPick}
              className="flex items-center justify-between border-t border-border py-3 font-sans text-base font-semibold text-foreground transition-colors hover:text-primary first:border-t-0"
            >
              <span>{localizeSectionName(parent, lang)}</span>
              <span
                aria-hidden
                className="size-1.5 rounded-full opacity-70"
                style={{ background: parent.accentColor }}
              />
            </Link>
            {kids.length > 0 ? (
              <ul className="flex flex-col">
                {kids.map((child) => (
                  <li key={child._id as string}>
                    <Link
                      to="/section/$slug"
                      params={{ slug: child.slug }}
                      onClick={onPick}
                      className="flex items-center justify-between border-t border-border py-2 pl-4 font-sans text-sm font-normal text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <span>{localizeSectionName(child, lang)}</span>
                      <span
                        aria-hidden
                        className="size-1 rounded-full opacity-50"
                        style={{ background: child.accentColor }}
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
