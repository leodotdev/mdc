import { useQuery } from "@tanstack/react-query"

import { SectionHeaderCell } from "@/components/editorial/section-header-cell"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const MIAMI_LAT = 25.7617
const MIAMI_LON = -80.1918

// Forecast hours after "Now" (which is always the first row, computed
// from the `current` block). Four trailing hours = five rows total —
// matches SportsWidget's cadence (one per Miami franchise) so the two
// cards have the same vertical rhythm on the homepage.
const FORECAST_HOURS = [11, 14, 18, 21] as const

type WeatherResponse = {
  current: {
    temperature_2m: number
    weather_code: number
  }
  hourly: {
    time: Array<string>
    temperature_2m: Array<number>
    weather_code: Array<number>
  }
  daily: {
    sunrise: Array<string>
    sunset: Array<string>
  }
}

async function fetchWeather(): Promise<WeatherResponse> {
  const params = new URLSearchParams({
    latitude: String(MIAMI_LAT),
    longitude: String(MIAMI_LON),
    current: "temperature_2m,weather_code",
    hourly: "temperature_2m,weather_code",
    daily: "sunrise,sunset",
    temperature_unit: "fahrenheit",
    timezone: "America/New_York",
    forecast_days: "1",
  })
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?${params.toString()}`,
  )
  if (!res.ok) throw new Error(`Weather fetch failed: ${res.status}`)
  return (await res.json()) as WeatherResponse
}

// Air quality lives on a sibling Open-Meteo endpoint. Fetched alongside
// weather and rendered as one of the trailing rows inside the weather
// card — keeps the rail tight, since AQI rarely deserves its own card.
type AirQualityResponse = {
  current: { us_aqi: number; pm2_5: number }
}

async function fetchAirQuality(): Promise<AirQualityResponse> {
  const params = new URLSearchParams({
    latitude: String(MIAMI_LAT),
    longitude: String(MIAMI_LON),
    current: "us_aqi,pm2_5",
    timezone: "America/New_York",
  })
  const res = await fetch(
    `https://air-quality-api.open-meteo.com/v1/air-quality?${params.toString()}`,
  )
  if (!res.ok) throw new Error(`Air quality fetch failed: ${res.status}`)
  return (await res.json()) as AirQualityResponse
}

// EPA US AQI bands. Used as a one-line summary alongside hourly forecast
// and sun rows — number + condition word with band-tinted color.
function aqiBand(aqi: number): { label: string; tone: string; icon: string } {
  if (aqi <= 50)
    return {
      label: "Good",
      tone: "text-emerald-700 dark:text-emerald-400",
      icon: "🌱",
    }
  if (aqi <= 100)
    return {
      label: "Moderate",
      tone: "text-yellow-700 dark:text-yellow-400",
      icon: "🌤️",
    }
  if (aqi <= 150)
    return {
      label: "Unhealthy for sensitive",
      tone: "text-orange-700 dark:text-orange-400",
      icon: "😷",
    }
  if (aqi <= 200)
    return {
      label: "Unhealthy",
      tone: "text-red-700 dark:text-red-400",
      icon: "😷",
    }
  if (aqi <= 300)
    return {
      label: "Very unhealthy",
      tone: "text-purple-700 dark:text-purple-400",
      icon: "⚠️",
    }
  return {
    label: "Hazardous",
    tone: "text-rose-900 dark:text-rose-300",
    icon: "🚨",
  }
}

// Plain unicode glyph + short label per WMO weather code. Plain text so
// we don't need an icon dependency for what's effectively decorative —
// matches the sports widget's sport glyphs (🏀 🏈 ⚾ ⚽ 🏈).
function describeWeather(code: number): { icon: string; label: string } {
  if (code === 0) return { icon: "☀️", label: "Clear" }
  if (code <= 3) return { icon: "⛅", label: "Partly cloudy" }
  if (code === 45 || code === 48) return { icon: "🌫️", label: "Foggy" }
  if (code >= 51 && code <= 57) return { icon: "🌦️", label: "Drizzle" }
  if (code >= 61 && code <= 67) return { icon: "🌧️", label: "Rain" }
  if (code >= 71 && code <= 77) return { icon: "❄️", label: "Snow" }
  if (code >= 80 && code <= 82) return { icon: "🌧️", label: "Showers" }
  if (code >= 95) return { icon: "⛈️", label: "Thunderstorms" }
  return { icon: "☁️", label: "Unsettled" }
}

function formatHourLabel(hour: number): string {
  if (hour === 0) return "12 AM"
  if (hour === 12) return "Noon"
  if (hour < 12) return `${hour} AM`
  if (hour === 24) return "12 AM"
  return `${hour - 12} PM`
}

