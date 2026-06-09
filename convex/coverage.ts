// Per-section coverage SLA. Daily cron walks every section, counts
// approved events in the last 14 days (using the same scope rules as
// the public section pages — direct sectionId, cross-listed, plus
// tag-relevance), patches `eventsLast14d` for the admin readout, and
// writes a `systemAlerts` row for any section below its
// `minEventsLast14d` floor.
//
// Editors react by adding sources or promoting under-yield ones to
// browser-extract. The alerts go to /admin's dashboard.

import { internal } from "./_generated/api"
import { internalAction, internalMutation, query } from "./_generated/server"
import { requireEditor } from "./lib/guard"

const WINDOW_MS = 14 * 24 * 3_600_000

export const cronTick = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ scanned: number; alerted: number; refreshed: number }> => {
    return await ctx.runMutation(internal.coverage.recompute, {})
  },
})

export const recompute = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const since = now - WINDOW_MS
    const sections = await ctx.db.query("sections").collect()
    // Index sections by parent for cross-listed scope expansion.
    const childrenByParent = new Map<string, Array<typeof sections[number]>>()
    for (const s of sections) {
      if (!s.parentId) continue
      const k = s.parentId as unknown as string
      const list = childrenByParent.get(k) ?? []
      list.push(s)
      childrenByParent.set(k, list)
    }
    // One scan of recent events — group by sectionId so the per-section
    // pass below doesn't re-query the table per row.
    const recent = await ctx.db
      .query("events")
      .withIndex("by_status_published", (q) => q.eq("status", "approved"))
      .order("desc")
      .take(3000)
    const inWindow = recent.filter(
      (e) => (e.publishedAt ?? e.createdAt) >= since,
    )
    const countBySectionId = new Map<string, number>()
    const tagsByEventId = new Map<string, ReadonlyArray<string>>()
    for (const e of inWindow) {
      const sid = e.sectionId as unknown as string
      countBySectionId.set(sid, (countBySectionId.get(sid) ?? 0) + 1)
      if (e.tags && e.tags.length > 0) tagsByEventId.set(e._id as unknown as string, e.tags)
    }
    let alerted = 0
    let refreshed = 0
    for (const s of sections) {
      // Direct + child + cross-listed sectionIds = the "owned" set.
      const ownedIds = new Set<string>([s._id as unknown as string])
      for (const c of childrenByParent.get(s._id as unknown as string) ?? []) {
        ownedIds.add(c._id as unknown as string)
      }
      for (const x of sections) {
        if (x.crossListedIn?.includes(s._id)) {
          ownedIds.add(x._id as unknown as string)
        }
      }
      // Section count = direct hits + tag-relevant hits whose sectionId
      // isn't already in the owned set.
      let count = 0
      const seen = new Set<string>()
      for (const sid of ownedIds) {
        const inSection = inWindow.filter((e) => (e.sectionId as unknown as string) === sid)
        for (const e of inSection) {
          if (seen.has(e._id as unknown as string)) continue
          seen.add(e._id as unknown as string)
          count += 1
        }
      }
      const associatedTags = new Set(
        s.associatedTags && s.associatedTags.length > 0
          ? s.associatedTags
          : [s.slug],
      )
      for (const e of inWindow) {
        if (seen.has(e._id as unknown as string)) continue
        if (ownedIds.has(e.sectionId as unknown as string)) continue
        const tags = e.tags ?? []
        if (!tags.some((t) => associatedTags.has(t))) continue
        seen.add(e._id as unknown as string)
        count += 1
      }
      const prev = s.eventsLast14d ?? -1
      if (prev !== count) {
        await ctx.db.patch(s._id, { eventsLast14d: count })
        refreshed += 1
      }
      // Alert when below the floor. Resolve existing open alerts when
      // the section recovers so the dashboard self-cleans.
      const floor = s.minEventsLast14d
      if (floor === undefined) continue
      const kind = `coverage:${s.slug}`
      const existing = await ctx.db
        .query("systemAlerts")
        .withIndex("by_kind", (q) => q.eq("kind", kind))
        .filter((q) => q.eq(q.field("resolvedAt"), undefined))
        .first()
      if (count < floor) {
        if (!existing) {
          await ctx.db.insert("systemAlerts", {
            kind,
            severity: "warning",
            message: `${s.name} has ${count} events in the last 14d (floor: ${floor}). Add sources or promote silent ones.`,
            createdAt: now,
          })
          alerted += 1
        } else {
          // Refresh the message + timestamp.
          await ctx.db.patch(existing._id, {
            message: `${s.name} has ${count} events in the last 14d (floor: ${floor}). Add sources or promote silent ones.`,
            createdAt: now,
          })
        }
      } else if (existing) {
        await ctx.db.patch(existing._id, { resolvedAt: now })
      }
    }
    return { scanned: sections.length, alerted, refreshed }
  },
})

// Editor-facing query for the admin dashboard widget. Returns sections
// sorted by "neediness" — those most under their floor surface first.
export const undercovered = query({
  args: {},
  handler: async (ctx) => {
    await requireEditor(ctx)
    const sections = await ctx.db.query("sections").collect()
    return sections
      .filter((s) => s.minEventsLast14d !== undefined)
      .map((s) => ({
        _id: s._id,
        slug: s.slug,
        name: s.name,
        floor: s.minEventsLast14d ?? 0,
        actual: s.eventsLast14d ?? 0,
        gap: (s.minEventsLast14d ?? 0) - (s.eventsLast14d ?? 0),
      }))
      .filter((r) => r.gap > 0)
      .sort((a, b) => b.gap - a.gap)
  },
})
