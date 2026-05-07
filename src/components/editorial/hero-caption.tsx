import type { Citation } from "@/lib/article-types"
import { cn } from "@/lib/utils"

// Hero image caption. The mega-desk writes captions in the form
// "Image: <hostname>" (and sometimes "Image: <hostname> — <description>")
// where the hostname identifies which citation the image was pulled
// from. This component finds the matching citation by hostname and
// turns the hostname into an outbound link to the source page, so
// readers can click straight through to the page the image came from.
//
// When no caption matches the pattern, or no citation matches the
// hostname, we render the caption as plain text — the link is purely
// additive.

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

export function HeroCaption({
  caption,
  citations,
  className,
}: {
  caption: string | undefined | null
  citations: ReadonlyArray<Citation> | undefined
  className?: string
}) {
  if (!caption) return null

  // Match "Image: <host>" or "Image: <host> — rest" / "Image: <host>: rest".
  // Hostnames are restricted to the typical character set so we don't
  // accidentally swallow following words.
  const match = caption.match(/^(Image:\s+)([a-z0-9.\-]+\.[a-z]{2,})(.*)$/i)
  if (!match) {
    return <span className={cn("meta", className)}>{caption}</span>
  }
  const [, prefix, host, rest] = match
  const link = (citations ?? []).find(
    (c) => hostnameOf(c.url) === host.toLowerCase(),
  )

  if (!link) {
    return <span className={cn("meta", className)}>{caption}</span>
  }

  return (
    <span className={cn("meta", className)}>
      {prefix}
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:underline"
        title={link.title}
      >
        {host}
      </a>
      {rest}
    </span>
  )
}
