import { useQueries } from "@tanstack/react-query"
import { ExternalLink } from "lucide-react"

import { SectionHeaderCell } from "@/components/editorial/section-header-cell"
import { Skeleton } from "@/components/ui/skeleton"

type Team = {
  key: string
  name: string
  shortName: string
  league: string
  /** Sport glyph rendered next to the team name. Plain unicode so we don't
   *  carry an icon dependency for what's effectively decorative. */
  icon: string
  /** Official team website — opened in a new tab when the row is clicked. */
  website: string
  endpoint: string
}

const TEAMS: Array<Team> = [
  {
    key: "heat",
    name: "Miami Heat",
    shortName: "Heat",
    league: "NBA",
    icon: "🏀",
    website: "https://www.nba.com/heat",
    endpoint:
      "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/14/schedule?seasontype=2",
  },
  {
    key: "dolphins",
    name: "Miami Dolphins",
    shortName: "Dolphins",
    league: "NFL",
    icon: "🏈",
    website: "https://www.miamidolphins.com",
    endpoint:
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/15/schedule?seasontype=2",
  },
  {
    key: "marlins",
    name: "Miami Marlins",
    shortName: "Marlins",
    league: "MLB",
    icon: "⚾",
    website: "https://www.mlb.com/marlins",
    endpoint:
      "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/28/schedule?seasontype=2",
  },
  {
    key: "inter-miami",
    name: "Inter Miami CF",
    shortName: "Inter Miami",
    league: "MLS",
    icon: "⚽",
    website: "https://www.intermiamicf.com",
    endpoint:
      "https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/teams/20232/schedule?seasontype=2",
  },
  {
    key: "hurricanes",
    name: "Miami Hurricanes",
    shortName: "Hurricanes",
    league: "NCAAF",
    icon: "🏈",
    website: "https://miamihurricanes.com/sports/football/",
    endpoint:
      "https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/2390/schedule?seasontype=2",
  },
]

type EspnCompetitor = {
  team?: { displayName?: string; abbreviation?: string; shortDisplayName?: string }
  homeAway?: "home" | "away"
  score?: string | { value?: number; displayValue?: string }
  winner?: boolean
}

type EspnStatusType = {
  completed?: boolean
  state?: string
  description?: string
  shortDetail?: string
}

type EspnEvent = {
  id?: string
  date?: string
  name?: string
  shortName?: string
  status?: { type?: EspnStatusType }
  competitions?: Array<{
    status?: { type?: EspnStatusType }
    competitors?: Array<EspnCompetitor>
  }>
}

function statusOf(event: EspnEvent): EspnStatusType | undefined {
  return event.competitions?.[0]?.status?.type ?? event.status?.type
}

type EspnSchedule = { events?: Array<EspnEvent> }

async function fetchSchedule(endpoint: string): Promise<EspnSchedule> {
  const res = await fetch(endpoint)
  if (!res.ok) throw new Error(`ESPN fetch failed: ${res.status}`)
  return (await res.json()) as EspnSchedule
}

// Returns up to three events for the per-team widget: the live game
// (if one), the most-recent completed game, and the next scheduled
// game. Order is preserved as live → last → next so the widget reads
// chronologically from "what's happening now" to "what's coming."
function pickTeamEvents(events: Array<EspnEvent>): {
  live: EspnEvent | null
  last: EspnEvent | null
  next: EspnEvent | null
} {
  const now = Date.now()
  const live = events.find((e) => statusOf(e)?.state === "in") ?? null
  const future = events
    .filter((e) => e.date && new Date(e.date).getTime() > now)
    .sort(
      (a, b) =>
        new Date(a.date as string).getTime() -
        new Date(b.date as string).getTime(),
    )
  const past = events
    .filter((e) => statusOf(e)?.completed)
    .sort(
      (a, b) =>
        new Date(b.date as string).getTime() -
        new Date(a.date as string).getTime(),
    )
  return {
    live,
    last: past[0] ?? null,
    next: future[0] ?? null,
  }
}

