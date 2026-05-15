import { Link } from "@tanstack/react-router"
import maplibregl from "maplibre-gl"
import { useEffect, useMemo, useRef, useState } from "react"

import type { EventWithRelations } from "@/lib/article-types"
import type { Map as MapLibreMap, Marker } from "maplibre-gl"
import { useOpenEventDrawer } from "@/lib/use-open-article-drawer"
import { cn } from "@/lib/utils"

import "maplibre-gl/dist/maplibre-gl.css"

// Default center + zoom — Miami metro fits at zoom 11.
const DEFAULT_CENTER: [number, number] = [-80.1918, 25.7617]
const DEFAULT_ZOOM = 11

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
// Mapbox light style — clean, low-contrast basemap that lets the
// section-tinted accent dots carry the visual weight. Token is a
// public pk.* (URL-allowlisted in the Mapbox dashboard), so it's
// safe to bundle into the client.
const MAP_STYLE = `https://api.mapbox.com/styles/v1/mapbox/light-v11?access_token=${MAPBOX_TOKEN ?? ""}`

// Map view for the View Mode pivot. Takes the hydrated event shape
// (EventWithRelations) and pins each event with lat/lng populated. The
// section accent colors the dot. Clicking opens the event drawer.
// Below the map, a list of visible events (those inside the current
// viewport bounds) gives readers a parallel browsing surface — pan or
// zoom and the list filters live.
//
// Events without lat/lng are skipped silently. They're not yet
// placeable (no neighborhood slug, no address geocode).

export function EventsMap({
  events,
}: {
  events: ReadonlyArray<EventWithRelations>
}) {
  const placed = useMemo(
    () =>
      events.filter(
        (e): e is EventWithRelations & { lat: number; lng: number } =>
          typeof e.lat === "number" && typeof e.lng === "number",
      ),
    [events],
  )

  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<MapLibreMap | null>(null)
  const markers = useRef<Array<Marker>>([])
  const [visibleIds, setVisibleIds] = useState<Set<string> | null>(null)
  const openInDrawer = useOpenEventDrawer()

  // Initialize the map once.
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
    mapInstance.current = map
    return () => {
      for (const m of markers.current) m.remove()
      markers.current = []
      map.remove()
      mapInstance.current = null
    }
    // We intentionally only init once. Events updates patch markers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-render markers whenever the events list changes.
  useEffect(() => {
    const map = mapInstance.current
    if (!map) return
    for (const m of markers.current) m.remove()
    markers.current = []
    for (const e of placed) {
      const accent = e.section?.accentColor ?? "#000"
      const slug = e.slug ?? ""
      const el = document.createElement("button")
      el.type = "button"
      el.title = e.title
      el.className =
        "block size-3.5 rounded-full border-2 border-white shadow-md cursor-pointer transition-transform hover:scale-125"
      el.style.backgroundColor = accent
      el.onclick = (ev) => {
        ev.preventDefault()
        openInDrawer(
          slug,
          ev as unknown as React.MouseEvent<Element, MouseEvent>,
        )
      }
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([e.lng, e.lat])
        .addTo(map)
      markers.current.push(marker)
    }
    // Compute initially-visible set so the side list renders before
    // the first user pan.
    recordVisibleIds(map, placed, setVisibleIds)
  }, [placed, openInDrawer])

  // Recompute visible-set on every viewport change.
  useEffect(() => {
    const map = mapInstance.current
    if (!map) return
    const onMove = () => recordVisibleIds(map, placed, setVisibleIds)
    map.on("moveend", onMove)
    return () => {
      map.off("moveend", onMove)
    }
  }, [placed])

  const visibleEvents = useMemo(() => {
    if (!visibleIds) return placed
    return placed.filter((e) => visibleIds.has(e._id as string))
  }, [placed, visibleIds])

  return (
    <div className="flex flex-col gap-6">
      <div
        ref={mapRef}
        className="h-[60vh] w-full overflow-hidden rounded-md border border-foreground/15"
      />
      {placed.length === 0 ? (
        <div className="font-editorial mx-auto mt-2 max-w-2xl text-center text-base text-muted-foreground">
          No events with locations yet. As more iCal sources flow in,
          pins fill out.
        </div>
      ) : (
        <div>
          <h3 className="kicker mb-3 text-foreground">
            {visibleEvents.length} of {placed.length} on the map
          </h3>
          <ul className="flex flex-col divide-y divide-foreground/15">
            {visibleEvents.slice(0, 40).map((e) => (
              <li key={e._id}>
                <Link
                  to="/event/$slug"
                  params={{ slug: e.slug ?? "" }}
                  onClick={(ev) => openInDrawer(e.slug ?? "", ev)}
                  className={cn(
                    "group/event-row block py-3 transition-colors hover:bg-muted/30",
                  )}
                >
                  <div className="font-heading text-sm font-semibold tracking-tight md:text-base">
                    {e.title}
                  </div>
                  <div className="font-sans mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                    {e.section ? <span>{e.section.name}</span> : null}
                    {e.locationName ? <span>· {e.locationName}</span> : null}
                    <span>
                      ·{" "}
                      {new Intl.DateTimeFormat("en-US", {
                        month: "short",
                        day: "numeric",
                      }).format(e.startsAt)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function recordVisibleIds(
  map: MapLibreMap,
  events: ReadonlyArray<EventWithRelations & { lat: number; lng: number }>,
  setIds: (s: Set<string>) => void,
) {
  const bounds = map.getBounds()
  const next = new Set<string>()
  for (const e of events) {
    if (bounds.contains([e.lng, e.lat])) {
      next.add(e._id as string)
    }
  }
  setIds(next)
}
