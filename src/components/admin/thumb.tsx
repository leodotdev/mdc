import { ImageOff } from "lucide-react"
import { useState } from "react"

import { proxiedImageUrl } from "@/lib/image-proxy"
import { cn } from "@/lib/utils"

// Small admin thumbnail that gracefully degrades to a placeholder when
// the image fails to load (broken hero, hotlink-protected CDN that even
// the wsrv.nl proxy can't unstick, expired querystring auth tokens). The
// browser's default broken-image icon looks ugly and confusing — this
// just renders the same neutral placeholder as the "no hero image at all"
// state.
//
// Try the wsrv.nl proxy first, fall back to raw URL on proxy failure,
// then to the placeholder if the raw also fails. Same staircase as the
// HeroPicker tile, scoped down for the admin tables.
export function Thumb({
  url,
  width = 200,
  className,
}: {
  url: string | undefined
  width?: number
  className?: string
}) {
  const [stage, setStage] = useState<"proxy" | "raw" | "broken">(
    url ? "proxy" : "broken",
  )
  if (!url || stage === "broken") {
    return (
      <div
        className={cn(
          "flex h-12 w-16 items-center justify-center rounded bg-muted text-muted-foreground",
          className,
        )}
        aria-label="No image"
      >
        <ImageOff className="h-4 w-4" />
      </div>
    )
  }
  const src =
    stage === "proxy" ? (proxiedImageUrl(url, { width }) ?? url) : url
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      className={cn("h-12 w-16 rounded object-cover", className)}
      onError={() => setStage(stage === "proxy" ? "raw" : "broken")}
    />
  )
}
