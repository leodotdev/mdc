import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import {
  BookOpen,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  Quote,
  Squirrel,
} from "lucide-react"
import { useState } from "react"

import { api } from "../../../convex/_generated/api"
import { SectionHeaderCell } from "@/components/editorial/section-header-cell"
import { Skeleton } from "@/components/ui/skeleton"
import { WildlifeIllustration } from "@/components/widgets/wildlife-illustration"

// Right-rail widget set fed by `widgetContent`. Daily refresh runs at
// 04:30 ET via cron and produces one new row per kind. The UI shows
// today's entry by default, with ‹ › chevrons that walk backward
// through the historical entries (most-recent first; chevron-left
// goes one day older, chevron-right returns to newer).

const KIND_META = {
  "fun-fact": {
    label: "Did you know",
    icon: Lightbulb,
  },
  "on-this-day": {
    label: "On this day in Miami",
    icon: CalendarClock,
  },
  landmark: {
    label: "Miami landmark",
    icon: BookOpen,
  },
  "animal-fact": {
    label: "Local wildlife",
    icon: Squirrel,
  },
  quote: {
    label: "Quotable Miamian",
    icon: Quote,
  },
} as const

type WidgetKind = keyof typeof KIND_META

type Entry = {
  title: string
  body: string
  attribution?: string
  imageUrl?: string
}

function useEntries(kind: WidgetKind):
  | { entries: Array<Entry>; loading: false }
  | { entries: null; loading: true } {
  const { data } = useQuery(
    convexQuery(api.widgets.recentByKind, { kind, limit: 30 }),
  )
  if (!data) return { entries: null, loading: true }
  return {
    entries: data.map((row) => ({
      title: row.title,
      body: row.body,
      attribution: row.attribution,
      imageUrl: row.imageUrl,
    })),
    loading: false,
  }
}

function WidgetShell({
  kind,
  cursor,
  total,
  onPrev,
  onNext,
  children,
}: {
  kind: WidgetKind
  /** Zero-indexed position into the history (0 = today). Hidden when
   *  total ≤ 1 because there's nowhere to navigate. */
  cursor?: number
  total?: number
  onPrev?: () => void
  onNext?: () => void
  children: React.ReactNode
}) {
  const { label } = KIND_META[kind]
  const showNav = total !== undefined && total > 1
  const canPrev = showNav && cursor !== undefined && cursor < total - 1
  const canNext = showNav && cursor !== undefined && cursor > 0
  return (
    <div>
      <SectionHeaderCell
        title={label}
        right={
          showNav ? (
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={onPrev}
                disabled={!canPrev}
                aria-label={`Older ${label}`}
                className="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronLeft className="size-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={onNext}
                disabled={!canNext}
                aria-label={`Newer ${label}`}
                className="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronRight className="size-3.5" aria-hidden />
              </button>
            </div>
          ) : null
        }
      />
      <div className="pt-3 pb-1">{children}</div>
    </div>
  )
}

function WidgetSkeleton({ kind }: { kind: WidgetKind }) {
  return (
    <WidgetShell kind={kind}>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-2 h-12 w-full" />
    </WidgetShell>
  )
}

// Generic body — used by every kind except `quote`, which has its own
// pull-quote treatment. `showTitle` suppresses the entry title for
// kinds whose widget label already says it (e.g. "Did you know" — the
// LLM's "Did you know?" title is just noise duplication).
function StandardBody({
  entry,
  showTitle = true,
}: {
  entry: Entry
  showTitle?: boolean
}) {
  return (
    <div>
      {showTitle ? (
        <p className="font-sans text-sm font-semibold leading-snug">
          {entry.title}
        </p>
      ) : null}
      <p
        className={
          "font-editorial text-sm leading-snug text-muted-foreground" +
          (showTitle ? " mt-1.5" : "")
        }
      >
        {entry.body}
      </p>
      {entry.attribution ? (
        <p className="meta mt-1.5 text-[0.65rem]">— {entry.attribution}</p>
      ) : null}
    </div>
  )
}

function QuoteBody({ entry }: { entry: Entry }) {
  return (
    <figure>
      <blockquote className="font-editorial text-base italic leading-snug text-foreground">
        &ldquo;{entry.body}&rdquo;
      </blockquote>
      <figcaption className="meta mt-2 text-xs">
        — {entry.attribution ?? entry.title}
      </figcaption>
    </figure>
  )
}

function GenericWidget({ kind }: { kind: WidgetKind }) {
  const result = useEntries(kind)
  const [cursor, setCursor] = useState(0)
  if (result.loading) return <WidgetSkeleton kind={kind} />
  const entries = result.entries
  if (entries.length === 0) return null
  // Clamp cursor to current bounds — entries can shrink between renders
  // (e.g. cron purges old rows), so anchor to the last valid index.
  const safeCursor = Math.min(cursor, entries.length - 1)
  const entry = entries[safeCursor]
  return (
    <WidgetShell
      kind={kind}
      cursor={safeCursor}
      total={entries.length}
      onPrev={() =>
        setCursor((c) => Math.min(entries.length - 1, c + 1))
      }
      onNext={() => setCursor((c) => Math.max(0, c - 1))}
    >
      {kind === "quote" ? (
        <QuoteBody entry={entry} />
      ) : kind === "animal-fact" ? (
        <AnimalFactBody entry={entry} />
      ) : (
        <StandardBody entry={entry} showTitle={kind !== "fun-fact"} />
      )}
    </WidgetShell>
  )
}

// Animal-fact body — adds a watercolor illustration of the species
// above the standard text block. The illustration loads asynchronously
// from Wikipedia; if it fails the widget still reads correctly.
function AnimalFactBody({ entry }: { entry: Entry }) {
  return (
    <div>
      <WildlifeIllustration species={entry.title} className="mb-3" />
      <StandardBody entry={entry} />
    </div>
  )
}

// Public exports — one component per widget kind, all share the same
// internals. Callers stack them in the right rail in whatever order
// reads best for the page.

export function FunFactWidget() {
  return <GenericWidget kind="fun-fact" />
}
export function OnThisDayWidget() {
  return <GenericWidget kind="on-this-day" />
}
export function LandmarkWidget() {
  return <GenericWidget kind="landmark" />
}
export function AnimalFactWidget() {
  return <GenericWidget kind="animal-fact" />
}
export function QuoteWidget() {
  return <GenericWidget kind="quote" />
}
