import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"

const STORAGE_KEY = "miami.theme"
const DEFAULT_THEME: Theme = "light"

export type Theme = "light" | "dark"

type ThemeContextValue = {
  theme: Theme
  setTheme: (theme: Theme) => void
  /** True after we've read localStorage on mount — avoid flash hints. */
  hydrated: boolean
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

// Mirrors `LangProvider` shape — reads/writes the active theme from
// localStorage on mount, applies / removes `.dark` on the <html> root
// so the existing CSS variable overrides take effect, and exposes a
// stable setter for the switcher.
//
// The CSS side is already wired (see `.dark { ... }` in styles.css) —
// every utility that reads from `--background` / `--foreground` / `--card`
// / etc. flips automatically when the class is on the root.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    const next: Theme = stored === "dark" ? "dark" : "light"
    setThemeState(next)
    applyTheme(next)
    setHydrated(true)
  }, [])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    localStorage.setItem(STORAGE_KEY, next)
    applyTheme(next)
  }, [])

  const value = useMemo(
    () => ({ theme, setTheme, hydrated }),
    [theme, setTheme, hydrated],
  )

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  )
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return
  const root = document.documentElement
  if (theme === "dark") root.classList.add("dark")
  else root.classList.remove("dark")
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    // Same SSR-safe fallback pattern as useTranslation.
    return {
      theme: DEFAULT_THEME,
      setTheme: () => {},
      hydrated: false,
    }
  }
  return ctx
}