function pickRelevantEvent(events: Array<EspnEvent>): EspnEvent | null {
  if (events.length === 0) return null
  const now = Date.now()

  const live = events.find((e) => statusOf(e)?.state === "in")
  if (live) return live

  const future = events
    .filter((e) => e.date && new Date(e.date).getTime() > now)
    .sort(
      (a, b) =>
        new Date(a.date as string).getTime() -
        new Date(b.date as string).getTime(),
    )
  const past = events
    .filter((e) => statusOf(e)?.completed)
    .sort(
      (a, b) =>
        new Date(b.date as string).getTime() -
        new Date(a.date as string).getTime(),
    )

  const next = future[0]
  const last = past[0]
  if (!next) return last ?? null
  if (!last) return next ?? null

  // Prefer the closer event in time. If a game is within 36h either way,
  // it dominates; otherwise prefer upcoming (forward-looking newspaper feel).
  const toNext = new Date(next.date as string).getTime() - now
  const fromLast = now - new Date(last.date as string).getTime()
  const day = 24 * 60 * 60 * 1000
  if (fromLast < 1.5 * day && fromLast < toNext) return last
  return next
}

function scoreOf(c: EspnCompetitor | undefined): string | null {
  if (!c?.score) return null
  if (typeof c.score === "string") return c.score
  if (typeof c.score.displayValue === "string") return c.score.displayValue
  if (typeof c.score.value === "number") return String(c.score.value)
  return null
}

function describeEvent(team: Team, event: EspnEvent | null): {
  state: "live" | "final" | "scheduled" | "off"
  primary: string
  secondary: string
} {
  if (!event) {
    return {
      state: "off",
      primary: "Off-season",
      secondary: `No ${team.league} games scheduled`,
    }
  }
  const competitors = event.competitions?.[0]?.competitors ?? []
  const us = competitors.find((c) =>
    c.team?.displayName?.includes(team.shortName) ||
    c.team?.displayName === team.name,
  )
  const them = competitors.find((c) => c !== us)
  const themName =
    them?.team?.shortDisplayName ?? them?.team?.displayName ?? "Opponent"
  const isHome = us?.homeAway === "home"
  const matchup = isHome ? `vs ${themName}` : `at ${themName}`

  const status = statusOf(event)
  const state = status?.state
  const completed = status?.completed
  const usScore = scoreOf(us)
  const themScore = scoreOf(them)

  if (state === "in") {
    // Always lead with a score — even if ESPN hasn't populated one yet
    // (very early innings / kickoff), we render "—–—" so the row shape
    // tells the reader "live game, score pending" instead of hiding it.
    const us = usScore ?? "—"
    const them = themScore ?? "—"
    return {
      state: "live",
      primary: `${us}–${them} ${matchup}`,
      secondary: status?.shortDetail ?? "Live",
    }
  }
  if (completed) {
    const won =
      usScore != null && themScore != null && Number(usScore) > Number(themScore)
    const tied =
      usScore != null && themScore != null && Number(usScore) === Number(themScore)
    const result = tied ? "Tie" : won ? "Win" : "Loss"
    return {
      state: "final",
      primary:
        usScore != null && themScore != null
          ? `${result} ${usScore}–${themScore} ${matchup}`
          : `Final ${matchup}`,
      secondary: formatRelativeDate(event.date),
    }
  }
  return {
    state: "scheduled",
    primary: matchup,
    secondary: formatRelativeDate(event.date),
  }
}

function formatRelativeDate(iso?: string): string {
  if (!iso) return ""
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  const now = new Date()
  const diffDays = Math.round(
    (date.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
  )
  // Use a non-breaking space inside the time so "6:40" and "PM" never
  // wrap apart — the secondary column is narrow enough that a literal
  // space would split "6:40 PM" across two lines.
  const time = date
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    })
    .replace(/\s+(AM|PM)$/i, "\u00A0$1")
  const weekday = date.toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "America/New_York",
  })
  const monthDay = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  })
  if (diffDays === 0) return `Today · ${time}`
  if (diffDays === 1) return `Tomorrow · ${time}`
  if (diffDays === -1) return `Yesterday`
  if (diffDays > 1 && diffDays <= 6) return `${weekday} · ${time}`
  if (diffDays < -1 && diffDays >= -6) return `${weekday}`
  return monthDay
}

