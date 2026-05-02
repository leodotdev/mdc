import { Link } from "@tanstack/react-router"
import type { Section } from "@/lib/article-types"

// Section kicker: name in uppercase tracked-out type, tinted with the
// section's accent color. Plain — no leading dot.
export function SectionBadge({
  section,
  asLink = true,
  size = "sm",
}: {
  section: Section
  asLink?: boolean
  size?: "xs" | "sm" | "md"
}) {
  if (!section) return null
  const sizeCls =
    size === "xs"
      ? "text-[0.65rem] tracking-[0.14em]"
      : size === "md"
        ? "text-xs tracking-[0.14em]"
        : "text-[0.7rem] tracking-[0.12em]"
  const className = `kicker ${sizeCls}`
  const style = { color: section.accentColor }

  if (!asLink) {
    return (
      <span className={className} style={style}>
        {section.name}
      </span>
    )
  }
  return (
    <Link
      to="/section/$slug"
      params={{ slug: section.slug }}
      className={`${className} hover:underline underline-offset-4`}
      style={style}
    >
      {section.name}
    </Link>
  )
}
