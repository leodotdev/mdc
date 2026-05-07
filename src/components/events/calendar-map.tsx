import { Link } from "@tanstack/react-router"
import maplibregl from "maplibre-gl"
import { useEffect, useMemo, useRef, useState } from "react"

import { NEIGHBORHOODS } from "../../../convex/lib/neighborhoods"
import type { EventWithSection } from "@/lib/event-helpers"
import type { Map as MapLibreMap, Marker } from "maplibre-gl"
import { EventListItem } from "@/components/events/event-list-item"
import { cn } from "@/lib/utils"

import "maplibre-gl/dist/maplibre-gl.css"

// Default center + zoom — Miami metro fits at zoom 11.
const DEFAULT_CENTER: [number, number] = [-80.1918, 25.7617]
const DEFAULT_ZOOM = 11

// Mapbox vector style URL. The pk.* public token is allowlisted by URL
// in the Mapbox dashboard; embedding it client-side is the documented
// pattern. Falls back to a free OSM raster style when the env var is
// missing (e.g. in a fresh checkout without local env config).
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined

const MAP_STYLE: string | maplibregl.StyleSpecification = MAPBOX_TOKEN
  ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12?access_token=${MAPBOX_TOKEN}`
  : {
      version: 8 as const,
      sources: {
        osm: {
          type: "raster" as const,
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          attribution: "© OpenStreetMap contributors",
          maxzoom: 19,
        },
      },
      layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
      glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
    }

// Render the events page's map view. Pins are placed at the centroid
// of each event's first neighborhood (per-event lat/lng comes in P1).
// Section accent colors the dot. Click a dot opens the event drawer.
// Below the map a list of visible events keeps the read-side ergonomic
// (mobile-first: panel stacks below the map).
export function CalendarMap({
  events,
}: {
  events: ReadonlyArray<EventWithSection>
}) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<MapLibreMap | null>(null)
  const markers = useRef<Array<Marker>>([])
  const [visibleEventIds, setVisibleEventIds] = useState<Set<string> | null>(
    null,
  )

  // Initialize map once.
  useEffect(() => {
    if (mapInstance.current || !mapRef.current) return
    const map = new maplibregl.Map({
      container: mapRef.current,
      style: MAP_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: { compact: true },
    })
    map.addControl(new maplibregl.NavigationControl(), "top-right")
    const recordVisible = () => {
      if (!mapInstance.current) return
      const bounds = mapInstance.current.getBounds()
      const next = new Set<string>()
      for (const e of events) {
        const coords = pinCoordsFor(e)
        if (!coords) continue
        if (bounds.contains([coords.lng, coords.lat])) {
          next.add(e._id)
        }
      }
      setVisibleEventIds(next)
    }
    map.on("load", recordVisible)
    map.on("moveend", recordVisible)
    mapInstance.current = map
    return () => {
      map.remove()
      mapInstance.current = null
    }
    // Intentionally empty: we want a single map instance for the
    // component's lifetime. Marker updates run from a separate effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sort events by start time so the index-based numbering pairs with
  // the side list rendered below (also start-time sorted).
  const orderedEvents = useMemo(
    () => [...events].sort((a, b) => a.startsAt - b.startsAt),
    [events],
  )

  // Plot / re-plot markers when events change.
  useEffect(() => {
    const map = mapInstance.current
    if (!map) return
    // Tear down prior markers.
    for (const m of markers.current) m.remove()
    markers.current = []

    for (let i = 0; i < orderedEvents.length; i += 1) {
      const event = orderedEvents[i]
      const coords = pinCoordsFor(event)
      if (!coords) continue
      const accent = event.section?.accentColor ?? "var(--foreground)"
      const number = i + 1

      // Slight jitter for events sharing a centroid so they don't all
      // stack into one click target. Deterministic from the event id
      // so re-renders don't bounce pins around.
      const jitter = jitterFor(event._id)
      const lng = coords.lng + jitter.lng
      const lat = coords.lat + jitter.lat

      const el = document.createElement("button")
      el.type = "button"
      // Composed teardrop pin: a colored circle with a numbered badge.
      // The CSS triangle below the circle gives it a "pinned to a
      // location" feel without needing a custom SVG.
      el.className = "relative grid cursor-pointer place-items-center"
      el.style.width = "28px"
      el.style.height = "36px"
      el.innerHTML = `
        <span
          aria-hidden
          class="absolute top-0 size-7 rounded-full border-2 border-white shadow-md"
          style="background: ${accent}"
        ></span>
        <span
          aria-hidden
          class="absolute top-[26px] h-[10px] w-[10px] rotate-45"
          style="background: ${accent}"
        ></span>
        <span
          class="relative z-10 mt-[-8px] font-sans text-[0.7rem] font-bold leading-none text-white"
        >${number}</span>
      `
      el.setAttribute("aria-label", `${number}: ${event.title}`)
      el.setAttribute("data-event-pin", event._id)
      el.title = event.title

      const marker = new maplibregl.Marker({
        element: el,
        anchor: "bottom",
      })
        .setLngLat([lng, lat])
        .addTo(map)
      el.addEventListener("click", (ev) => {
        ev.stopPropagation()
        const slug = event.slug
        if (!slug) return
        const target = document.querySelector<HTMLAnchorElement>(
          `[data-map-link="${slug}"]`,
        )
        target?.click()
      })
      markers.current.push(marker)
    }

    // Recompute visible set when markers change too.
    if (events.length > 0 && map.getBounds) {
      const bounds = map.getBounds()
      const next = new Set<string>()
      for (const e of events) {
        const coords = pinCoordsFor(e)
        if (!coords) continue
        if (bounds.contains([coords.lng, coords.lat])) {
          next.add(e._id)
        }
      }
      setVisibleEventIds(next)
    }
  }, [events])

  // Visible-events list — filter to events inside the current map bounds.
  // Use orderedEvents (start-time sorted) so the list order matches the
  // pin numbering on the map.
  const visibleEvents = useMemo(() => {
    if (visibleEventIds === null) return orderedEvents
    return orderedEvents.filter((e) => visibleEventIds.has(e._id as string))
  }, [orderedEvents, visibleEventIds])

  // event id → its 1-based position in the full ordered list. The list
  // item shows the same number as the pin so the reader can visually
  // pair them.
  const numberById = useMemo(() => {
    const map = new Map<string, number>()
    orderedEvents.forEach((e, i) => map.set(e._id, i + 1))
    return map
  }, [orderedEvents])

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px] lg:gap-8">
      <div
        ref={mapRef}
        className="h-[60vh] min-h-[400px] w-full overflow-hidden rounded-md border border-foreground/10 lg:h-[calc(100dvh-22rem)] lg:min-h-[600px]"
      />
      <aside className="flex flex-col gap-3">
        <header className="flex items-baseline justify-between">
          <h2 className="font-sans text-base font-semibold">
            Visible on map
          </h2>
          <span className="meta text-xs tabular-nums">
            {visibleEvents.length}{" "}
            {visibleEvents.length === 1 ? "event" : "events"}
          </span>
        </header>
        <ul
          className={cn(
            "flex flex-col gap-3 overflow-y-auto",
            "lg:max-h-[calc(100dvh-26rem)]",
          )}
        >
          {visibleEvents.length === 0 ? (
            <li className="meta text-sm">
              No events in the current view. Pan the map or widen the time
              range.
            </li>
          ) : (
            visibleEvents.map((e) => {
              const number = numberById.get(e._id)
              const accent = e.section?.accentColor ?? "var(--foreground)"
              return (
              <li key={e._id} className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="mt-1 grid size-7 shrink-0 place-items-center rounded-full font-sans text-xs font-bold text-white shadow-sm"
                  style={{ background: accent }}
                >
                  {number}
                </span>
                <div className="min-w-0 flex-1">
                  <EventListItem event={e} />
                </div>
                {/* Hidden anchor used by the marker click handler to
                    drive SPA navigation into the drawer. */}
                {e.slug ? (
                  <Link
                    aria-hidden
                    tabIndex={-1}
                    data-map-link={e.slug}
                    to="."
                    search={
                      ((prev: Record<string, unknown>) => ({
                        ...prev,
                        event: e.slug,
                      })) as never
                    }
                    className="hidden"
                  />
                ) : null}
              </li>
              )
            })
          )}
        </ul>
      </aside>
    </div>
  )
}

// Resolve an event's pin location. P0: first neighborhood's centroid.
// P1 will check `event.lat/lng` first and fall back to neighborhood.
function pinCoordsFor(
  event: EventWithSection,
): { lat: number; lng: number } | null {
  const slug = event.neighborhoods?.[0]
  if (!slug) return null
  const found = NEIGHBORHOODS.find((n) => n.slug === slug)
  return found ? { lat: found.lat, lng: found.lng } : null
}

// Tiny lat/lng offset (~50–150 m) per event id so events sharing a
// centroid don't fully overlap. Deterministic so the same event always
// jitters the same way.
function jitterFor(id: string): { lat: number; lng: number } {
  let h = 5381
  for (let i = 0; i < id.length; i += 1) {
    h = ((h << 5) + h + id.charCodeAt(i)) | 0
  }
  // Normalize to [-1, 1) on each axis.
  const x = ((h & 0xffff) / 0xffff) * 2 - 1
  const y = (((h >>> 16) & 0xffff) / 0xffff) * 2 - 1
  // Up to ~150m: 0.0015 degrees ≈ 165m at Miami's latitude.
  return { lat: y * 0.0012, lng: x * 0.0012 }
}
