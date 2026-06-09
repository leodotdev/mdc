// Mapbox forward-geocoding wrapper. Restricted to Miami-Dade bbox so
// a hit on "Miami" anywhere in the world (Miami, OH) gets filtered
// out. Reads `MAPBOX_TOKEN` from env; no-ops when the token isn't
// configured.
//
// Designed to be called from a Convex action (mutations can't make
// outbound HTTP calls). The action layer reads the cache table
// directly via ctx.runQuery, then writes back via ctx.runMutation
// after a successful lookup.

const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN

// Approx Miami-Dade County bbox — [minLng, minLat, maxLng, maxLat].
// Includes Homestead through North Miami Beach and the keys we
// care about (Key Biscayne). Anything outside is rejected so a
// classifier mistake doesn't put a Brooklyn event on the Miami map.
const MIAMI_BBOX = "-80.873,25.137,-80.118,25.979"

export type GeocodeResult = {
  lat: number
  lng: number
  placeName?: string
}

export function normalizeAddress(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s,]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export async function geocodeViaMapbox(
  address: string,
): Promise<GeocodeResult | null> {
  if (!MAPBOX_TOKEN) return null
  if (!address || address.trim().length < 4) return null
  const encoded = encodeURIComponent(address)
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?bbox=${MIAMI_BBOX}&limit=1&access_token=${MAPBOX_TOKEN}`
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
    })
    if (!res.ok) return null
    const json = (await res.json()) as {
      features?: Array<{
        center?: [number, number]
        place_name?: string
      }>
    }
    const f = json.features?.[0]
    if (!f || !f.center) return null
    const [lng, lat] = f.center
    if (typeof lat !== "number" || typeof lng !== "number") return null
    return { lat, lng, placeName: f.place_name }
  } catch {
    return null
  }
}
