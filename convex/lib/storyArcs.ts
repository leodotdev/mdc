import type { MutationCtx } from "../_generated/server"
import type { Doc, Id } from "../_generated/dataModel"

// Wires up bidirectional related-article links and story arc clustering for
// a freshly-inserted article. Must be called from inside a mutation so all
// the db writes happen in one transaction.
//
// Behaviour:
// - Each related article gets `newArticleId` added to its `relatedArticleIds`.
// - If none of the related articles have a story arc, create one seeded by
//   the new article's title; assign it to every member.
// - If exactly one arc exists across the related set, reuse it.
// - If multiple arcs exist, merge them into the oldest (everything else
//   gets re-pointed and the empty arc docs are deleted).
export async function linkRelated(
  ctx: MutationCtx,
  newArticleId: Id<"articles">,
  relatedIds: Array<Id<"articles">>,
  newArticleTitle: string,
): Promise<void> {
  if (relatedIds.length === 0) return

  const relatedDocs = await Promise.all(relatedIds.map((id) => ctx.db.get(id)))
  const valid = relatedDocs.filter(
    (d): d is Doc<"articles"> => d !== null,
  )
  if (valid.length === 0) return

  // Add back-reference on each related article. Dedupe.
  for (const r of valid) {
    const existing = r.relatedArticleIds ?? []
    if (existing.includes(newArticleId)) continue
    await ctx.db.patch(r._id, {
      relatedArticleIds: [...existing, newArticleId],
    })
  }

  const existingArcIds = Array.from(
    new Set(
      valid
        .map((r) => r.storyArcId)
        .filter((id): id is Id<"storyArcs"> => !!id),
    ),
  )

  const now = Date.now()
  let arcId: Id<"storyArcs">

  if (existingArcIds.length === 0) {
    arcId = await ctx.db.insert("storyArcs", {
      title: newArticleTitle.slice(0, 200),
      startedAt: now,
      lastActivityAt: now,
    })
  } else if (existingArcIds.length === 1) {
    arcId = existingArcIds[0]
    await ctx.db.patch(arcId, { lastActivityAt: now })
  } else {
    // Merge: keep the oldest arc, re-point everything else.
    const arcs = (
      await Promise.all(existingArcIds.map((id) => ctx.db.get(id)))
    ).filter((a): a is Doc<"storyArcs"> => !!a)
    arcs.sort((a, b) => a.startedAt - b.startedAt)
    arcId = arcs[0]._id
    const toMerge = arcs.slice(1).map((a) => a._id)
    for (const oldArcId of toMerge) {
      const members = await ctx.db
        .query("articles")
        .withIndex("by_story_arc", (q) => q.eq("storyArcId", oldArcId))
        .collect()
      for (const m of members) {
        if (m._id === newArticleId) continue
        await ctx.db.patch(m._id, { storyArcId: arcId })
      }
      await ctx.db.delete(oldArcId)
    }
    await ctx.db.patch(arcId, { lastActivityAt: now })
  }

  // Assign the arc to every related article that doesn't already have one,
  // plus the new article itself.
  for (const r of valid) {
    if (r.storyArcId !== arcId) {
      await ctx.db.patch(r._id, { storyArcId: arcId })
    }
  }
  await ctx.db.patch(newArticleId, { storyArcId: arcId })
}
