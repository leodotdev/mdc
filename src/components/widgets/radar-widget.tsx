import { useEffect, useState } from "react"

import { SectionHeaderCell } from "@/components/editorial/section-header-cell"

// Live precipitation radar — NWS KAMX (Miami) animated loop. Updates
// every 5 minutes server-side; we bust the browser cache every 5 min
// by re-mounting with a fresh `?ts=` query. The GIF auto-plays.
//
// This replaces the originally-planned "webcams" widget — the radar
// loop is more useful for daily life (is it raining? is there a storm
// rolling in?) and far more reliable than scraping public webcams.
// Hurricane season especially benefits.

const RADAR_URL = "https://radar.weather.gov/ridge/standard/KAMX_loop.gif"
const REFRESH_MS = 5 * 60 * 1000

export function RadarWidget() {
  // Start with null so SSR and the first client render agree on the bare
  // URL; the cache-buster gets appended on the client after mount.
  const [ts, setTs] = useState<number | null>(null)
  useEffect(() => {
    setTs(Date.now())
    const id = setInterval(() => setTs(Date.now()), REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <div>
      <SectionHeaderCell title="Live Miami radar" />
      <div className="pt-3 pb-1">
        <a
          href="https://radar.weather.gov/station/KAMX/standard"
          target="_blank"
          rel="noreferrer"
          className="block overflow-hidden rounded-md border border-foreground/10 bg-muted"
          title="NWS Miami radar — open full station view"
        >
          <img
            src={ts === null ? RADAR_URL : `${RADAR_URL}?ts=${ts}`}
            alt="Animated radar loop centered on Miami showing the last hour of precipitation"
            className="aspect-square w-full object-cover"
            loading="lazy"
          />
        </a>
        <p className="meta mt-1.5 text-[0.65rem]">
          NWS KAMX · refreshes every 5 min
        </p>
      </div>
    </div>
  )
}
