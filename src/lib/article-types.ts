import type { FunctionReturnType } from "convex/server"
import type { api } from "../../convex/_generated/api"

export type ArticleWithRelations = NonNullable<
  FunctionReturnType<typeof api.articles.getBySlug>
>

export type Section = ArticleWithRelations["section"]
export type ArticleAuthor = ArticleWithRelations["authors"][number]
export type Citation = ArticleWithRelations["citations"][number]
