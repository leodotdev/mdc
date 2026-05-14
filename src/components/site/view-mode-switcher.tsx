import { Calendar, LayoutGrid, List, MapPin } from "lucide-react"

import { useViewMode } from "@/lib/view-mode"
import type { ViewMode } from "@/lib/view-mode"
import { cn } from "@/lib/utils"

// Four-segment toggle that sits in the masthead's utility row after
// the search icon. Default mode (the current newspaper layout) is the
// implicit "off" state and uses the LayoutGrid icon — the alternates
// are List / Month / Map. Compact icon-only on mobile; the active
// segment fills with the section accent (via `themed-chrome` tokens)
// so the masthead's section-tinted chrome carries through.
const ORDER: ReadonlyArray<{
  mode: ViewMode
  label: string
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
}> = [
  { mode: "default", label: "Newspaper", Icon: LayoutGrid },
  { mode: "list", label: "List", Icon: List },
  { mode: "month", label: "Month", Icon: Calendar },
  { mode: "map", label: "Map", Icon: MapPin },
]

export function ViewModeSwitcher() {
  const { mode, setMode } = useViewMode()
  return (
    <div
      role="radiogroup"
      aria-label="View mode"
      className="flex items-center rounded-md border border-border bg-background/40 p-0.5"
    >
      {ORDER.map(({ mode: m, label, Icon }) => {
        const active = m === mode
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setMode(m)}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded transition-colors",
              active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
          </button>
        )
      })}
    </div>
  )
}
