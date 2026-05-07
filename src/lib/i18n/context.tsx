import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

import { STRINGS, interpolate } from "./strings"
import type { Lang, StringKey } from "./strings"

const STORAGE_KEY = "miami.lang"
const DEFAULT_LANG: Lang = "en"

type Translator = (key: StringKey, vars?: Record<string, string | number>) => string

type LangContextValue = {
  lang: Lang
  setLang: (lang: Lang) => void
  t: Translator
  hydrated: boolean
}

const LangContext = createContext<LangContextValue | null>(null)

// Provider sets/reads the active language from localStorage on mount,
// updates `<html lang>` so screen readers + browser UI follow, and exposes
// a stable `t()` translator that falls back to English then to the key
// itself if a string is missing.
export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === "en" || stored === "es") {
      setLangState(stored)
      document.documentElement.lang = stored
    }
    setHydrated(true)
  }, [])

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    localStorage.setItem(STORAGE_KEY, next)
    document.documentElement.lang = next
    // Cookie alongside localStorage so a future SSR pass can read the
    // preference and emit the right `lang` attribute on the server-
    // rendered HTML (Google + non-JS clients). 1-year expiry; Lax so it
    // ships on top-level navigations.
    document.cookie = `${STORAGE_KEY}=${next};max-age=${60 * 60 * 24 * 365};path=/;SameSite=Lax`
  }, [])

  const t: Translator = useCallback(
    (key, vars) => {
      const template =
        STRINGS[lang][key] ??
        STRINGS[DEFAULT_LANG][key] ??
        (key as string)
      return interpolate(template, vars)
    },
    [lang],
  )

  const value = useMemo(
    () => ({ lang, setLang, t, hydrated }),
    [lang, setLang, t, hydrated],
  )

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

export function useTranslation(): LangContextValue {
  const ctx = useContext(LangContext)
  if (!ctx) {
    // Allow components to be rendered outside the provider during early SSR
    // bootstrapping. Falls back to English without persistence.
    return {
      lang: DEFAULT_LANG,
      setLang: () => {},
      hydrated: false,
      t: (key, vars) =>
        interpolate(STRINGS[DEFAULT_LANG][key] ?? (key), vars),
    }
  }
  return ctx
}
