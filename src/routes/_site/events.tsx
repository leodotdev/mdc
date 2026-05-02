import { convexQuery } from "@convex-dev/react-query"
import { keepPreviousData, useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useCallback, useRef, useState } from "react"

import { api } from "../../../convex/_generated/api"
import { CalendarList } from "@/components/events/calendar-list"
import { CalendarMonth } from "@/components/events/calendar-month"
import { CalendarWeek } from "@/components/events/calendar-week"
import { EventListItem } from "@/components/events/event-list-item"
import { HappeningNowStrip } from "@/components/events/happening-now-strip"
import { PageHeader } from "@/components/editorial/page-header"
import { SectionHeaderCell } from "@/components/editorial/section-header-cell"
import { StoryItem } from "@/components/editorial/story-item"
import { Button } from "@/components/ui/button"
import { convexSuspenseQuery } from "@/lib/convex-suspense"
import {
  addWeeksUTC,
  dayKey,
  formatEventDate,
  monthLabel,
  startOfMonth,
  startOfNextMonth,
  startOfWeekUTC,
} from "@/lib/event-helpers"
import { useTranslation } from "@/lib/i18n/context"
import {
  EVENT_KINDS,
  isEventKind,
} from "../../../convex/lib/eventKinds"
import type { EventKindSlug } from "../../../convex/lib/eventKinds"
import { cn } from "@/lib/utils"

type CalendarView = "week" | "list" | "month"

type EventsSearch = {
  view?: CalendarView
  year?: number
  month?: number
  kind?: EventKindSlug
}

// Initial week-view range — pre-load this many weeks behind + ahead of
// today's week so the user can scroll a bit each direction before
// triggering a network round-trip via the sentinel observers.
const INITIAL_WEEKS_BEHIND = 4
const INITIAL_WEEKS_AHEAD = 8
const WEEKS_LOAD_INCREMENT = 4

function todayWeekStart(): number {
  return startOfWeekUTC(Date.now())
}

export const Route = createFileRoute("/_site/events")({
  validateSearch: (search: Record<string, unknown>): EventsSearch => {
    const now = new Date()
    const yearRaw = Number(search.year)
    const monthRaw = Number(search.month)
    const kindRaw =
      typeof search.kind === "string" && isEventKind(search.kind)
        ? search.kind
        : undefined
    const viewRaw: CalendarView =
      search.view === "month"
        ? "month"
        : search.view === "list"
          ? "list"
          : "week"
    return {
      view: viewRaw,
      year:
        Number.isFinite(yearRaw) && yearRaw > 2020 && yearRaw < 2100
          ? yearRaw
          : now.getFullYear(),
      month:
        Number.isFinite(monthRaw) && monthRaw >= 1 && monthRaw <= 12
          ? monthRaw
          : now.getMonth() + 1,
      kind: kindRaw,
    }
  },
  loaderDeps: ({ search }) => ({
    view: search.view ?? "week",
    year: search.year,
    month: search.month,
    kind: search.kind,
  }),
  loader: async ({ context, deps }) => {
    const now = new Date()
    const year = deps.year ?? now.getFullYear()
    const month = deps.month ?? now.getMonth() + 1
    const view = deps.view
    // For week view, pre-fetch the initial scroll window. For month view,
    // pre-fetch the requested calendar month.
    const range =
      view === "week"
        ? {
            rangeStart: addWeeksUTC(
              todayWeekStart(),
              -INITIAL_WEEKS_BEHIND,
            ),
            rangeEnd: addWeeksUTC(
              todayWeekStart(),
              INITIAL_WEEKS_AHEAD + 1,
            ),
          }
        : {
            rangeStart: startOfMonth(year, month),
            rangeEnd: startOfNextMonth(year, month),
          }
    await Promise.all([
      context.queryClient.ensureQueryData(
        convexQuery(api.events.inRange, {
          ...range,
          kind: deps.kind,
        }),
      ),
      context.queryClient.ensureQueryData(
        convexQuery(api.articles.listBySection, {
          sectionSlug: "things-to-do",
          paginationOpts: { numItems: 12, cursor: null },
        }),
      ),
    ])
  },
  head: () => ({
    meta: [{ title: "Events · miami.community" }],
  }),
  component: EventsPage,
})