function formatLocalTime(isoLocal: string): string {
  // "2026-05-06T06:35" — local Miami time per the timezone= param.
  const t = isoLocal.split("T")[1] ?? isoLocal
  const [h, m] = t.split(":").map(Number)
  const period = h >= 12 ? "PM" : "AM"
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`
}

export function WeatherWidget() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["widget", "weather", "miami"],
    queryFn: fetchWeather,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
  const { data: aq } = useQuery({
    queryKey: ["widget", "air-quality", "miami"],
    queryFn: fetchAirQuality,
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  return (
    <div className="flex h-full flex-col">
      <SectionHeaderCell title="Weather" subtitle="Today" className="mb-4" />
      {isLoading ? (
        <WeatherSkeleton />
      ) : isError || !data ? (
        <p className="meta text-xs">Weather unavailable.</p>
      ) : (
        <WeatherBody data={data} aq={aq} />
      )}
    </div>
  )
}

// Unified row shape — every row in the widget renders the same way:
// `[icon] [label] [value]` on the left, `[rightLabel]` on the right.
// Hourly forecast rows have rightLabel = the time; AQI / sunrise /
// sunset rows have rightLabel = the metric name. The flipped layout
// keeps the metric name in a consistent slot so the eye scans the
// rail vertically without searching.
type Row = {
  key: string
  icon: string
  label: string
  /** Optional value to the right of the label — e.g. temp, AQI number. */
  value?: string
  rightLabel: string
  /** Optional Tailwind color utility on the value text — used by AQI. */
  valueTone?: string
}

function WeatherBody({
  data,
  aq,
}: {
  data: WeatherResponse
  aq: AirQualityResponse | undefined
}) {
  const nowDesc = describeWeather(data.current.weather_code)
  const nowTemp =
    typeof data.current.temperature_2m === "number"
      ? Math.round(data.current.temperature_2m)
      : null
  const nowRow: Row = {
    key: "now",
    icon: nowDesc.icon,
    label: nowDesc.label,
    value: nowTemp != null ? `${nowTemp}°` : undefined,
    rightLabel: "Now",
  }

  const hourlyRows: Array<Row> = FORECAST_HOURS.map((hour) => {
    const idx = data.hourly.time.findIndex(
      (t) => new Date(t).getHours() === hour,
    )
    const safeIdx = idx >= 0 ? idx : 0
    const code = data.hourly.weather_code[safeIdx] ?? 0
    const tempRaw = data.hourly.temperature_2m[safeIdx]
    const temp = typeof tempRaw === "number" ? Math.round(tempRaw) : null
    const desc = describeWeather(code)
    return {
      key: String(hour),
      icon: desc.icon,
      label: desc.label,
      value: temp != null ? `${temp}°` : undefined,
      rightLabel: formatHourLabel(hour),
    }
  })

  const aqRow: Row | null = (() => {
    if (!aq) return null
    const aqi = Math.round(aq.current.us_aqi)
    const band = aqiBand(aqi)
    return {
      key: "aqi",
      icon: band.icon,
      label: band.label,
      value: String(aqi),
      rightLabel: "Air quality",
      valueTone: band.tone,
    }
  })()

  const sr = data.daily?.sunrise?.[0]
  const ss = data.daily?.sunset?.[0]
  const sunriseRow: Row | null = sr
    ? {
        key: "sunrise",
        icon: "🌅",
        label: formatLocalTime(sr),
        rightLabel: "Sunrise",
      }
    : null
  const sunsetRow: Row | null = ss
    ? {
        key: "sunset",
        icon: "🌇",
        label: formatLocalTime(ss),
        rightLabel: "Sunset",
      }
    : null

  // Sunrise leads the rail — it's the day's first event, so it reads
  // naturally at the top, with the rest of the day flowing below it.
  const rows: Array<Row> = [
    ...(sunriseRow ? [sunriseRow] : []),
    nowRow,
    ...hourlyRows,
    ...(aqRow ? [aqRow] : []),
    ...(sunsetRow ? [sunsetRow] : []),
  ]

  return (
    <ul className="flex flex-col divide-y divide-foreground/15 border-t border-b border-foreground/15">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-3 py-2.5">
            <div className="flex min-w-0 items-baseline gap-3">
              <span className="flex shrink-0 items-baseline gap-1.5">
                <span aria-hidden className="leading-none">
                  {row.icon}
                </span>
                <span className="kicker text-xs whitespace-nowrap">
                  {row.label}
                </span>
              </span>
              {row.value ? (
                <span
                  className={cn(
                    "font-editorial truncate text-sm tabular-nums",
                    row.valueTone,
                  )}
                >
                  {row.value}
                </span>
              ) : null}
            </div>
            <span className="meta shrink-0 text-xs">{row.rightLabel}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}

function WeatherSkeleton() {
  return (
    <ul className="flex flex-col divide-y divide-foreground/15 border-t border-b border-foreground/15">
      {/* 8 rows = Now + 4 forecast hours + AQI + Sunrise + Sunset. */}
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <li key={i}>
          <div className="flex items-baseline justify-between gap-3 py-2.5">
            <div className="flex items-baseline gap-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-10" />
            </div>
            <Skeleton className="h-3 w-12" />
          </div>
        </li>
      ))}
    </ul>
  )
}