export function SportsWidget() {
  const queries = useQueries({
    queries: TEAMS.map((team) => ({
      queryKey: ["widget", "sports", team.key],
      queryFn: () => fetchSchedule(team.endpoint),
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    })),
  })

  return (
    <div className="flex h-full flex-col">
      <SectionHeaderCell
        title="Recent Sports"
        moreHref="/section/$slug"
        moreParams={{ slug: "sports" }}
        className="mb-4"
      />
      <ul className="flex flex-col divide-y divide-foreground/15 border-t border-b border-foreground/15">
        {TEAMS.map((team, i) => {
          const q = queries[i]
          return (
            <li key={team.key}>
              <a
                href={team.website}
                target="_blank"
                rel="noreferrer"
                className="group/link relative block py-2.5"
                title={`${team.name} — opens in new tab`}
              >
                {q.isLoading ? (
                  <SportsRowSkeleton team={team} />
                ) : q.isError || !q.data ? (
                  <SportsRow
                    team={team}
                    state="off"
                    primary="Score unavailable"
                    secondary=""
                  />
                ) : (() => {
                  const event = pickRelevantEvent(q.data.events ?? [])
                  const desc = describeEvent(team, event)
                  return (
                    <SportsRow
                      team={team}
                      state={desc.state}
                      primary={desc.primary}
                      secondary={desc.secondary}
                    />
                  )
                })()}
              </a>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// Per-team widget — one card per Miami franchise. Title carries the
// team emoji + name (no need to repeat the team name in the body
// rows since the header already names them). Body shows live → last
// → next games as separate row entries; off-season teams collapse to
// a single muted row.
export function TeamWidget({ team }: { team: Team }) {
  const queries = useQueries({
    queries: [
      {
        queryKey: ["widget", "sports", team.key],
        queryFn: () => fetchSchedule(team.endpoint),
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
      },
    ],
  })
  const q = queries[0]

  const rows: Array<{
    key: string
    label: string
    state: "live" | "final" | "scheduled" | "off"
    primary: string
    secondary: string
  }> = (() => {
    if (q.isLoading || q.isError || !q.data) return []
    const events = q.data.events ?? []
    const { live, last, next } = pickTeamEvents(events)
    const out: typeof rows = []
    if (live) {
      const d = describeEvent(team, live)
      out.push({
        key: "live",
        label: "Live",
        state: d.state,
        primary: d.primary,
        secondary: d.secondary,
      })
    }
    if (last) {
      const d = describeEvent(team, last)
      out.push({
        key: "last",
        label: "Last",
        state: d.state,
        primary: d.primary,
        secondary: d.secondary,
      })
    }
    if (next) {
      const d = describeEvent(team, next)
      out.push({
        key: "next",
        label: "Next",
        state: d.state,
        primary: d.primary,
        secondary: d.secondary,
      })
    }
    if (out.length === 0) {
      const d = describeEvent(team, null)
      out.push({
        key: "off",
        label: team.league,
        state: d.state,
        primary: d.primary,
        secondary: d.secondary,
      })
    }
    return out
  })()

  return (
    <div>
      <SectionHeaderCell
        title={
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="leading-none">
              {team.icon}
            </span>
            <span>{team.name}</span>
          </span>
        }
        subtitle={team.league}
      />
      {/* Each game row is its own link — Last/Next/Live each point to
          the same team page (we don't have per-game URLs from ESPN's
          schedule endpoint), but separating them lets the hover icon-
          reveal land on the row the cursor is over instead of lighting
          up the entire widget. */}
      <div className="divide-y divide-foreground/15">
        {q.isLoading ? (
          <div className="py-2.5">
            <TeamRowSkeleton />
          </div>
        ) : q.isError || !q.data ? (
          <div className="py-2.5">
            <TeamGameRow
              label={team.league}
              state="off"
              primary="Score unavailable"
              secondary=""
            />
          </div>
        ) : (
          rows.map((row) => {
            const isOff = row.state === "off"
            const inner = (
              <TeamGameRow
                label={row.label}
                state={row.state}
                primary={row.primary}
                secondary={row.secondary}
              />
            )
            if (isOff) {
              return (
                <div key={row.key} className="relative py-2.5">
                  {inner}
                </div>
              )
            }
            return (
              <a
                key={row.key}
                href={team.website}
                target="_blank"
                rel="noopener noreferrer"
                className="group/link relative block py-2.5"
                title={`${team.name} — ${row.label}`}
              >
                {inner}
              </a>
            )
          })
        )}
      </div>
    </div>
  )
}

// One game row inside a TeamWidget. Label on the left ("Live", "Last",
// "Next"); score/matchup with optional live indicator in the center;
// date on the right. Visually mirrors SportsRow's two-line stack so
// the section page reads like the homepage rail, just without the
// team-name kicker (the widget header already names the team).
function TeamGameRow({
  label,
  state,
  primary,
  secondary,
}: {
  label: string
  state: "live" | "final" | "scheduled" | "off"
  primary: string
  secondary: string
}) {
  const isOff = state === "off"
  const offText = "text-foreground/35"
  return (
    <div
      className={
        "flex items-center justify-between gap-3 " +
        (isOff ? "grayscale" : "")
      }
    >
      <div className="min-w-0 flex-1">
        <span
          className={
            "kicker block text-xs whitespace-nowrap " +
            (isOff ? offText : "")
          }
        >
          {label}
        </span>
        <div className="mt-0.5 flex items-baseline gap-2">
          {state === "live" && <LiveDot />}
          <span
            className={
              "font-editorial text-sm tabular-nums " +
              (isOff ? offText : "")
            }
          >
            {primary}
          </span>
        </div>
      </div>
      {/* Secondary date — slides left on parent-link hover to make
          room for the external-link arrow that fades in at the
          right edge. Off-state rows skip the slide since they're
          not actionable. */}
      <span
        className={
          "meta shrink-0 max-w-[40%] text-right text-xs leading-snug transition-transform " +
          (isOff ? offText : "group-hover/link:-translate-x-6")
        }
      >
        {secondary}
      </span>
      {!isOff ? (
        <ExternalLink
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-0 size-3.5 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity group-hover/link:opacity-100"
        />
      ) : null}
    </div>
  )
}

function TeamRowSkeleton() {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <span className="kicker text-xs whitespace-nowrap opacity-50">
          —
        </span>
        <Skeleton className="mt-1 h-3 w-32" />
      </div>
      <Skeleton className="h-3 w-12" />
    </div>
  )
}

// All Miami franchises as separate widgets, stacked. Used on
// /section/sports. Wrapped in its own flex column with a tighter
// gap than the rail's default (gap-8) — five small team widgets
// felt over-spaced because each one's body is only 1-2 rows tall.
export function TeamWidgets() {
  return (
    <div className="flex flex-col gap-4 -my-2">
      {TEAMS.map((team) => (
        <TeamWidget key={team.key} team={team} />
      ))}
    </div>
  )
}

function SportsRow({
  team,
  state,
  primary,
  secondary,
}: {
  team: Team
  state: "live" | "final" | "scheduled" | "off"
  primary: string
  secondary: string
}) {
  // Two-line layout: emoji + team kicker on top, score/matchup on the
  // line below. Right column carries the date/status, vertically
  // centered so it reads alongside the wrapping left column without
  // forcing a tight single-line truncate.
  const isOff = state === "off"
  const offText = "text-foreground/35"
  return (
    <div
      className={
        "flex items-center justify-between gap-3 " +
        (isOff ? "grayscale" : "")
      }
    >
      <div className="flex min-w-0 flex-1 items-start gap-1.5">
        <span
          aria-hidden
          className={"leading-none " + (isOff ? offText : "")}
        >
          {team.icon}
        </span>
        {/* Stacked column to the right of the emoji — line 1 is the
            team kicker, line 2 is the score/matchup. Both lines
            share the same x-offset so the team name and the score
            sit on the same vertical edge. */}
        <div className="min-w-0 flex-1">
          <span
            className={
              "kicker block text-xs whitespace-nowrap " +
              (isOff ? offText : "")
            }
          >
            {team.shortName}
          </span>
          <div className="mt-0.5 flex items-baseline gap-2">
            {state === "live" && <LiveDot />}
            <span
              className={
                "font-editorial text-sm tabular-nums " +
                (isOff ? offText : "")
              }
            >
              {primary}
            </span>
          </div>
        </div>
      </div>
      {/* Secondary date — slides left on parent-link hover so the
          external-link arrow can fade in flush right. Off-state rows
          skip the slide because they're not actionable. */}
      <span
        className={
          "meta shrink-0 max-w-[40%] text-right text-xs leading-snug transition-transform " +
          (isOff ? offText : "group-hover/link:-translate-x-6")
        }
      >
        {secondary}
      </span>
      {!isOff ? (
        <ExternalLink
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-0 size-3.5 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity group-hover/link:opacity-100"
        />
      ) : null}
    </div>
  )
}

function LiveDot() {
  return (
    <span className="relative inline-flex size-2 shrink-0 self-center">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-60" />
      <span className="relative inline-flex size-2 rounded-full bg-destructive" />
    </span>
  )
}

// Wider variant for the /section/sports page — same data, but each
// team renders as a small card in a horizontally-wrapping grid so the
// row feels like a stat board instead of a compact rail. No more-link
// (we're already on the section), no `<SectionHeaderCell>` (the page
// owns its own headers).
export function SportsTeamGrid({ className }: { className?: string }) {
  const queries = useQueries({
    queries: TEAMS.map((team) => ({
      queryKey: ["widget", "sports", team.key],
      queryFn: () => fetchSchedule(team.endpoint),
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    })),
  })

  return (
    <div
      className={
        "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 " +
        (className ?? "")
      }
    >
      {TEAMS.map((team, i) => {
        const q = queries[i]
        if (q.isLoading) {
          return <SportsCardSkeleton key={team.key} team={team} />
        }
        if (q.isError || !q.data) {
          return (
            <SportsCard
              key={team.key}
              team={team}
              state="off"
              primary="Score unavailable"
              secondary=""
            />
          )
        }
        const event = pickRelevantEvent(q.data.events ?? [])
        const desc = describeEvent(team, event)
        return (
          <SportsCard
            key={team.key}
            team={team}
            state={desc.state}
            primary={desc.primary}
            secondary={desc.secondary}
          />
        )
      })}
    </div>
  )
}

function SportsCard({
  team,
  state,
  primary,
  secondary,
}: {
  team: Team
  state: "live" | "final" | "scheduled" | "off"
  primary: string
  secondary: string
}) {
  // Card mirrors the right-rail SportsRow shape — emoji + stacked
  // text column on the left (kicker, score), date on the right —
  // wrapped in a bordered card for the grid. League badge sits on
  // the right column above the date so the visual rhythm matches
  // the rail rows.
  const isOff = state === "off"
  const offText = "text-foreground/35"
  return (
    <a
      href={team.website}
      target="_blank"
      rel="noreferrer"
      className={
        "group/sports-card flex items-center justify-between gap-3 rounded-md border bg-card p-4 transition-colors hover:bg-muted/40 " +
        (isOff ? "grayscale" : "")
      }
      title={`${team.name} — opens in new tab`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-1.5">
        <span
          aria-hidden
          className={"text-base leading-none " + (isOff ? offText : "")}
        >
          {team.icon}
        </span>
        <div className="min-w-0 flex-1">
          <span
            className={
              "kicker block text-xs whitespace-nowrap " +
              (isOff ? offText : "")
            }
          >
            {team.shortName}
          </span>
          <div className="mt-0.5 flex items-baseline gap-2">
            {state === "live" && <LiveDot />}
            <span
              className={
                "font-editorial text-sm tabular-nums " +
                (isOff ? offText : "")
              }
            >
              {primary}
            </span>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 max-w-[40%] flex-col items-end gap-1 text-right leading-snug">
        <span
          className={"meta text-[0.65rem] opacity-70 " + (isOff ? offText : "")}
        >
          {team.league}
        </span>
        {secondary ? (
          <span className={"meta text-xs " + (isOff ? offText : "")}>
            {secondary}
          </span>
        ) : null}
      </div>
    </a>
  )
}

function SportsCardSkeleton({ team }: { team: Team }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border bg-card p-4">
      <div className="flex items-baseline gap-2">
        <span aria-hidden className="text-base leading-none opacity-50">
          {team.icon}
        </span>
        <span className="kicker text-xs whitespace-nowrap opacity-50">
          {team.shortName}
        </span>
      </div>
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-3 w-20" />
    </div>
  )
}

function SportsRowSkeleton({ team }: { team: Team }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <span className="kicker text-xs whitespace-nowrap">
          {team.shortName}
        </span>
        <Skeleton className="mt-1 h-3 w-32" />
      </div>
      <Skeleton className="h-3 w-12" />
    </div>
  )
}