function EventsPage() {
  const { t } = useTranslation()
  const search = Route.useSearch()
  const view: CalendarView = search.view ?? "week"
  const now = new Date()
  const year = search.year ?? now.getFullYear()
  const month = search.month ?? now.getMonth() + 1

  return (
    <div className="space-y-10">
      <PageHeader
        kicker={t("events.kicker")}
        kickerColor="oklch(0.6 0.118 184.704)"
        title={
          view === "month" ? monthLabel(year, month) : t("events.kicker")
        }
        dek={t("events.subtitle")}
        right={
          <ViewToggle
            current={view}
            kind={search.kind}
            year={year}
            month={month}
          />
        }
      />

      <KindFilter view={view} year={year} month={month} kind={search.kind} />

      {view === "week" ? (
        <WeekView kind={search.kind} />
      ) : view === "list" ? (
        <ListView kind={search.kind} />
      ) : (
        <MonthView year={year} month={month} kind={search.kind} />
      )}
    </div>
  )
}

function ViewToggle({
  current,
  kind,
  year,
  month,
}: {
  current: CalendarView
  kind?: EventKindSlug
  year: number
  month: number
}) {
  const cls = (active: boolean) =>
    cn(
      "rounded px-3 py-1 font-sans text-xs font-bold uppercase tracking-[0.12em] transition-colors",
      active
        ? "bg-foreground text-background"
        : "text-muted-foreground hover:text-foreground",
    )
  return (
    <nav className="flex items-center gap-1 rounded-md border p-0.5">
      <Link
        to="/events"
        search={{ view: "week", kind }}
        className={cls(current === "week")}
      >
        Week
      </Link>
      <Link
        to="/events"
        search={{ view: "list", kind }}
        className={cls(current === "list")}
      >
        List
      </Link>
      <Link
        to="/events"
        search={{ view: "month", year, month, kind }}
        className={cls(current === "month")}
      >
        Month
      </Link>
    </nav>
  )
}

function KindFilter({
  view,
  year,
  month,
  kind,
}: {
  view: CalendarView
  year: number
  month: number
  kind?: EventKindSlug
}) {
  // Week and list views are forward-only / live, so they don't carry
  // year+month in the URL. Month view does so the user can navigate.
  const baseSearch =
    view === "month"
      ? ({ view, year, month } as const)
      : ({ view } as const)
  return (
    <nav
      aria-label="Filter events by kind"
      className="-mt-4 flex flex-wrap items-center gap-2"
    >
      <Link
        to="/events"
        search={baseSearch}
        className={cn(
          "rounded-full border px-3 py-1 font-sans text-xs font-bold uppercase tracking-[0.12em] transition-colors",
          kind === undefined
            ? "border-foreground bg-foreground text-background"
            : "border-foreground/20 text-foreground hover:bg-muted",
        )}
      >
        All
      </Link>
      {EVENT_KINDS.map((k) => {
        const active = kind === k.slug
        return (
          <Link
            key={k.slug}
            to="/events"
            search={{ ...baseSearch, kind: k.slug }}
            className={cn(
              "rounded-full border px-3 py-1 font-sans text-xs font-bold uppercase tracking-[0.12em] transition-colors",
              active
                ? "text-background"
                : "border-foreground/20 text-foreground hover:bg-muted",
            )}
            style={
              active
                ? { background: k.accent, borderColor: k.accent }
                : undefined
            }
          >
            {k.label}
          </Link>
        )
      })}
    </nav>
  )
}

