import { Link, useNavigate } from "@tanstack/react-router"
import { Search } from "lucide-react"
import { useEffect } from "react"

import { LanguageSwitcher } from "./language-switcher"
import { ThemeSwitcher } from "./theme-switcher"
import { MainNav } from "./main-nav"
import { MobileNav } from "./mobile-nav"
import { TrendingBar } from "./trending-bar"
import { Button } from "@/components/ui/button"
import { useTranslation } from "@/lib/i18n/context"

export function Masthead() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  // ⌘K / Ctrl+K opens search from anywhere on the site. Skips when the user
  // is already typing into an input or contenteditable so we don't steal a
  // keystroke they meant for a form.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "k" || (!e.metaKey && !e.ctrlKey)) return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return
      }
      e.preventDefault()
      void navigate({ to: "/search" })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [navigate])

  return (
    <header className="bg-background">
      {/* ───── Top utility row ───── */}
      <div>
        <div className="container-page flex h-12 items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <MobileNav />
            <Link to="/search" aria-label={t("search.aria")}>
              <Button variant="ghost" size="icon-sm" tabIndex={-1}>
                <Search />
              </Button>
            </Link>
          </div>
          <div className="hidden items-center gap-4 sm:flex">
            <LanguageSwitcher />
            <span
              aria-hidden
              className="h-3 w-px bg-foreground/20"
            />
            <ThemeSwitcher />
          </div>
        </div>
      </div>

      {/* ───── Nameplate + tagline ───── */}
      <div className="container-page pt-6 pb-3 md:pt-9 md:pb-4">
        <div className="flex flex-col items-center text-center">
          <Link
            to="/"
            className="font-brand leading-[0.85]"
            aria-label={t("masthead.aria.home")}
          >
            <span className="block text-3xl md:text-6xl lg:text-7xl">
              {t("brand.name")}
            </span>
          </Link>
          <p
            aria-hidden
            className="font-heading mt-3 text-sm italic text-muted-foreground md:text-base"
          >
            {" "}
          </p>
        </div>
      </div>

      {/* ───── Section nav ───── */}
      <div className="hidden md:block">
        <div className="container-page border-b border-foreground">
          <MainNav />
        </div>
      </div>

      {/* ───── Trending bar ───── */}
      <div>
        <div className="container-page">
          <TrendingBar />
        </div>
      </div>
    </header>
  )
}
