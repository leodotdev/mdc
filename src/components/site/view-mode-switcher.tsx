import { useViewMode } from "@/lib/view-mode"
import type { ViewMode } from "@/lib/view-mode"
import { cn } from "@/lib/utils"

// Text-label switcher styled like the language switcher — bold for the
// active mode, muted for the rest. Sits at the top-center of the
// masthead utility row so it reads as a primary axis (the lens you're
// viewing the city through), not a buried preference.
const ORDER: ReadonlyArray<{ mode: ViewMode; label: string }> = [
  { mode: "default", label: "Paper" },
  { mode: "list", label: "List" },
  { mode: "month", label: "Month" },
  { mode: "map", label: "Map" },
]

export function ViewModeSwitcher({ className }: { className?: string }) {
  const { mode, setMode } = useViewMode()
  return (
    <nav
      aria-label="View mode"
      className={cn("flex items-center gap-4 text-xs", className)}
    >
      {ORDER.map(({ mode: m, label }) => {
        const active = m === mode
        return (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-current={active ? "true" : undefined}
            className={cn(
              "transition-colors hover:text-foreground",
              active
                ? "font-bold text-foreground"
                : "font-medium text-muted-foreground",
            )}
          >
            {label}
          </button>
        )
      })}
    </nav>
  )
}
