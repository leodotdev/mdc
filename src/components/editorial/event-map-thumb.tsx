import { cn } from "@/lib/utils"

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined

// Lightweight static-map thumbnail. Used on event cards that lack a
// hero image — turns the venue's coordinates into a recognizable
// thumb so the card doesn't read as "missing." Mapbox Static Images
// API returns a single PNG, so the browser handles it like any other
// `<img>` (lazy loading, srcset, fetchpriority all just work) and
// we don't pay the cost of booting mapbox-gl-js per card.
//
// No-op when VITE_MAPBOX_TOKEN isn't set or coords are missing.

export type EventMapThumbProps = {
  lat: number | null | undefined
  lng: number | null | undefined
  accentColor?: string
  className?: string
  /** Render width in CSS pixels. Mapbox bills per image so we keep
   *  this conservative; the @2x retina path is requested as well. */
  width?: number
  /** Render height in CSS pixels. */
  height?: number
  /** Tighter zoom = more building detail. Default 15 puts a venue
   *  block-level visible. */
  zoom?: number
  alt?: string
}

// Convert a CSS hex / oklch color into a Mapbox-compatible hex string
// for the pin overlay. Mapbox Static Images only accepts 3- or 6-char
// hex — we strip the `#`. Falls back to a dark slate when the input
// isn't hex (e.g. `oklch(...)`).
function pinColor(c: string | undefined): string {
  if (!c) return "1f2937"
  if (/^#[0-9a-f]{3}$/i.test(c)) return c.slice(1)
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.slice(1)
  return "1f2937"
}

export function EventMapThumb({
  lat,
  lng,
  accentColor,
  className,
  width = 600,
  height = 360,
  zoom = 14,
  alt = "Map of event location",
}: EventMapThumbProps) {
  if (
    !MAPBOX_TOKEN ||
    typeof lat !== "number" ||
    typeof lng !== "number"
  ) {
    return null
  }
  const pin = pinColor(accentColor)
  const base = `https://api.mapbox.com/styles/v1/mapbox/light-v11/static`
  const marker = `pin-l+${pin}(${lng},${lat})`
  // Cap size at the Mapbox per-axis limit (1280) just in case a
  // caller passes something huge.
  const w = Math.min(width, 1280)
  const h = Math.min(height, 1280)
  const src = `${base}/${marker}/${lng},${lat},${zoom},0/${w}x${h}@2x?access_token=${MAPBOX_TOKEN}`
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={cn("block w-full bg-muted object-cover", className)}
      style={{ aspectRatio: `${w} / ${h}` }}
    />
  )
}
