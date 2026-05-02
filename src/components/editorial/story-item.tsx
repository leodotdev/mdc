import { Link, useNavigate } from "@tanstack/react-router"
import { cva } from "class-variance-authority"

import { SectionBadge } from "./section-badge"
import type { VariantProps } from "class-variance-authority"
import type { ArticleWithRelations } from "@/lib/article-types"
import { useTranslation } from "@/lib/i18n/context"
import { proxiedImageUrl } from "@/lib/image-proxy"
import { localizedArticle } from "@/lib/localized-article"
import { cn } from "@/lib/utils"

// Single editorial card. Replaces WapoStoryItem, StoryCard, GridStoryCard,
// and HeroStory. Behavior is driven by `layout` and `size`:
//
//   layout      — image placement / framing
//   size        — typographic scale of the headline + dek
//   showKicker  — section badge above the headline (default true)
//   showDek     — defaults true for hero/feature/lead, false otherwise
//   imageAspect — image-top + framed only; ignored otherwise
//   customKicker — overrides the section badge with a custom label/color
//
// Click behavior: cmd/ctrl/shift + click navigates to the full article
// page; plain left-click opens the article drawer via the `?article=slug`
// search param so the user stays in flow.

// Headline size scale used by every layout. Picks up the section accent
// on hover via `group-hover/item:text-primary`.
const titleVariants = cva(
  "font-heading font-semibold leading-[1.05] text-balance transition-colors group-hover/item:text-primary",
  {
    variants: {
      size: {
        hero: "text-4xl tracking-[-0.03em] md:text-6xl md:leading-[1]",
        feature: "text-3xl tracking-[-0.025em] md:text-[2.625rem] md:leading-[1]",
        lead: "text-2xl tracking-[-0.02em] md:text-3xl",
        default: "text-xl tracking-[-0.015em] md:text-2xl",
        compact: "text-base tracking-[-0.01em] md:text-lg",
        sm: "text-base tracking-[-0.01em]",
      },
    },
    defaultVariants: { size: "default" },
  },
)

// Deks are deliberately uniform across every layout — 16px / `text-base`.
// They're a supporting line under the headline, not a competing one,
// and a single size keeps the page rhythm clean regardless of which
// card variant is rendering.
const dekSizeFor: Record<NonNullable<StoryItemSize>, string> = {
  hero: "text-base",
  feature: "text-base",
  lead: "text-base",
  default: "text-base",
  compact: "text-base",
  sm: "text-base",
}

type StoryItemLayout =
  | "image-top"
  | "image-side"
  | "side-thumb"
  | "text-only"
  | "framed"
  | "hero"

type StoryItemSize = VariantProps<typeof titleVariants>["size"]

type StoryItemProps = {
  article: ArticleWithRelations
  layout?: StoryItemLayout
  size?: StoryItemSize
  showKicker?: boolean
  showDek?: boolean
  /** Force-hide the hero image even when the article has one. Defaults
   *  true when there's an image. Useful for framed-cell grids where some
   *  cells render text-only by design (e.g. long-tail rows). */
  showImage?: boolean
  imageAspect?: "16/10" | "16/9" | "4/3" | "1/1"
  /** Override the section kicker — e.g. an "EXCLUSIVE" or "BREAKING" label. */
  customKicker?: { text: string; color?: string }
  className?: string
}

const aspectClass = {
  "16/10": "aspect-[16/10]",
  "16/9": "aspect-[16/9]",
  "4/3": "aspect-[4/3]",
  "1/1": "aspect-square",
} as const

function useOpenInDrawer() {
  const navigate = useNavigate()
  return (slug: string, e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    void navigate({
      search: ((prev: Record<string, unknown>) => ({
        ...prev,
        article: slug,
      })) as never,
    })
  }
}

