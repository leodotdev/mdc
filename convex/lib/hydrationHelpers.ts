// Shared helpers extracted from the (deleted) convex/articles.ts so
// events.ts, agentsData.ts, and migrations.ts can keep using them
// after the article-era purge.

import type { Doc } from "../_generated/dataModel"
import type { QueryCtx, MutationCtx } from "../_generated/server"

// Attach the trunk-section accent so kickers render in the parent's
// color (Marlins → Sports red; Business → News blue) rather than the
// leaf's own. Top-level sections get the field omitted; consumers
// fall back to `section.accentColor`.
export async function attachParentAccent<T extends Doc<"sections"> | null>(
  ctx: QueryCtx | MutationCtx,
  section: T,
): Promise<T extends null ? null : T & { parentAccentColor?: string }> {
  if (!section) return null as T extends null ? null : never
  if (!section.parentId) return section as never
  const parent = await ctx.db.get(section.parentId)
  if (!parent) return section as never
  return { ...section, parentAccentColor: parent.accentColor } as never
}

// Composed search blob written to `events.searchableText` so the
// full-text search index has a single field to hit. Title is doubled
// so it carries more weight than tags or body. Capped at 2000 chars to
// stay under Convex's index size budget.
export function buildSearchableText(input: {
  title: string
  dek: string
  tags: ReadonlyArray<string>
}): string {
  return [input.title, input.title, input.dek, input.tags.join(" ")]
    .join(" ")
    .slice(0, 2000)
}
