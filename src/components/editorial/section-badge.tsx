import { Link } from "@tanstack/react-router"
import type { Section } from "@/lib/article-types"

// Section kicker: name in the parent (trunk) section's accent color.
// Sub-sections take the parent's color so a row reads as belonging to
// a single beat (Marlins/Heat/Dolphins → Sports red, Politics/Business
// → News blue) instead of fragmenting visually into team palettes.
// Top-level sections fall back to their own color via `parentAccentColor`,
// which `hydrate()` populates with the parent's color or the leaf's
// own color when there's no parent.
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
      ? "text-[0.7rem]"
      : size === "md"
        ? "text-sm"
        : "text-xs"
  const className = `kicker ${sizeCls}`
  const sectionWithParent = section
  const color =
    sectionWithParent.parentAccentColor ?? section.accentColor
  const style = { color }

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