function WeekView({ kind }: { kind?: EventKindSlug }) {
  const [behind, setBehind] = useState(INITIAL_WEEKS_BEHIND)
  const [ahead, setAhead] = useState(INITIAL_WEEKS_AHEAD)

  // Range state expands as the user scrolls; query refetches reactively.
  const rangeStart = addWeeksUTC(todayWeekStart(), -behind)
  const rangeEnd = addWeeksUTC(todayWeekStart(), ahead + 1)

  // `keepPreviousData` so the calendar doesn't suspend / unmount each
  // time `behind` or `ahead` bumps — without it the IntersectionObserver
  // callback unmounts the tree → re-mounts → the leftmost sentinel ends
  // up in view at mount → fires again, causing the page to flash and
  // re-trigger loads in a loop. Initial mount is the only suspense
  // boundary; subsequent range changes keep prior data on screen.
  const { data: events } = useQuery({
    ...convexQuery(api.events.inRange, { rangeStart, rangeEnd, kind }),
    placeholderData: keepPreviousData,
  })
  if (!events) return null

  // Bucket events by Miami day so day rows don't have to scan the array.
  const eventsByDay = (() => {
    const map = new Map<string, typeof events>()
    for (const e of events) {
      const k = dayKey(e.startsAt)
      const list = map.get(k) ?? []
      list.push(e)
      map.set(k, list)
    }
    // Sort each day chronologically.
    for (const list of map.values())
      list.sort((a, b) => a.startsAt - b.startsAt)
    return map
  })()

  const weekStarts = (() => {
    const total = behind + 1 + ahead
    const out: Array<number> = []
    for (let i = 0; i < total; i += 1) {
      out.push(addWeeksUTC(todayWeekStart(), -behind + i))
    }
    return out
  })()

  // Cooldown guard — when the user lands on a sentinel and we expand
  // the range, the DOM shifts and the IntersectionObserver may briefly
  // re-fire the same callback as the layout settles. Without this guard
  // that re-fire bumps state again, expanding the range further, which
  // shifts the layout again — a loop that flashes the page. 800ms is
  // enough for the new content to render and the sentinel to be moved
  // off-screen by subsequent scrolls.
  const earlierCooldown = useRef(false)
  const laterCooldown = useRef(false)
  const onLoadEarlier = useCallback(() => {
    if (earlierCooldown.current) return
    earlierCooldown.current = true
    setBehind((b) => b + WEEKS_LOAD_INCREMENT)
    setTimeout(() => {
      earlierCooldown.current = false
    }, 800)
  }, [])
  const onLoadLater = useCallback(() => {
    if (laterCooldown.current) return
    laterCooldown.current = true
    setAhead((a) => a + WEEKS_LOAD_INCREMENT)
    setTimeout(() => {
      laterCooldown.current = false
    }, 800)
  }, [])

  return (
    <div className="space-y-8">
      <HappeningNowStrip events={events} />
      <CalendarWeek
        weekStarts={weekStarts}
        eventsByDay={eventsByDay}
        onLoadEarlier={onLoadEarlier}
        onLoadLater={onLoadLater}
      />
    </div>
  )
}

// Forward-only chronological list. Anchored at today (range start);
// bottom sentinel bumps `ahead` (in weeks) to extend the range. Same
// `keepPreviousData` + cooldown patterns as the week view to avoid
// flash + load loops.
const LIST_INITIAL_WEEKS = 6
const LIST_LOAD_INCREMENT = 6

function ListView({ kind }: { kind?: EventKindSlug }) {
  const [ahead, setAhead] = useState(LIST_INITIAL_WEEKS)
  const cooldownRef = useRef(false)

  // Range starts at midnight Miami "today" so events that started
  // earlier today still show up if they haven't ended yet.
  const today = new Date()
  const todayStart = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  )
  const rangeEnd = addWeeksUTC(todayStart, ahead)

  const { data: events, isFetching } = useQuery({
    ...convexQuery(api.events.inRange, {
      rangeStart: todayStart,
      rangeEnd,
      kind,
    }),
    placeholderData: keepPreviousData,
  })

  // Bucket by Miami day, drop empty days, sort chronologically.
  const daysWithEvents = (() => {
    const arr = events ?? []
    const map = new Map<string, typeof arr>()
    for (const e of arr) {
      const k = dayKey(e.startsAt)
      const list = map.get(k) ?? []
      list.push(e)
      map.set(k, list)
    }
    const keys = Array.from(map.keys()).sort()
    return keys.map((k) => {
      const list = map.get(k) ?? []
      list.sort((a, b) => a.startsAt - b.startsAt)
      return { dayKey: k, events: list }
    })
  })()

  const onLoadMore = useCallback(() => {
    if (cooldownRef.current) return
    cooldownRef.current = true
    setAhead((a) => a + LIST_LOAD_INCREMENT)
    setTimeout(() => {
      cooldownRef.current = false
    }, 800)
  }, [])

  return (
    <div className="space-y-8">
      <HappeningNowStrip events={events ?? []} />
      <CalendarList
        daysWithEvents={daysWithEvents}
        loading={isFetching}
        onLoadMore={onLoadMore}
      />
    </div>
  )
}

