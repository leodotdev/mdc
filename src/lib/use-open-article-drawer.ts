import { useNavigate } from "@tanstack/react-router"

// Event-drawer hook. Newspaper cards open the EventDrawer via the
// `?event=slug` search param so plain left-clicks stay on the same
// route. Middle / right click fall through to native "open in new
// tab" which lands on the dedicated `/event/$slug` page.
//
// The article-era `useOpenArticleDrawer` was removed with the rest of
// the article surfaces.
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
