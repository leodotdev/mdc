import { Lightbulb, LightbulbOff } from "lucide-react"

import { useTranslation } from "@/lib/i18n/context"
import { useTheme } from "@/lib/theme/context"
import { cn } from "@/lib/utils"

// Single-icon theme toggle. Shows the bulb-on glyph in light mode and
// the bulb-off glyph in dark mode (current state, not target state) —
// click to flip. Paired alongside the LanguageSwitcher with a hairline
// divider between them in the masthead utility row.
export function ThemeSwitcher({ className }: { className?: string }) {
  const { theme, setTheme, hydrated } = useTheme()
  const { t } = useTranslation()
  const isDark = hydrated && theme === "dark"
  const Icon = isDark ? LightbulbOff : Lightbulb
  const next = isDark ? "light" : "dark"
  const labelKey = isDark ? "theme.light" : "theme.dark"
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={t(labelKey)}
      title={t(labelKey)}
      className={cn(
        "inline-flex items-center justify-center text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
    </button>
  )
}
