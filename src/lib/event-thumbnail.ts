// Decide what to render in an event card's thumbnail slot. Priority:
//
//   1. videoEmbed   →  static thumbnail of the video (YouTube only;
//                      Vimeo would need an API call we don't want to
//                      block render on, so it falls through)
//   2. heroImage    →  the editorial photo
//   3. nothing      →  no thumbnail (caller hides the image slot)
//
// Map-as-thumbnail was removed — the map now lives in the Location
// row of the event detail page, not as a stand-in hero. Cards with no
// photo / no video render text-only.
//
// Pure / synchronous — safe to call inside render. Cards pass the
// returned shape into <HeroImg> / <img>.

export type ThumbDecision =
  | { kind: "video"; src: string; videoId: string }
  | { kind: "image"; src: string }
  | { kind: "none" }

export function decideEventThumbnail(event: {
  videoEmbed?: { provider?: string; id?: string } | null
  heroImage?: string | null
}): ThumbDecision {
  const v = event.videoEmbed
  if (v && v.id) {
    if (v.provider === "youtube") {
      return {
        kind: "video",
        videoId: v.id,
        src: `https://img.youtube.com/vi/${v.id}/hqdefault.jpg`,
      }
    }
  }
  if (event.heroImage && event.heroImage.length > 0) {
    return { kind: "image", src: event.heroImage }
  }
  return { kind: "none" }
}
