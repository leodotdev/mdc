import { Play } from "lucide-react"

import { cn } from "@/lib/utils"

// Static video thumbnail for event cards. A plain `<img>` of the
// YouTube `hqdefault.jpg` (or any provider's pre-extracted poster
// URL) with a centered play-icon overlay so it reads as "video"
// before the user taps in. Clicking the card opens the event detail
// where the real iframe lives — we never autoplay or load
// mapbox-style JS for the card view.

export function EventVideoThumb({
  src,
  alt,
  className,
}: {
  src: string
  alt?: string
  className?: string
}) {
  return (
    <div className={cn("relative block w-full bg-black", className)}>
      <img
        src={src}
        alt={alt ?? ""}
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover opacity-90"
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm">
          <Play className="size-6 fill-white text-white" aria-hidden />
        </div>
      </div>
    </div>
  )
}
