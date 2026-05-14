import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"

// Four global view modes for every feed page (homepage, section, tag,
// neighborhood). Switched via the masthead toggle and persisted in
// localStorage. Each page's renderer branches on the active mode:
//
//   default — the newspaper layout we ship today (WaPo-style stacked
//             hero blocks, importance-ranked). The implicit "off"
//             state for the alternate views.
//   list    — pure chronological list of events for the current page
//             scope (section / tag / neighborhood / homepage = all),
//             sorted by startsAt, grouped by day.
//   month   — full-month calendar grid; events appear on their start
//             dates, with overflow as "+N more".
//   map     — Mapbox view; events pinned by location, clustered when
//             dense.
//
// URL param `?view=list` (etc.) overrides the stored preference for
// shareability. Default mode is unchanged from what the site shipped
// before this feature — readers who never touch the switcher see the
// newspaper.
export type ViewMode = "default" | "list" | "month" | "map"

const STORAGE_KEY = "miami.viewMode"
const DEFAULT_MODE: ViewMode = "default"

function isValidMode(s: string | null | undefined): s is ViewMode {
  return s === "default" || s === "list" || s === "month" || s === "map"
}

type ViewModeContextValue = {
  mode: ViewMode
  setMode: (mode: ViewMode) => void
  /** True once the provider has read localStorage. Components that
   *  swap layouts on mode change should hold the default until this
   *  flips to avoid SSR/CSR flicker on first paint. */
  hydrated: boolean
}

const ViewModeContext = createContext<ViewModeContextValue | null>(null)

export function ViewModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ViewMode>(DEFAULT_MODE)
  const [hydrated, setHydrated] = useState(false)

  // Hydration order on the client:
  //   1. URL `?view=` param — wins when present (lets shared links
  //      land in the right view regardless of localStorage).
  //   2. localStorage.
  //   3. DEFAULT_MODE.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const fromUrl = params.get("view")
      if (isValidMode(fromUrl)) {
        setModeState(fromUrl)
        setHydrated(true)
        return
      }
    } catch {
      // Ignore — window may be unavailable during early hydration.
    }
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isValidMode(stored)) setModeState(stored)
    setHydrated(true)
  }, [])

  const setMode = useCallback((next: ViewMode) => {
    setModeState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Storage may be unavailable (private browsing); preference
      // still applies for this session.
    }
    // Sync into the URL so the current view is shareable / refresh-
    // safe. Drop the param when switching back to default so URLs
    // stay clean for the most common case.
    try {
      const url = new URL(window.location.href)
      if (next === "default") {
        url.searchParams.delete("view")
      } else {
        url.searchParams.set("view", next)
      }
      window.history.replaceState({}, "", url.toString())
    } catch {
      // Ignore — bail silently if URL manipulation fails.
    }
  }, [])

  // Cross-tab sync: when another tab flips the mode, mirror it here
  // so the switcher state stays consistent.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return
      if (isValidMode(e.newValue)) setModeState(e.newValue)
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const value = useMemo(
    () => ({ mode, setMode, hydrated }),
    [mode, setMode, hydrated],
  )

  return (
    <ViewModeContext.Provider value={value}>
      {children}
    </ViewModeContext.Provider>
  )
}

export function useViewMode(): ViewModeContextValue {
  const ctx = useContext(ViewModeContext)
  if (!ctx) {
    return { mode: DEFAULT_MODE, setMode: () => {}, hydrated: false }
  }
  return ctx
}
