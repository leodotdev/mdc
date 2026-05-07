import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Calendar, FileText, Hash, MapPin } from "lucide-react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"

import { api } from "../../../convex/_generated/api"
import { NEIGHBORHOODS } from "../../../convex/lib/neighborhoods"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { useTranslation } from "@/lib/i18n/context"
import { localizeSectionName } from "@/lib/i18n/sections"

// 150ms keeps typing live without slamming Convex on every character.
const DEBOUNCE_MS = 150

type Ctx = {
  open: boolean
  setOpen: (next: boolean) => void
}

const SearchCommandContext = createContext<Ctx | null>(null)

export function useSearchCommand(): Ctx {
  const ctx = useContext(SearchCommandContext)
  if (!ctx) {
    throw new Error(
      "useSearchCommand must be used inside <SearchCommandProvider>",
    )
  }
  return ctx
}

export function SearchCommandProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)

  // ⌘K / Ctrl+K toggles the palette globally. Skips when the user is already
  // typing into a regular input — the palette's own input is fine because
  // when it's open we always want ⌘K to close it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "k" || (!e.metaKey && !e.ctrlKey)) return
      const target = e.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      if (typing && !open) return
      e.preventDefault()
      setOpen((p) => !p)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  const value = useMemo(() => ({ open, setOpen }), [open])

  return (
    <SearchCommandContext.Provider value={value}>
      {children}
      <SearchCommand />
    </SearchCommandContext.Provider>
  )
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

function SearchCommand() {
  const { open, setOpen } = useSearchCommand()
  const { lang, t } = useTranslation()
  const navigate = useNavigate()

  const [query, setQuery] = useState("")
  const debounced = useDebounced(query, DEBOUNCE_MS)
  const trimmed = debounced.trim()
  const enabled = trimmed.length >= 2

  // Reset the query whenever the dialog reopens. Without this the previous
  // session's query persists, which feels stale when the user re-opens to
  // run a fresh search.
  useEffect(() => {
    if (!open) setQuery("")
  }, [open])

  const { data: articles } = useQuery({
    ...convexQuery(api.articles.search, { query: trimmed, limit: 5 }),
    enabled,
  })
  const { data: events } = useQuery({
    ...convexQuery(api.events.search, { query: trimmed, limit: 5 }),
    enabled,
  })
  const { data: sections } = useQuery(convexQuery(api.sections.list, {}))

  // Sections + neighborhoods are tiny static-ish lists; filter locally so we
  // don't pay a Convex round-trip per keystroke.
  const filteredSections = useMemo(() => {
    const all = (sections ?? []).filter((s) => !s.parentId)
    if (!enabled) return all.slice(0, 6)
    const q = trimmed.toLowerCase()
    return all
      .filter((s) => localizeSectionName(s, lang).toLowerCase().includes(q))
      .slice(0, 5)
  }, [sections, enabled, trimmed, lang])

  const filteredNeighborhoods = useMemo(() => {
    if (!enabled) return NEIGHBORHOODS.slice(0, 6)
    const q = trimmed.toLowerCase()
    return NEIGHBORHOODS.filter((n) => n.name.toLowerCase().includes(q)).slice(
      0,
      5,
    )
  }, [enabled, trimmed])

  const close = useCallback(() => setOpen(false), [setOpen])

  const goArticle = useCallback(
    (slug: string) => {
      close()
      void navigate({
        search: ((prev: Record<string, unknown>) => ({
          ...prev,
          article: slug,
        })) as never,
      })
    },
    [close, navigate],
  )

  const goEvent = useCallback(
    (slug: string) => {
      close()
      void navigate({
        search: ((prev: Record<string, unknown>) => ({
          ...prev,
          event: slug,
        })) as never,
      })
    },
    [close, navigate],
  )

  const goSection = useCallback(
    (slug: string) => {
      close()
      void navigate({ to: "/section/$slug", params: { slug } })
    },
    [close, navigate],
  )

  const goNeighborhood = useCallback(
    (slug: string) => {
      close()
      void navigate({ to: "/neighborhood/$slug", params: { slug } })
    },
    [close, navigate],
  )

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t("search.title")}
      description={t("search.subtitle")}
      showCloseButton={false}
    >
      <CommandInput
        placeholder={t("search.placeholder")}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {enabled ? (
          <CommandEmpty>
            {t("search.empty.prefix")} "{trimmed}".
          </CommandEmpty>
        ) : null}

        {articles && articles.length > 0 ? (
          <CommandGroup heading={t("searchPalette.articles")}>
            {articles.map((a) => (
              <CommandItem
                key={a._id}
                value={`article:${a._id}:${a.title}`}
                onSelect={() => goArticle(a.slug)}
              >
                <FileText />
                <span className="truncate">{a.title}</span>
                {a.section ? (
                  <span className="text-muted-foreground ml-auto text-xs">
                    {localizeSectionName(a.section, lang)}
                  </span>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {events && events.length > 0 ? (
          <>
            {articles && articles.length > 0 ? <CommandSeparator /> : null}
            <CommandGroup heading={t("searchPalette.events")}>
              {events.map((e) => (
                <CommandItem
                  key={e._id}
                  value={`event:${e._id}:${e.title}`}
                  onSelect={() => e.slug && goEvent(e.slug)}
                >
                  <Calendar />
                  <span className="truncate">{e.title}</span>
                  {e.section ? (
                    <span className="text-muted-foreground ml-auto text-xs">
                      {localizeSectionName(e.section, lang)}
                    </span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        {filteredSections.length > 0 ? (
          <>
            {(articles && articles.length > 0) ||
            (events && events.length > 0) ? (
              <CommandSeparator />
            ) : null}
            <CommandGroup heading={t("searchPalette.sections")}>
              {filteredSections.map((s) => (
                <CommandItem
                  key={s._id}
                  value={`section:${s._id}:${localizeSectionName(s, lang)}`}
                  onSelect={() => goSection(s.slug)}
                >
                  <Hash style={{ color: s.accentColor }} />
                  <span>{localizeSectionName(s, lang)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        {filteredNeighborhoods.length > 0 ? (
          <>
            {(articles && articles.length > 0) ||
            (events && events.length > 0) ||
            filteredSections.length > 0 ? (
              <CommandSeparator />
            ) : null}
            <CommandGroup heading={t("searchPalette.neighborhoods")}>
              {filteredNeighborhoods.map((n) => (
                <CommandItem
                  key={n.slug}
                  value={`neighborhood:${n.slug}:${n.name}`}
                  onSelect={() => goNeighborhood(n.slug)}
                >
                  <MapPin />
                  <span>{n.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  )
}
