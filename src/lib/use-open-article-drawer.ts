import { useNavigate } from "@tanstack/react-router"

// Single source of truth for "open this article in the drawer". Every
// article `<Link>` on the public surface wires this onto onClick so plain
// or modified left-clicks land the reader in the drawer rather than the
// dedicated `/article/$slug` route. Middle / right click fall through so
// browser native "Open in new tab" still works (in the new tab there's
// no source page, so the article route loads directly — which is the
// only in-app way to reach the route apart from the drawer's "Open as
// full page" footer link).
export function useOpenArticleDrawer() {
  const navigate = useNavigate()
  return (slug: string, e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    void navigate({
      search: ((prev: Record<string, unknown>) => ({
        ...prev,
        article: slug,
      })) as never,
    })
  }
}

// Event drawer sibling. Same shape, different search-param key
// (`?event=slug`). Used by the events-only public site so newspaper
// cards open the EventDrawer instead of the ArticleDrawer.
export function useOpenEventDrawer() {
  const navigate = useNavigate()
  return (slug: string, e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    void navigate({
      search: ((prev: Record<string, unknown>) => ({
        ...prev,
        event: slug,
      })) as never,
    })
  }
}
