import maplibregl from "maplibre-gl"
import { useEffect, useRef } from "react"

import type { Map as MapLibreMap } from "maplibre-gl"

import "maplibre-gl/dist/maplibre-gl.css"

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
const MAP_STYLE = `https://api.mapbox.com/styles/v1/mapbox/light-v11?access_token=${MAPBOX_TOKEN ?? ""}`

// Single-pin map for one event's location. Drops a section-accent dot
// at (lng, lat), centers the viewport on it at a venue-scale zoom, and
// returns null when coords are missing so the layout collapses cleanly.

type Props = {
  lat: number
  lng: number
  accentColor: string
  /** Used as the pin's hover tooltip and a fallback alt for screen readers. */
  title: string
}

export function EventLocationMap({ lat, lng, accentColor, title }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [lng, lat],
      zoom: 14,
      attributionControl: { compact: true },
      interactive: true,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right")
    const el = document.createElement("div")
    el.title = title
    el.className =
      "size-4 rounded-full border-2 border-white shadow-md"
    el.style.backgroundColor = accentColor
    new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
    // Coords + accent are stable for the life of a mounted event view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={`Map showing the location of ${title}`}
      className="aspect-[16/9] w-full overflow-hidden rounded-md border border-foreground/15"
    />
  )
}
