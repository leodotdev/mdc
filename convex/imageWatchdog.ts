// Image health watchdog. Cron picks up to N recently-published articles +
// approved events whose hero hasn't been checked in 24h, runs a HEAD
// against each, and either marks ok / re-resolves to a fresh candidate.
//
// Why HEAD via fetch (not the proxy): we want to know whether the
// canonical CDN URL still resolves so the proxy doesn't have to keep
// fronting a broken upstream. Many newspaper CDNs return 200 on HEAD
// even when GET refuses; we accept some false-positives because the
// alternative (full GET) costs more bandwidth.

import { v } from "convex/values"

import { api, internal } from "./_generated/api"
import {
  action,
  internalAction,
  internalMutation,
  query,
} from "./_generated/server"
import { findHeroCandidates, isLowQualityHero } from "./lib/media"
import type { Doc } from "./_generated/dataModel"

const HEAD_TIMEOUT_MS = 5_000
const STALE_AFTER_MS = 24 * 3_600_000 // 24h

type HeroProbeResult = "ok" | "broken" | "unknown"

async function probeHero(url: string): Promise<HeroProbeResult> {
  const ctrl = new AbortController()
  const timeout = setTimeout(() => ctrl.abort(), HEAD_TIMEOUT_MS)
  try {
    const resp = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: ctrl.signal,
    })
    clearTimeout(timeout)
    if (resp.ok) return "ok"
    // Some CDNs reject HEAD but allow GET. Treat 405 / 403 as unknown.
    if (resp.status === 405 || resp.status === 403) return "unknown"
    return "broken"
  } catch {
    clearTimeout(timeout)
    return "unknown"
  }
}

// Articles whose hero is due for a check. Targets recently-published rows
// (last 30 days) so the cost stays bounded as the archive grows.
export const articlesNeedingHeroCheck = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const now = Date.now()
    const cap = limit ?? 25
    const recent = await ctx.db
      .query("articles")
      .withIndex("by_status_published", (q) => q.eq("status", "published"))
      .order("desc")
      .take(150)
    const due: Array<Doc<"articles">> = []
    for (const a of recent) {
      if (!a.heroImage) continue
      if (
        !a.heroLastChecked ||
        now - a.heroLastChecked > STALE_AFTER_MS ||
        a.heroLastStatus === "broken" ||
        isLowQualityHero(a.heroImage)
      ) {
        due.push(a)
      }
      if (due.length >= cap) break
    }
    return due
  },
})

// Events: same shape but pull approved-only events still upcoming or
// recently past (don't bother checking heroes on archived events).
export const eventsNeedingHeroCheck = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const now = Date.now()
    const cap = limit ?? 25
    const startsAtFloor = now - 7 * 24 * 3_600_000 // 7-day grace
    const recent = await ctx.db
      .query("events")
      .withIndex("by_status_starts", (q) =>
        q.eq("status", "approved").gte("startsAt", startsAtFloor),
      )
      .order("asc")
      .take(150)
    const due: Array<Doc<"events">> = []
    for (const e of recent) {
      if (!e.heroImage) continue
      if (
        !e.heroLastChecked ||
        now - e.heroLastChecked > STALE_AFTER_MS ||
        e.heroLastStatus === "broken" ||
        isLowQualityHero(e.heroImage)
      ) {
        due.push(e)
      }
      if (due.length >= cap) break
    }
    return due
  },
})

export const stampArticleHero = internalMutation({
  args: {
    articleId: v.id("articles"),
    status: v.union(
      v.literal("ok"),
      v.literal("broken"),
      v.literal("unknown"),
    ),
    newHeroImage: v.optional(v.string()),
    newHeroCaption: v.optional(v.string()),
    newHeroSource: v.optional(
      v.union(
        v.literal("source"),
        v.literal("unsplash"),
        v.literal("wikimedia"),
        v.literal("none"),
      ),
    ),
  },
  handler: async (
    ctx,
    { articleId, status, newHeroImage, newHeroCaption, newHeroSource },
  ) => {
    const patch: Record<string, unknown> = {
      heroLastChecked: Date.now(),
      heroLastStatus: status,
    }
    if (newHeroImage) {
      patch.heroImage = newHeroImage
      if (newHeroCaption) patch.heroCaption = newHeroCaption
      if (newHeroSource) patch.heroSource = newHeroSource
      // Stamp `ok` since we just resolved a fresh candidate.
      patch.heroLastStatus = "ok"
    }
    await ctx.db.patch(articleId, patch)
  },
})

