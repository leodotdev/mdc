import type { Lang } from "@/lib/i18n/strings"
import { useTranslation } from "@/lib/i18n/context"
import { cn } from "@/lib/utils"

const LANGS: Array<{ code: Lang; labelKey: "lang.english" | "lang.spanish" }> = [
  { code: "en", labelKey: "lang.english" },
  { code: "es", labelKey: "lang.spanish" },
]

// Edition / language switcher driven by the shared LangProvider so every
// translated label across the site updates the moment the user picks a
// language.
export function LanguageSwitcher({ className }: { className?: string }) {
  const { lang, setLang, hydrated, t } = useTranslation()

  return (
    <nav
      aria-label={t("lang.label")}
      className={cn("flex items-center gap-4 text-xs", className)}
    >
      {LANGS.map((l) => {
        const active = hydrated && lang === l.code
        return (
          <button
            key={l.code}
            type="button"
            onClick={() => setLang(l.code)}
            aria-current={active ? "true" : undefined}
            className={cn(
              "transition-colors hover:text-foreground",
              active
                ? "font-bold text-foreground"
                : "font-medium text-muted-foreground",
            )}
          >
            {t(l.labelKey)}
          </button>
        )
      })}
    </nav>
  )
}
