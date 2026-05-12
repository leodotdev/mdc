import { Link } from "@tanstack/react-router"
import { Search } from "lucide-react"

import { LanguageSwitcher } from "./language-switcher"
import { ThemeSwitcher } from "./theme-switcher"
import { MainNav } from "./main-nav"
import { MobileNav } from "./mobile-nav"
import { useSearchCommand } from "./search-command"
import { SubNav } from "./sub-nav"
import { Button } from "@/components/ui/button"
import { useTranslation } from "@/lib/i18n/context"
import { sectionThemeStyle, useSectionAccent } from "@/lib/section-theme"

export function Masthead() {
  const { t } = useTranslation()
  const sectionAccent = useSectionAccent()
  const { setOpen } = useSearchCommand()

  // When on a section page, the entire masthead reads in that section's
  // mini-paper voice. We expose three palette steps as CSS vars on the
  // header — fg (-950 / -200), muted (-700 / -400), faint (-200 / -800)
  // — and the `.themed-masthead` class (defined in styles.css) repoints
  // `--color-foreground`, `--color-muted-foreground`, and `--color-border`
  // at them. That means existing tokens inside the masthead — logo's
  // inherited `text-foreground`, the language switcher's
  // `text-muted-foreground`, the divider's border color — pick up the
  // section's tone without any per-component changes. No opacity dimming
  // anywhere; everything is a direct palette step on the active section.
  const themed = sectionAccent !== null
  return (
    <header
      className={
        themed
          ? "themed-chrome bg-[var(--section-bg-light)] dark:bg-[var(--section-bg-dark)]"
          : "bg-background"
      }
      style={
        themed && sectionAccent ? sectionThemeStyle(sectionAccent) : undefined
      }
    >
      {/* ───── Top utility row ───── */}
      <div>
        <div className="container-page flex h-12 items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <MobileNav />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("search.aria")}
              onClick={() => setOpen(true)}
            >
              <Search />
            </Button>
          </div>
          <div className="hidden items-center gap-4 sm:flex">
            <LanguageSwitcher />
            <span
              aria-hidden
              className="h-3 w-px bg-border"
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
            <span className="block text-2xl md:text-5xl lg:text-6xl">
              {t("brand.name")}
            </span>
          </Link>
          <p className="font-heading mt-3 text-sm italic text-muted-foreground md:text-base">
            {t("masthead.tagline")}
          </p>
        </div>
      </div>

      {/* ───── Section nav ───── */}
      {/* On a themed (section) route, the bottom divider takes the
          section's full accent color so it acts as the page's color rule
          — same visual cue as the SectionHeaderCell pattern used inside
          page blocks. Off-section, falls back to the standard
          foreground rule. */}
      <div className="hidden md:block">
        <div
          className={
            themed
              ? "container-page border-b"
              : "container-page border-b border-foreground"
          }
          style={
            themed
              ? { borderColor: sectionAccent ?? undefined }
              : undefined
          }
        >
          <MainNav />
        </div>
        {/* Sub-section nav — sits below the main nav divider. Renders
            on /section/$slug pages whose parent has children, OR the
            time-range strip on /events. Both share the same SubNav
            sizing / spacing / centering so the chrome reads consistent
            across the family of routes. Forces the page's neutral bg
            so the section-tinted chrome above stops at the divider. */}
        <div className="bg-background">
          <div className="container-page">
            <SubNav />
          </div>
        </div>
      </div>

    </header>
  )
}