export const stampEventHero = internalMutation({
  args: {
    eventId: v.id("events"),
    status: v.union(
      v.literal("ok"),
      v.literal("broken"),
      v.literal("unknown"),
    ),
    newHeroImage: v.optional(v.string()),
    newHeroCaption: v.optional(v.string()),
    newHeroSource: v.optional(
      v.union(
        v.literal("source"),
        v.literal("unsplash"),
        v.literal("wikimedia"),
        v.literal("none"),
      ),
    ),
  },
  handler: async (
    ctx,
    { eventId, status, newHeroImage, newHeroCaption, newHeroSource },
  ) => {
    const patch: Record<string, unknown> = {
      heroLastChecked: Date.now(),
      heroLastStatus: status,
    }
    if (newHeroImage) {
      patch.heroImage = newHeroImage
      if (newHeroCaption) patch.heroCaption = newHeroCaption
      if (newHeroSource) patch.heroSource = newHeroSource
      patch.heroLastStatus = "ok"
    }
    await ctx.db.patch(eventId, patch)
  },
})

// Cron tick: probe articles + events, re-resolve broken ones.
export const cronTick = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    articlesChecked: number
    articlesFixed: number
    eventsChecked: number
    eventsFixed: number
  }> => {
    let articlesChecked = 0
    let articlesFixed = 0
    let eventsChecked = 0
    let eventsFixed = 0

    const articles: Array<Doc<"articles">> = await ctx.runQuery(
      api.imageWatchdog.articlesNeedingHeroCheck,
      { limit: 25 },
    )
    for (const a of articles) {
      if (!a.heroImage) continue
      articlesChecked += 1
      const looksLogo = isLowQualityHero(a.heroImage)
      const status = looksLogo ? "broken" : await probeHero(a.heroImage)
      if (status === "ok" || status === "unknown") {
        await ctx.runMutation(internal.imageWatchdog.stampArticleHero, {
          articleId: a._id,
          status,
        })
        continue
      }
      // Broken (or logo-y) — re-resolve via the same hero finder used
      // at draft time. The new resolveHero already demotes social-card
      // logos, so the second attempt should land on a real photo.
      let sectionLabel = "Miami"
      const sec = await ctx.runQuery(api.sections.getById, {
        id: a.sectionId,
      })
      if (sec) sectionLabel = sec.name
      const tagsForQuery = a.tags
        .filter((t) => t.length > 2)
        .slice(0, 2)
        .map((t) => t.replace(/-/g, " "))
      const fallbackQuery =
        [...tagsForQuery, sectionLabel].filter(Boolean).join(" ") ||
        `Miami ${sectionLabel}`
      const result = await findHeroCandidates({
        citationUrls: a.citations.map((c) => c.url),
        fallbackQuery,
        excludeUrl: a.heroImage,
      })
      const next = result.candidates.find((c) => c.url !== a.heroImage)
      if (!next) {
        await ctx.runMutation(internal.imageWatchdog.stampArticleHero, {
          articleId: a._id,
          status: "broken",
        })
        continue
      }
      await ctx.runMutation(internal.imageWatchdog.stampArticleHero, {
        articleId: a._id,
        status: "broken",
        newHeroImage: next.url,
        newHeroCaption: next.caption,
        newHeroSource: next.source,
      })
      articlesFixed += 1
    }

    const events: Array<Doc<"events">> = await ctx.runQuery(
      api.imageWatchdog.eventsNeedingHeroCheck,
      { limit: 25 },
    )
    for (const e of events) {
      if (!e.heroImage) continue
      eventsChecked += 1
      const looksLogo = isLowQualityHero(e.heroImage)
      const status = looksLogo ? "broken" : await probeHero(e.heroImage)
      if (status === "ok" || status === "unknown") {
        await ctx.runMutation(internal.imageWatchdog.stampEventHero, {
          eventId: e._id,
          status,
        })
        continue
      }
      // Section is hydrated through the index path for events; for the
      // watchdog we look it up to keep the query lean.
      let sectionName = "Miami"
      if (e.sectionId) {
        const sec = await ctx.runQuery(api.sections.getById, {
          id: e.sectionId,
        })
        if (sec) sectionName = sec.name
      }
      const tagsForQuery = (e.tags ?? [])
        .filter((t) => t.length > 2)
        .slice(0, 2)
        .map((t) => t.replace(/-/g, " "))
      const fallbackQuery =
        [...tagsForQuery, sectionName].filter(Boolean).join(" ") ||
        `Miami ${sectionName}`
      const citationUrls = [
        ...((e.citations ?? []).map((c) => c.url)),
        ...(e.url ? [e.url] : []),
      ]
      const result = await findHeroCandidates({
        citationUrls,
        fallbackQuery,
        excludeUrl: e.heroImage,
      })
      const next = result.candidates.find((c) => c.url !== e.heroImage)
      if (!next) {
        await ctx.runMutation(internal.imageWatchdog.stampEventHero, {
          eventId: e._id,
          status: "broken",
        })
        continue
      }
      await ctx.runMutation(internal.imageWatchdog.stampEventHero, {
        eventId: e._id,
        status: "broken",
        newHeroImage: next.url,
        newHeroCaption: next.caption,
        newHeroSource: next.source,
      })
      eventsFixed += 1
    }

    return { articlesChecked, articlesFixed, eventsChecked, eventsFixed }
  },
})

