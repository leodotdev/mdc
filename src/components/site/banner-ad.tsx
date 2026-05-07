import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { useEffect } from "react"

import { api } from "../../../convex/_generated/api"
import {
  adsenseClient,
  adsenseSlot,
  isAdsenseConfigured,
  pushAdsenseSlot,
  scheduleAdsenseLoad,
} from "@/lib/adsense"

// Reusable banner-ad placeholder. Renders a 300×250 (mobile) /
// 970×250 IAB Billboard (desktop) dashed box with the route-specific
// `data-ad-slot` so future ad-server / direct-sold integration can
// target the slot by key. Lives on every public surface — see the
// `routes/_site/*` files. The actual fill (creative + tracking) ships
// later; until then this reserves the layout space.
//
// `slot` should be a stable, descriptive key:
//   "home-mid"          ·  "home-bottom"
//   "section-news-mid"  ·  "section-news-bottom"
//   "article-mid"       ·  "article-bottom"
//   etc.
//
// When `VITE_ADSENSE_CLIENT` and `VITE_ADSENSE_SLOT` are both set in
// the environment (production deploy), we render a real
// `<ins class="adsbygoogle">` block instead of the placeholder. The
// global `adsbygoogle.js` script is lazy-loaded by `scheduleAdsenseLoad`
// only after first scroll or 1s idle — keeping it off the LCP critical
// path. Each ad unit pushes itself into AdSense's queue on mount; the
// queue is processed once the script lands.
export function BannerAd({
  slot,
  className,
}: {
  slot: string
  className?: string
}) {
  // Site-wide kill switch — when an admin toggles ads off in the
  // dashboard, every `<BannerAd>` collapses to nothing (no reserved
  // space, no script load, no placeholder). Hidden by default during
  // SSR / first paint until the setting resolves; false-positive flicker
  // is preferable to flashing ads on a site that's meant to hide them.
  const { data: settings } = useQuery(convexQuery(api.siteSettings.get, {}))
  if (settings && !settings.adsEnabled) return null

  if (isAdsenseConfigured()) {
    return <AdsenseBanner slot={slot} className={className} />
  }
  return <PlaceholderBanner slot={slot} className={className} />
}

function PlaceholderBanner({
  slot,
  className,
}: {
  slot: string
  className?: string
}) {
  return (
    <aside aria-label="Advertisement" className={className}>
      <p className="meta mb-3 text-center text-xs">Advertisement</p>
      <div
        data-ad-slot={slot}
        className="mx-auto flex h-[250px] w-full max-w-[300px] items-center justify-center rounded-lg border border-dashed border-foreground/30 bg-muted/30 md:max-w-[970px]"
      >
        <span className="meta text-xs">
          <span className="md:hidden">300 × 250</span>
          <span className="hidden md:inline">970 × 250 — Billboard</span>
        </span>
      </div>
    </aside>
  )
}

function AdsenseBanner({
  slot,
  className,
}: {
  slot: string
  className?: string
}) {
  const client = adsenseClient()
  const adSlotId = adsenseSlot()

  useEffect(() => {
    scheduleAdsenseLoad()
    pushAdsenseSlot()
  }, [])

  if (!client || !adSlotId) {
    return <PlaceholderBanner slot={slot} className={className} />
  }

  return (
    <aside aria-label="Advertisement" className={className}>
      <p className="meta mb-3 text-center text-xs">Advertisement</p>
      <ins
        className="adsbygoogle mx-auto block w-full max-w-[300px] md:max-w-[970px]"
        style={{ display: "block", height: 250 }}
        data-ad-client={client}
        data-ad-slot={adSlotId}
        data-ad-format="auto"
        data-full-width-responsive="true"
        data-ad-region={slot}
      />
    </aside>
  )
}