function MonthView({
  year,
  month,
  kind,
}: {
  year: number
  month: number
  kind?: EventKindSlug
}) {
  const { t } = useTranslation()
  const { data: events } = useSuspenseQuery(
    convexSuspenseQuery(api.events.inRange, {
      rangeStart: startOfMonth(year, month),
      rangeEnd: startOfNextMonth(year, month),
      kind,
    }),
  )
  const { data: stories } = useSuspenseQuery(
    convexSuspenseQuery(api.articles.listBySection, {
      sectionSlug: "things-to-do",
      paginationOpts: { numItems: 12, cursor: null },
    }),
  )

  const prev =
    month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
  const next =
    month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }

  // Group events by day for the list view.
  const groups = new Map<string, typeof events>()
  for (const e of events) {
    const key = dayKey(e.startsAt)
    const list = groups.get(key) ?? []
    list.push(e)
    groups.set(key, list)
  }
  const orderedDays = Array.from(groups.keys()).sort()
  const now = new Date()

  return (
    <div className="space-y-10">
      <nav className="flex items-center gap-2" aria-label={t("events.kicker")}>
        <Link
          to="/events"
          search={{ view: "month", ...prev, kind }}
          aria-label={t("events.prevMonth.label", {
            month: monthLabel(prev.year, prev.month),
          })}
        >
          <Button variant="outline" size="icon-sm" tabIndex={-1}>
            <ChevronLeft />
          </Button>
        </Link>
        <Link
          to="/events"
          search={{
            view: "month",
            year: now.getFullYear(),
            month: now.getMonth() + 1,
            kind,
          }}
          className="meta uppercase tracking-wider hover:underline"
        >
          {t("events.today")}
        </Link>
        <Link
          to="/events"
          search={{ view: "month", ...next, kind }}
          aria-label={t("events.nextMonth.label", {
            month: monthLabel(next.year, next.month),
          })}
        >
          <Button variant="outline" size="icon-sm" tabIndex={-1}>
            <ChevronRight />
          </Button>
        </Link>
      </nav>

      <CalendarMonth year={year} month={month} events={events} />

      {events.length === 0 ? (
        <div className="font-editorial mt-12 max-w-2xl text-lg text-muted-foreground">
          <p>{t("events.empty.title", { month: monthLabel(year, month) })}</p>
          <p className="mt-4 text-base">
            {t("events.empty.bodyPrefix")}{" "}
            <Link
              to="/events"
              search={{ view: "month", ...next, kind }}
              className="underline"
            >
              {monthLabel(next.year, next.month)}
            </Link>
            .
          </p>
        </div>
      ) : (
        <section>
          <SectionHeaderCell
            title={t("events.fullSchedule")}
            className="mb-6"
          />
          <div className="space-y-10">
            {orderedDays.map((key) => {
              const dayEvents = groups.get(key) ?? []
              if (dayEvents.length === 0) return null
              return (
                <section key={key}>
                  <h3 className="font-heading mb-4 text-2xl font-semibold tracking-[-0.015em]">
                    {formatEventDate(dayEvents[0].startsAt)}
                  </h3>
                  <ul className="grid gap-x-10 gap-y-8 md:grid-cols-2 lg:grid-cols-3">
                    {dayEvents.map((e) => (
                      <li key={e._id}>
                        <EventListItem event={e} />
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        </section>
      )}

      {stories.page.length > 0 ? (
        <section>
          <SectionHeaderCell
            title={t("events.stories")}
            className="mb-6"
          />
          <ul className="grid gap-x-10 gap-y-8 md:grid-cols-2 lg:grid-cols-3">
            {stories.page.map((article) => (
              <li key={article._id}>
                <StoryItem
                  article={article}
                  layout={article.heroImage ? "image-top" : "text-only"}
                  size="default"
                  showDek
                  showKicker={false}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
