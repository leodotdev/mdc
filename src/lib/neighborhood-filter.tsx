import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"

import { NEIGHBORHOODS } from "../../convex/lib/neighborhoods"

// Site-wide neighborhood filter. Default state ("all selected") is the
// empty set — every event renders. Once the user picks one or more
// neighborhoods, only events whose `neighborhoods[]` overlap the
// selected set render anywhere on the site.
//
// State is mirrored into the URL (`?hoods=wynwood,brickell`) for
// shareability and into localStorage so the choice survives a
// navigation or visit. Cross-tab updates flow via the `storage` event.
//
// Apply via `useNeighborhoodFilter().matches(event)` — anywhere an
// event list is rendered, filter through this predicate first.

const STORAGE_KEY = "miami.neighborhoodFilter"
const URL_PARAM = "hoods"

const VALID_SLUGS: Set<string> = new Set(NEIGHBORHOODS.map((n) => n.slug))

function sanitize(slugs: ReadonlyArray<string>): Array<string> {
  const seen = new Set<string>()
  const out: Array<string> = []
  for (const s of slugs) {
    if (!VALID_SLUGS.has(s)) continue
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

function parseSlugList(raw: string | null | undefined): Array<string> {
  if (!raw) return []
  return sanitize(raw.split(",").map((s) => s.trim()).filter(Boolean))
}

type Ctx = {
  /** Sorted slugs currently selected. Empty array = "all selected"
   *  (no filter active). */
  selected: ReadonlyArray<string>
  setSelected: (slugs: ReadonlyArray<string>) => void
  /** Convenience: toggle one slug. When the set ends up empty AND the
   *  user removed the last item, we treat that as "select all" so the
   *  feed doesn't go blank. */
  toggle: (slug: string) => void
  /** Convenience: clear back to "all selected". */
  clear: () => void
  /** True once the provider has read URL + localStorage. */
  hydrated: boolean
  /** Hide events that don't match the current filter. Events with an
   *  empty `neighborhoods` array hide when ANY filter is active —
   *  there's no signal to know whether they belong. */
  matches: (event: { neighborhoods?: ReadonlyArray<string> | null }) => boolean
}

const NeighborhoodFilterContext = createContext<Ctx | null>(null)

export function NeighborhoodFilterProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [selected, setSelectedState] = useState<ReadonlyArray<string>>([])
  const [hydrated, setHydrated] = useState(false)

  // Hydration order: URL param wins (shareable links), then
  // localStorage, then default empty (all).
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const fromUrl = parseSlugList(params.get(URL_PARAM))
      if (fromUrl.length > 0) {
        setSelectedState(fromUrl)
        setHydrated(true)
        return
      }
    } catch {
      // window may be unavailable.
    }
    try {
      const stored = parseSlugList(localStorage.getItem(STORAGE_KEY))
      if (stored.length > 0) setSelectedState(stored)
    } catch {
      // storage unavailable.
    }
    setHydrated(true)
  }, [])

  const setSelected = useCallback((next: ReadonlyArray<string>) => {
    const cleaned = sanitize(next).sort()
    setSelectedState(cleaned)
    try {
      if (cleaned.length === 0) {
        localStorage.removeItem(STORAGE_KEY)
      } else {
        localStorage.setItem(STORAGE_KEY, cleaned.join(","))
      }
    } catch {
      // ignore
    }
    // Sync to URL — drop the param entirely when filter is inactive.
    try {
      const url = new URL(window.location.href)
      if (cleaned.length === 0) {
        url.searchParams.delete(URL_PARAM)
      } else {
        url.searchParams.set(URL_PARAM, cleaned.join(","))
      }
      window.history.replaceState({}, "", url.toString())
    } catch {
      // ignore
    }
  }, [])

  const toggle = useCallback(
    (slug: string) => {
      if (!VALID_SLUGS.has(slug)) return
      const has = selected.includes(slug)
      const next = has ? selected.filter((s) => s !== slug) : [...selected, slug]
      setSelected(next)
    },
    [selected, setSelected],
  )

  const clear = useCallback(() => setSelected([]), [setSelected])

  const matches = useCallback(
    (event: { neighborhoods?: ReadonlyArray<string> | null }) => {
      if (selected.length === 0) return true
      const tags = event.neighborhoods ?? []
      if (tags.length === 0) return false
      for (const t of tags) {
        if (selected.includes(t)) return true
      }
      return false
    },
    [selected],
  )

  // Cross-tab sync.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return
      setSelectedState(parseSlugList(e.newValue))
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const value = useMemo<Ctx>(
    () => ({ selected, setSelected, toggle, clear, hydrated, matches }),
    [selected, setSelected, toggle, clear, hydrated, matches],
  )

  return (
    <NeighborhoodFilterContext.Provider value={value}>
      {children}
    </NeighborhoodFilterContext.Provider>
  )
}

export function useNeighborhoodFilter(): Ctx {
  const ctx = useContext(NeighborhoodFilterContext)
  if (!ctx) {
    return {
      selected: [],
      setSelected: () => {},
      toggle: () => {},
      clear: () => {},
      hydrated: false,
      matches: () => true,
    }
  }
  return ctx
}
