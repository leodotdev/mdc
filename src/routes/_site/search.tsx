import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import { Search as SearchIcon, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { api } from "../../../convex/_generated/api"
import { PageHeader } from "@/components/editorial/page-header"
import { StoryItem } from "@/components/editorial/story-item"
import { Button } from "@/components/ui/button"
import { useTranslation } from "@/lib/i18n/context"

type SearchSearch = { q?: string }

export const Route = createFileRoute("/_site/search")({
  validateSearch: (search: Record<string, unknown>): SearchSearch => ({
    q: typeof search.q === "string" ? search.q : undefined,
  }),
  head: () => ({
    meta: [{ title: "Search · miami.community" }],
  }),
  component: SearchPage,
})

// Debounce — keep typing snappy without pummeling the search index. 200ms
// is short enough to feel live, long enough to coalesce most keystrokes.
const DEBOUNCE_MS = 200

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

function SearchPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const search = Route.useSearch()
  const initialQuery = search.q ?? ""
  const [query, setQuery] = useState(initialQuery)
  const debounced = useDebounced(query, DEBOUNCE_MS)
  const inputRef = useRef<HTMLInputElement>(null)

  // Mirror the live query into the URL so deep-links work and back/forward
  // restore previous searches. Replace history rather than push so the back
  // button doesn't step through every keystroke.
  useEffect(() => {
    const desired = debounced.trim() || undefined
    if (desired === search.q) return
    void navigate({
      to: "/search",
      search: { q: desired },
      replace: true,
    })
  }, [debounced, navigate, search.q])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const trimmed = debounced.trim()
  const tooShort = trimmed.length < 2

  const { data: results, isFetching } = useQuery({
    ...convexQuery(api.articles.search, { query: trimmed, limit: 30 }),
    enabled: !tooShort,
  })

  return (
    <div className="space-y-8">
      <PageHeader
        kicker={t("search.kicker")}
        title={t("search.title")}
        dek={t("search.subtitle")}
      />

      <div className="relative">
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          ref={inputRef}
          type="search"
          autoComplete="off"
          spellCheck="false"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search.placeholder")}
          className="w-full rounded-md border border-foreground bg-background py-3 pl-12 pr-12 text-lg outline-none transition-colors focus:border-primary"
          aria-label={t("search.aria")}
        />
        {query ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Clear"
            className="absolute top-1/2 right-2 -translate-y-1/2"
            onClick={() => {
              setQuery("")
              inputRef.current?.focus()
            }}
          >
            <X />
          </Button>
        ) : null}
      </div>

      {tooShort ? (
        <p className="meta">{t("search.tooShort")}</p>
      ) : isFetching && !results ? (
        <p className="meta">{t("search.searching")}</p>
      ) : !results || results.length === 0 ? (
        <div className="font-editorial max-w-2xl text-lg text-muted-foreground">
          <p>
            {t("search.empty.prefix")}{" "}
            <span className="font-bold">"{trimmed}"</span>.
          </p>
          <p className="mt-3 text-base">
            {t("search.empty.suffix")}{" "}
            <Link to="/" className="underline">
              {t("notFound.home")}
            </Link>
            .
          </p>
        </div>
      ) : (
        <section>
          <p className="meta mb-4">
            {t("search.results.count", {
              count: results.length,
              label:
                results.length === 1
                  ? t("search.results.singular")
                  : t("search.results.plural"),
            })}{" "}
            <span className="font-bold text-foreground">"{trimmed}"</span>
          </p>
          <ul className="grid gap-x-10 gap-y-8 md:grid-cols-2 lg:grid-cols-3">
            {results.map((article) => (
              <li key={article._id}>
                <StoryItem
                  article={article}
                  layout={article.heroImage ? "image-top" : "text-only"}
                  size="default"
                  showDek
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
