import { useQueries } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"

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
  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  })
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
      <header className="mb-4 flex items-baseline justify-between border-b border-foreground/30 pb-2">
        <span className="kicker">Recent Sports</span>
        <Link
          to="/section/$slug"
          params={{ slug: "sports" }}
          className="meta uppercase tracking-wider hover:underline"
        >
          More →
        </Link>
      </header>
      <ul className="flex flex-col divide-y border-t border-b">
        {TEAMS.map((team, i) => {
          const q = queries[i]
          return (
            <li key={team.key}>
              <a
                href={team.website}
                target="_blank"
                rel="noreferrer"
                className="block py-2.5 transition-colors hover:bg-muted/40"
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
  // Off-season teams render at near-disabled opacity so the eye drops
  // straight to teams that actually have results — but the row stays
  // a click target (the parent <a> opens the team site in a new tab).
  const isOff = state === "off"
  const offText = "text-foreground/35"
  return (
    <div
      className={
        "flex items-baseline justify-between gap-3 " +
        (isOff ? "grayscale" : "")
      }
    >
      <div className="flex min-w-0 items-baseline gap-3">
        <span
          className={
            "flex shrink-0 items-baseline gap-1.5 " +
            (isOff ? offText : "")
          }
        >
          <span aria-hidden className="leading-none">
            {team.icon}
          </span>
          <span className="kicker text-xs whitespace-nowrap">
            {team.shortName}
          </span>
        </span>
        <div className="flex min-w-0 items-baseline gap-2">
          {state === "live" && <LiveDot />}
          <span
            className={
              "font-editorial truncate text-sm tabular-nums " +
              (isOff ? offText : "")
            }
          >
            {primary}
          </span>
        </div>
      </div>
      <span
        className={
          "meta shrink-0 text-xs " + (isOff ? offText : "")
        }
      >
        {secondary}
      </span>
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

function SportsRowSkeleton({ team }: { team: Team }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="flex items-baseline gap-3">
        <span className="kicker shrink-0 text-xs whitespace-nowrap">
          {team.shortName}
        </span>
        <Skeleton className="h-3 w-40" />
      </div>
      <Skeleton className="h-3 w-16" />
    </div>
  )
}
