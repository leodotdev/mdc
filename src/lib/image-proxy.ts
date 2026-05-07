// Many newspaper-CDN image hosts hotlink-block plain <img src> requests
// (referrer checks, anti-hotlink rules, restricted User-Agent), even
// when their server-side fetch is fine. We can't ship a custom Referer
// from the browser, so we route through wsrv.nl — a free public image
// proxy that re-fetches the image server-side and serves it back with
// permissive CORS + cache headers.
//
// Trusted hosts (Unsplash, Wikimedia, our own Convex storage) load
// directly without proxying so we don't pay an extra hop for images
// that already work.

const TRUSTED_HOSTS = new Set([
  "images.unsplash.com",
  "upload.wikimedia.org",
  "commons.wikimedia.org",
])

const PROXY_HOSTS = new Set(["wsrv.nl", "images.weserv.nl"])

export function proxiedImageUrl(
  rawUrl: string | undefined,
  opts?: { width?: number; format?: "avif" | "webp" },
): string | undefined {
  if (!rawUrl) return rawUrl
  if (rawUrl.startsWith("data:")) return rawUrl
  let host: string
  try {
    host = new URL(rawUrl).hostname.replace(/^www\./, "")
  } catch {
    return rawUrl
  }
  if (PROXY_HOSTS.has(host)) return rawUrl
  if (TRUSTED_HOSTS.has(host)) return rawUrl
  // wsrv.nl wants the URL without scheme; strip it.
  const params = new URLSearchParams({
    url: rawUrl.replace(/^https?:\/\//i, ""),
  })
  if (opts?.width) params.set("w", String(opts.width))
  // Format conversion (default avif) — wsrv re-encodes server-side and
  // caches, dropping payloads ~30-50% vs the source jpeg/png. Trusted
  // hosts bypass conversion above (Unsplash already serves modern
  // formats; Wikimedia + Convex storage we accept as-is).
  params.set("output", opts?.format ?? "avif")
  return `https://wsrv.nl/?${params.toString()}`
}

// Build a `srcset`-ready string for a hero, dispatching multiple widths
// through the proxy so the browser can pick the right size for the
// rendered slot. Trusted hosts get the same URL across every entry — a
// no-op srcset, but harmless. AVIF output applies to proxied URLs only.
const HERO_WIDTHS = [400, 640, 880, 1200, 1600] as const

export function proxiedImageSrcSet(
  rawUrl: string | undefined,
  widths: ReadonlyArray<number> = HERO_WIDTHS,
): string | undefined {
  if (!rawUrl) return undefined
  return widths
    .map((w) => `${proxiedImageUrl(rawUrl, { width: w })} ${w}w`)
    .join(", ")
}
