import { useQuery } from "@tanstack/react-query"
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudRain,
  CloudSnow,
  Sun,
  Zap,
} from "lucide-react"

import { Skeleton } from "@/components/ui/skeleton"

const MIAMI_LAT = 25.7617
const MIAMI_LON = -80.1918

type WeatherResponse = {
  current: {
    temperature_2m: number
    weather_code: number
    wind_speed_10m: number
    relative_humidity_2m: number
  }
  daily: {
    temperature_2m_max: Array<number>
    temperature_2m_min: Array<number>
  }
}

async function fetchWeather(): Promise<WeatherResponse> {
  const params = new URLSearchParams({
    latitude: String(MIAMI_LAT),
    longitude: String(MIAMI_LON),
    current: "temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m",
    daily: "temperature_2m_max,temperature_2m_min",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: "America/New_York",
    forecast_days: "1",
  })
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?${params.toString()}`,
  )
  if (!res.ok) throw new Error(`Weather fetch failed: ${res.status}`)
  return (await res.json()) as WeatherResponse
}

function describeWeather(code: number): {
  label: string
  Icon: typeof Sun
} {
  if (code === 0) return { label: "Clear sky", Icon: Sun }
  if (code <= 3) return { label: "Partly cloudy", Icon: Cloud }
  if (code === 45 || code === 48) return { label: "Foggy", Icon: CloudFog }
  if (code >= 51 && code <= 57) return { label: "Drizzle", Icon: CloudDrizzle }
  if (code >= 61 && code <= 67) return { label: "Rain", Icon: CloudRain }
  if (code >= 71 && code <= 77) return { label: "Snow", Icon: CloudSnow }
  if (code >= 80 && code <= 82) return { label: "Showers", Icon: CloudRain }
  if (code >= 95) return { label: "Thunderstorms", Icon: Zap }
  return { label: "Unsettled", Icon: Cloud }
}

export function WeatherWidget() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["widget", "weather", "miami"],
    queryFn: fetchWeather,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  return (
    <div className="flex h-full flex-col">
      <header className="mb-4 flex items-baseline justify-between border-b border-foreground/30 pb-2">
        <span className="kicker">Weather</span>
        <span className="meta text-xs">Now</span>
      </header>
      {isLoading ? (
        <WeatherSkeleton />
      ) : isError || !data ? (
        <p className="meta text-xs">Weather unavailable.</p>
      ) : (
        <WeatherBody data={data} />
      )}
    </div>
  )
}

function WeatherBody({ data }: { data: WeatherResponse }) {
  const { current, daily } = data
  const { label, Icon } = describeWeather(current.weather_code)
  const temp = Math.round(current.temperature_2m)
  const high = Math.round(daily.temperature_2m_max[0])
  const low = Math.round(daily.temperature_2m_min[0])

  return (
    <div className="flex items-center gap-5">
      <Icon className="size-14 shrink-0 text-foreground" />
      <div className="min-w-0">
        <div className="font-heading text-5xl font-semibold leading-none tracking-[-0.025em] tabular-nums">
          {temp}°
        </div>
        <p className="font-editorial mt-1.5 text-sm">{label}</p>
        <p className="meta mt-1 text-xs tabular-nums">
          H {high}° · L {low}°
        </p>
      </div>
    </div>
  )
}

function WeatherSkeleton() {
  return (
    <div className="flex items-center gap-5">
      <Skeleton className="size-14 shrink-0" />
      <div className="min-w-0">
        <Skeleton className="h-12 w-20" />
        <Skeleton className="mt-2 h-3 w-28" />
        <Skeleton className="mt-1.5 h-3 w-20" />
      </div>
    </div>
  )
}
