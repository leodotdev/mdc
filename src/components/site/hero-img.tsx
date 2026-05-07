import { ImageOff } from "lucide-react"
import { useState } from "react"

import { cn } from "@/lib/utils"

// Public-side hero image. Renders the upstream URL directly with a
// graceful fallback to a neutral placeholder when the image fails to
// load (404, hotlink-block, decode error, 0-dimensional response).
//
// Border-radius lives ON the image itself — not on a wrapper with
// overflow-hidden — because rounded-bg-with-transformed-children
// clipping is unreliable in Chrome/Safari. With the radius on the
// img, hover-scale gracefully scales the corners with the image; no
// clip is involved, so no clip can fail.
//
// `priority` flips the image to LCP mode: eager loading + high
// fetchpriority so the browser kicks off the request as soon as the
// HTML parses. Use it for the lead image on each route.
export function HeroImg({
  url,
  alt = "",
  className,
  loading,
  priority = false,
  rounded = "lg",
}: {
  url: string | undefined
  alt?: string
  className?: string
  loading?: "lazy" | "eager"
  /** True for the page's LCP hero — sets fetchpriority + eager loading. */
  priority?: boolean
  /** Border-radius variant baked onto the img element. `"none"` for
   *  contexts where the surrounding card already provides rounding. */
  rounded?: "lg" | "md" | "none"
  /** Legacy: width hint for the proxy. Now ignored — direct upstream
   *  URL is used. Kept in the signature so existing call sites compile. */
  width?: number
  /** Legacy: srcset sizes attribute. Now ignored — single-source img. */
  sizes?: string
}) {
  const [broken, setBroken] = useState(!url)
  const radiusClass =
    rounded === "lg" ? "rounded-lg" : rounded === "md" ? "rounded-md" : ""
  if (!url || broken) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-muted text-muted-foreground/60",
          radiusClass,
          className,
        )}
        aria-label={alt || "Image unavailable"}
      >
        <ImageOff className="size-8" />
      </div>
    )
  }
  const effectiveLoading = loading ?? (priority ? "eager" : "lazy")
  return (
    <img
      src={url}
      alt={alt}
      loading={effectiveLoading}
      fetchPriority={priority ? "high" : undefined}
      className={cn(radiusClass, className)}
      onError={() => setBroken(true)}
      onLoad={(e) => {
        const img = e.currentTarget
        // Some upstreams return 200 with a 0-dimensional or fully
        // transparent error placeholder. Treat those as failures.
        if (img.naturalWidth === 0 || img.naturalHeight === 0) {
          setBroken(true)
        }
      }}
    />
  )
}
