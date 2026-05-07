// Lazy-loaded AdSense integration. Reads `VITE_ADSENSE_CLIENT` (the
// publisher ID, e.g. `ca-pub-1234567890123456`) and `VITE_ADSENSE_SLOT`
// (a single ad-unit slot ID, used across every placement). When either
// is missing we keep showing the dashed `<BannerAd>` placeholder so dev
// + pre-launch builds don't ship empty ad markup.
//
// Loading strategy: the global `adsbygoogle.js` is appended to <head>
// only after EITHER the first user scroll OR 1s of idle time —
// whichever fires first. That keeps the third-party script out of the
// LCP critical path while still getting fill on every viewable ad.
//
// Each `<ins class="adsbygoogle">` block on the page calls
// `(window.adsbygoogle ||= []).push({})` once on mount; AdSense queues
// those pushes and processes them when the script eventually loads.

const CLIENT_ID = import.meta.env.VITE_ADSENSE_CLIENT as string | undefined
const SLOT_ID = import.meta.env.VITE_ADSENSE_SLOT as string | undefined

export function adsenseClient(): string | null {
  return CLIENT_ID && CLIENT_ID.length > 0 ? CLIENT_ID : null
}

export function adsenseSlot(): string | null {
  return SLOT_ID && SLOT_ID.length > 0 ? SLOT_ID : null
}

export function isAdsenseConfigured(): boolean {
  return adsenseClient() !== null && adsenseSlot() !== null
}

// Module-scoped singleton state. The script is appended once per page
// load, no matter how many `<BannerAd>` instances render.
let scheduled = false
let appended = false

function appendScript(client: string) {
  if (appended) return
  appended = true
  const script = document.createElement("script")
  script.async = true
  script.crossOrigin = "anonymous"
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`
  document.head.appendChild(script)
}

declare global {
  interface Window {
    adsbygoogle?: Array<Record<string, unknown>>
  }
}

export function scheduleAdsenseLoad(): void {
  if (scheduled || appended) return
  const client = adsenseClient()
  if (!client) return
  if (typeof window === "undefined") return
  scheduled = true

  let triggered = false
  const fire = () => {
    if (triggered) return
    triggered = true
    cleanup()
    appendScript(client)
  }

  const onScroll = () => fire()
  const onPointer = () => fire()

  const ric = window.requestIdleCallback
  let idleHandle: number | undefined
  if (typeof ric === "function") {
    idleHandle = ric(fire, { timeout: 2000 })
  } else {
    idleHandle = window.setTimeout(fire, 1000)
  }
  window.addEventListener("scroll", onScroll, { once: true, passive: true })
  window.addEventListener("pointerdown", onPointer, { once: true, passive: true })

  function cleanup() {
    if (idleHandle != null) {
      if (typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleHandle)
      } else {
        window.clearTimeout(idleHandle)
      }
    }
    window.removeEventListener("scroll", onScroll)
    window.removeEventListener("pointerdown", onPointer)
  }
}

export function pushAdsenseSlot(): void {
  if (typeof window === "undefined") return
  try {
    ;(window.adsbygoogle = window.adsbygoogle || []).push({})
  } catch {
    // First push before script lands can throw on cold init in some
    // browsers; the queue is still seeded so AdSense will pick it up.
  }
}
