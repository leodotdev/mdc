import { Link } from "@tanstack/react-router"

import { neighborhoodName } from "../../../convex/lib/neighborhoods"
import { HeroCaption } from "./hero-caption"
import { SectionBadge } from "./section-badge"
import { ShareWidget } from "./share-widget"
import type { ArticleWithRelations } from "@/lib/article-types"
import { HeroImg } from "@/components/site/hero-img"
import { formatLongDate } from "@/lib/dates"
import { useTranslation } from "@/lib/i18n/context"
import { localizedArticle } from "@/lib/localized-article"

// Article hero header. Three meta rows for consistent rhythm with the
// event header:
//   line 1 — date (time / location are event-only and skipped here)
//   line 2 — #tags · neighborhoods
//   line 3 — Share dropdown
export function ArticleHeader({
  article: rawArticle,
}: {
  article: ArticleWithRelations
}) {
  const { lang } = useTranslation()
  const article = localizedArticle(rawArticle, lang)
  const neighborhoods = (article.neighborhoods ?? [])
    .map((slug) => ({ slug, name: neighborhoodName(slug) }))
    .filter((n): n is { slug: string; name: string } => !!n.name)
  const tags = (article.tags ?? []).slice(0, 4)
  const hasPills = tags.length > 0 || neighborhoods.length > 0
  // "From" line in place of a byline. Citations carry the source name in
  // `publisher`; dedup case-insensitively and strip the parenthetical
  // adapter tag ("(RSS)", "(YouTube)") since readers don't care which
  // protocol an outlet's words arrived through. Cap at 4 — long lists
  // become noise.
  const sources: Array<string> = (() => {
    const seen = new Set<string>()
    const out: Array<string> = []
    for (const c of article.citations ?? []) {
      const clean = (c.publisher ?? "")
        .replace(/\s*\((?:RSS|YouTube|podcast|ICS)\)\s*$/i, "")
        .trim()
      if (!clean) continue
      const key = clean.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(clean)
      if (out.length >= 4) break
    }
    return out
  })()

  return (
    <header className="mx-auto max-w-3xl">
      <div className="flex flex-col gap-3 text-center">
        <div className="mx-auto">
          <SectionBadge section={article.section} size="md" />
        </div>
        <h1 className="display-xl mt-2">{article.title}</h1>
        <p className="font-sans mx-auto mt-2 max-w-2xl text-base font-normal text-muted-foreground">
          {article.dek}
        </p>

        {/* Line 1 — date + "From" sources. No human byline — every story
            is AI-edited from the cited outlets, so the meta acknowledges
            the origin directly instead of crediting an agent persona. */}
        {article.publishedAt || sources.length > 0 ? (
          <p className="font-sans mt-5 text-sm font-medium tabular-nums text-foreground">
            {article.publishedAt ? formatLongDate(article.publishedAt) : null}
            {article.publishedAt && sources.length > 0 ? (
              <span aria-hidden className="mx-2 text-muted-foreground">·</span>
            ) : null}
            {sources.length > 0 ? (
              <span className="font-normal text-muted-foreground">
                From {sources.join(", ")}
              </span>
            ) : null}
          </p>
        ) : null}

        {/* Line 2 — #tags · neighborhood pills. Same pill shape for both
            so they read as one taxonomy strip. */}
        {hasPills ? (
          <div className="mx-auto flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
            {tags.map((tag) => (
              <Link
                key={`tag-${tag}`}
                to="/tag/$slug"
                params={{ slug: tag }}
                className="rounded-full border border-foreground/15 bg-card px-2.5 py-0.5 text-xs hover:bg-muted"
              >
                #{tag}
              </Link>
            ))}
            {neighborhoods.map(({ slug, name }) => (
              <Link
                key={`hood-${slug}`}
                to="/neighborhood/$slug"
                params={{ slug }}
                className="rounded-full border border-foreground/15 bg-card px-2.5 py-0.5 text-xs hover:bg-muted"
              >
                {name}
              </Link>
            ))}
          </div>
        ) : null}

        {/* Line 3 — Share dropdown. Lifted from the rest of the header
            with a hairline above so "story" → "act on it" reads as a
            beat, not a continuation of the meta strip. */}
        <div className="mx-auto mt-3 flex w-fit flex-wrap items-center justify-center gap-2 border-t border-foreground/10 pt-3">
          <ShareWidget title={article.title} />
        </div>
      </div>
      {article.mediaType === "video" && article.videoEmbed ? (
        <figure className="mt-8">
          <VideoEmbed embed={article.videoEmbed} title={article.title} />
          {article.heroCaption ? (
            <figcaption className="mt-2 text-sm">
              <HeroCaption
                caption={article.heroCaption}
                citations={article.citations}
              />
            </figcaption>
          ) : null}
        </figure>
      ) : article.heroImage ? (
        <figure className="mt-8">
          <HeroImg
            url={article.heroImage}
            width={1200}
            priority
            alt={article.heroCaption ?? ""}
            className="aspect-[16/9] w-full object-cover"
          />
          {article.heroCaption ? (
            <figcaption className="mt-2 text-sm">
              <HeroCaption
                caption={article.heroCaption}
                citations={article.citations}
              />
            </figcaption>
          ) : null}
        </figure>
      ) : null}
    </header>
  )
}

// Video lead — replaces the hero image on `mediaType: "video"` articles.
// Uses each provider's embed URL with no autoplay, no related-videos
// rail; we want a respectable lede, not a YouTube experience.
function VideoEmbed({
  embed,
  title,
}: {
  embed: { provider: "youtube" | "vimeo"; id: string }
  title: string
}) {
  const src =
    embed.provider === "youtube"
      ? `https://www.youtube-nocookie.com/embed/${embed.id}?rel=0&modestbranding=1`
      : `https://player.vimeo.com/video/${embed.id}?title=0&byline=0&portrait=0`
  return (
    <div className="aspect-[16/9] w-full overflow-hidden rounded-lg bg-black">
      <iframe
        src={src}
        title={title}
        loading="lazy"
        allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture; web-share"
        allowFullScreen
        className="h-full w-full"
      />
    </div>
  )
}
