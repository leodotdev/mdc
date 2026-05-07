import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import {
  BookOpen,
  CalendarClock,
  Lightbulb,
  Quote,
  Squirrel,
} from "lucide-react"

import { api } from "../../../convex/_generated/api"
import { SectionHeaderCell } from "@/components/editorial/section-header-cell"
import { Skeleton } from "@/components/ui/skeleton"
import { WildlifeIllustration } from "@/components/widgets/wildlife-illustration"

// Right-rail widget set fed by `widgetContent`. One Convex query reads
// all five kinds in a single subscription; each component picks its
// own row from the result. Daily refresh runs at 04:30 ET via cron;
// when a kind doesn't refresh on a given day, the previous day's row
// continues to show because `current` returns the most-recent per
// kind.

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

function useEntry(kind: WidgetKind): Entry | undefined | null {
  // null = loaded but absent; undefined = still loading.
  const { data } = useQuery(convexQuery(api.widgets.current, {}))
  if (!data) return undefined
  const row = data[kind]
  if (!row) return null
  return {
    title: row.title,
    body: row.body,
    attribution: row.attribution,
    imageUrl: row.imageUrl,
  }
}

function WidgetShell({
  kind,
  children,
}: {
  kind: WidgetKind
  children: React.ReactNode
}) {
  const { label } = KIND_META[kind]
  return (
    <div>
      <SectionHeaderCell title={label} />
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
  const entry = useEntry(kind)
  if (entry === undefined) return <WidgetSkeleton kind={kind} />
  if (entry === null) return null
  return (
    <WidgetShell kind={kind}>
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