// Editor-triggered manual sweep — same logic as the cron, but reachable
// from the dashboard "Fix broken images" button so the editor doesn't
// have to wait 6h for the next scheduled tick. Auth-gated so randos
// can't burn fetches.
export const runNow = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    articlesChecked: number
    articlesFixed: number
    eventsChecked: number
    eventsFixed: number
  }> => {
    await ctx.runQuery(api.me.current, {})
    return await ctx.runAction(internal.imageWatchdog.cronTick, {})
  },
})

// Re-resolve hero on a single article — even when the watchdog hasn't
// flagged it broken yet. Editor uses this from the queue/published rows
// when an image looks bad to a human eye but still HEAD-OKs server-side.
export const reresolveOne = action({
  args: { articleId: v.id("articles") },
  handler: async (
    ctx,
    { articleId },
  ): Promise<{ replaced: boolean; newUrl?: string }> => {
    await ctx.runQuery(api.me.current, {})
    const article = await ctx.runQuery(api.articles.getById, { id: articleId })
    if (!article || !article.heroImage) {
      return { replaced: false }
    }
    const sectionLabel = article.section?.name ?? "Miami"
    const tagsForQuery = article.tags
      .filter((t) => t.length > 2)
      .slice(0, 2)
      .map((t) => t.replace(/-/g, " "))
    const fallbackQuery =
      [...tagsForQuery, sectionLabel].filter(Boolean).join(" ") ||
      `Miami ${sectionLabel}`
    const result = await findHeroCandidates({
      citationUrls: article.citations.map((c) => c.url),
      fallbackQuery,
      excludeUrl: article.heroImage,
    })
    const next = result.candidates.find((c) => c.url !== article.heroImage)
    if (!next) return { replaced: false }
    await ctx.runMutation(internal.imageWatchdog.stampArticleHero, {
      articleId,
      status: "broken",
      newHeroImage: next.url,
      newHeroCaption: next.caption,
      newHeroSource: next.source,
    })
    return { replaced: true, newUrl: next.url }
  },
})

// Recent broken count for the admin live status panel.
export const brokenCount = query({
  args: {},
  handler: async (ctx) => {
    const articles = await ctx.db
      .query("articles")
      .withIndex("by_status_published", (q) => q.eq("status", "published"))
      .order("desc")
      .take(150)
    const events = await ctx.db
      .query("events")
      .withIndex("by_status_starts", (q) => q.eq("status", "approved"))
      .order("desc")
      .take(150)
    const articleBroken = articles.filter(
      (a) => a.heroLastStatus === "broken",
    ).length
    const eventBroken = events.filter(
      (e) => e.heroLastStatus === "broken",
    ).length
    return {
      articleBroken,
      eventBroken,
      total: articleBroken + eventBroken,
    }
  },
})

