import { ExternalLink } from "lucide-react"

import type { Citation } from "@/lib/article-types"
import { formatLongDate } from "@/lib/dates"
import { decodeEntities } from "@/lib/decode-entities"

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

// Sources rendered as a hand of overlapping playing cards splayed across
// the bottom of the article. Each citation is one card, rotated a few
// degrees so the deck fans out — hover lifts a card forward, undoes the
// rotation, and boosts the shadow so the title is fully readable.
//
// Visual scaling notes:
// - Cards keep a 5:7 playing-card ratio (≈140×196).
// - Overlap is via negative margin-left, ~35% of card width on desktop
//   and tighter on small screens. On the smallest viewports the cards
//   stop overlapping and just stack into a left-aligned strip.
// - Z-index ramps up to the right so the most-recently-laid card sits
//   on top, but a hovered card always wins via z-50.
export function SourcesBlock({ citations }: { citations: Array<Citation> }) {
  if (!citations || citations.length === 0) return null
  const count = citations.length
  // Spread rotations evenly across [-7, +7] deg. With a single card it's 0.
  const rotationFor = (i: number) => {
    if (count <= 1) return 0
    return -7 + (14 * i) / (count - 1)
  }
  // Slight vertical lift toward the center to suggest a fan held at the
  // bottom: middle cards sit higher than edges.
  const liftFor = (i: number) => {
    if (count <= 1) return 0
    const mid = (count - 1) / 2
    const dist = Math.abs(i - mid) / mid
    return Math.round((1 - dist) * 8) // 0..8px
  }

  return (
    <aside className="mx-auto mt-16 max-w-4xl">
      <h2 className="kicker mb-8 text-center">Sources</h2>
      <div className="relative flex flex-wrap items-end justify-center pt-6 pb-10 sm:flex-nowrap sm:overflow-x-auto sm:px-4">
        {citations.map((c, i) => (
          <a
            key={`${c.url}-${i}`}
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              transform: `rotate(${rotationFor(i)}deg) translateY(-${liftFor(i)}px)`,
              zIndex: i + 1,
            }}
            className="group/card relative flex h-[200px] w-[148px] shrink-0 flex-col justify-between rounded-md border border-foreground/15 bg-card p-3 shadow-[0_2px_8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.06)] transition-all duration-300 ease-out [transform-origin:bottom_center] [&:not(:first-child)]:-ml-8 sm:[&:not(:first-child)]:-ml-12 hover:z-50 hover:rotate-0 hover:translate-y-[-14px] hover:shadow-[0_12px_32px_rgba(0,0,0,0.18),0_4px_8px_rgba(0,0,0,0.10)]"
          >
            {/* Top: publisher hostname + tiny external-link cue */}
            <div className="flex items-start justify-between gap-2">
              <span className="kicker text-[0.6rem] text-foreground">
                {c.publisher ?? hostname(c.url)}
              </span>
              <ExternalLink
                aria-hidden
                className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover/card:opacity-100"
              />
            </div>

            {/* Middle: source headline — clamps to keep card height fixed */}
            <p className="font-heading text-sm leading-tight font-semibold line-clamp-5">
              {decodeEntities(c.title)}
            </p>

            {/* Bottom: fetched date */}
            <p className="meta text-[0.6rem]">
              Fetched {formatLongDate(c.fetchedAt)}
            </p>
          </a>
        ))}
      </div>
      <p className="meta mx-auto mt-2 max-w-prose text-center text-xs">
        This article was drafted by an AI desk using the cited sources, then
        reviewed and edited by a human editor before publication.
      </p>
    </aside>
  )
}
