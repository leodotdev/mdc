import type { ArticleWithRelations } from "@/lib/article-types"
import type { Lang } from "@/lib/i18n/strings"

// Swap an article's user-facing copy (title / dek / body / heroCaption)
// to the requested language's stored translation when available. Falls
// back to the EN original whenever the ES variant is missing — so a
// just-published story whose ES translation hasn't run yet still
// renders, instead of disappearing on the lang switch.
//
// Usage:
//   const { t } = useTranslation()
//   const a = localizedArticle(article, lang)
//   <h2>{a.title}</h2>
export function localizedArticle<T extends ArticleWithRelations>(
  article: T,
  lang: Lang,
): T {
  if (lang === "en") return article
  const tr = article.translations?.es
  if (!tr) return article
  return {
    ...article,
    title: tr.title,
    dek: tr.dek,
    body: tr.body,
    heroCaption: tr.heroCaption ?? article.heroCaption,
  }
}
