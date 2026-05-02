import { Link } from "@tanstack/react-router"

export function TagList({ tags }: { tags: Array<string> }) {
  if (!tags || tags.length === 0) return null
  return (
    <div className="mx-auto mt-10 max-w-3xl">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1.5">
        <span className="kicker mr-1 text-foreground">Filed under</span>
        {tags.map((tag) => (
          <Link
            key={tag}
            to="/tag/$slug"
            params={{ slug: tag }}
            className="rounded-full border px-2.5 py-0.5 text-xs hover:bg-muted hover:text-foreground"
          >
            {tag}
          </Link>
        ))}
      </div>
    </div>
  )
}