export function StoryItem({
  article: rawArticle,
  layout = "image-top",
  size = "default",
  showKicker = true,
  showDek,
  showImage = true,
  imageAspect = "16/10",
  customKicker,
  className,
}: StoryItemProps) {
  const { lang } = useTranslation()
  const article = localizedArticle(rawArticle, lang)
  const sizeKey = (size ?? "default") as NonNullable<StoryItemSize>
  // Dek defaults: shown for the larger sizes, hidden for the small ones.
  // Callers can force either way with `showDek`.
  const dekVisible =
    showDek ?? (sizeKey === "hero" || sizeKey === "feature" || sizeKey === "lead")
  const hasImage =
    showImage && !!article.heroImage && layout !== "text-only"
  const openInDrawer = useOpenInDrawer()
  const linkProps = {
    to: "/article/$slug" as const,
    params: { slug: article.slug },
    onClick: (e: React.MouseEvent) => openInDrawer(article.slug, e),
  }

  const KickerNode = customKicker ? (
    <span
      className="kicker inline-flex items-center gap-1.5 text-[0.7rem]"
      style={{ color: customKicker.color ?? "var(--destructive)" }}
    >
      <span
        aria-hidden
        className="size-1 rounded-full"
        style={{ background: customKicker.color ?? "var(--destructive)" }}
      />
      {customKicker.text}
    </span>
  ) : showKicker ? (
    <SectionBadge
      section={article.section}
      size={
        sizeKey === "hero" || sizeKey === "feature" ? "md" : "sm"
      }
    />
  ) : null

  const Headline = (
    <Link {...linkProps}>
      <h3 className={titleVariants({ size })}>{article.title}</h3>
    </Link>
  )

  const Dek =
    dekVisible && article.dek ? (
      <p
        className={cn(
          "font-sans font-normal text-muted-foreground",
          dekSizeFor[sizeKey],
        )}
      >
        {article.dek}
      </p>
    ) : null

  const Body = (
    <div className="flex flex-col gap-1.5">
      {KickerNode}
      {Headline}
      {Dek}
    </div>
  )

  // Image elements vary slightly by layout (aspect, hover scale anchor).
  const ImageTop = hasImage ? (
    <Link
      {...linkProps}
      className="block overflow-hidden rounded-[4px]"
      tabIndex={-1}
    >
      <img
        src={proxiedImageUrl(article.heroImage, { width: 800 })}
        alt=""
        loading="lazy"
        className={cn(
          aspectClass[imageAspect],
          "w-full object-cover transition-transform duration-200 ease-out group-hover/item:scale-[1.015]",
        )}
      />
    </Link>
  ) : null

  const ImageSide = hasImage ? (
    <Link
      {...linkProps}
      className="block self-start overflow-hidden rounded-[4px]"
      tabIndex={-1}
    >
      <img
        src={proxiedImageUrl(article.heroImage, { width: 800 })}
        alt=""
        loading="lazy"
        className="aspect-[3/2] w-full object-cover transition-transform duration-200 ease-out group-hover/item:scale-[1.01]"
      />
    </Link>
  ) : null

  const ImageThumb = hasImage ? (
    <Link
      {...linkProps}
      className="block aspect-square h-20 w-28 shrink-0 overflow-hidden rounded-[4px]"
      tabIndex={-1}
    >
      <img
        src={proxiedImageUrl(article.heroImage, { width: 240 })}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover transition-transform duration-200 ease-out group-hover/item:scale-[1.015]"
      />
    </Link>
  ) : null

  // -------- layout switch --------
  if (layout === "framed") {
    // Bordered cell — designed to live inside a grid that's also bordered
    // so adjacent cells' edges touch and form a newspaper grid.
    return (
      <article
        className={cn(
          "group/item flex h-full flex-col border-r border-b border-foreground bg-card transition-colors duration-150 hover:bg-muted/40",
          className,
        )}
      >
        {hasImage ? (
          <Link
            {...linkProps}
            className="block overflow-hidden rounded-t-[4px] border-b border-foreground"
            aria-hidden="true"
            tabIndex={-1}
          >
            <img
              src={proxiedImageUrl(article.heroImage, { width: 800 })}
              alt=""
              loading="lazy"
              className={cn(
                aspectClass[imageAspect],
                "w-full object-cover transition-transform duration-200 ease-out group-hover/item:scale-[1.015]",
              )}
            />
          </Link>
        ) : null}
        <div className="flex flex-1 flex-col gap-2 p-5">
          {KickerNode}
          {Headline}
          {Dek}
        </div>
      </article>
    )
  }

  if (layout === "hero") {
    // Banner-scale story. When there's no image we fall back to a
    // newspaper-style left rule so the title still has weight on the page.
    return (
      <article className={cn("group/item", className)}>
        {hasImage ? (
          <Link
            {...linkProps}
            className="block overflow-hidden rounded-[4px]"
            tabIndex={-1}
          >
            <img
              src={proxiedImageUrl(article.heroImage, { width: 1200 })}
              alt={article.heroCaption ?? ""}
              loading="eager"
              className="aspect-[16/9] w-full object-cover transition-transform duration-200 ease-out group-hover/item:scale-[1.01]"
            />
          </Link>
        ) : null}
        <div
          className={cn(
            "flex flex-col gap-3",
            hasImage
              ? "mt-5"
              : "border-l-4 border-foreground pl-5 md:pl-6",
          )}
        >
          {KickerNode}
          {Headline}
          {article.dek ? (
            <p className="font-sans text-base font-normal text-muted-foreground">
              {article.dek}
            </p>
          ) : null}
        </div>
      </article>
    )
  }

  if (layout === "image-top") {
    return (
      <article className={cn("group/item flex flex-col gap-3", className)}>
        {ImageTop}
        {Body}
      </article>
    )
  }

  if (layout === "image-side") {
    return (
      <article
        className={cn(
          "group/item grid gap-x-6 gap-y-3 md:grid-cols-2",
          className,
        )}
      >
        {ImageSide}
        <div className="flex flex-col justify-center">{Body}</div>
      </article>
    )
  }

  if (layout === "side-thumb") {
    return (
      <article className={cn("group/item flex gap-4", className)}>
        <div className="min-w-0 flex-1">{Body}</div>
        {ImageThumb}
      </article>
    )
  }

  // text-only
  return (
    <article className={cn("group/item flex flex-col", className)}>
      {Body}
    </article>
  )
}
