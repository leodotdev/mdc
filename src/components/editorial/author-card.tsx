import type { ArticleAuthor } from "@/lib/article-types"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

export function AuthorCard({ author }: { author: ArticleAuthor }) {
  return (
    <div className="flex items-start gap-4">
      <Avatar className="size-14">
        {author.avatar ? <AvatarImage src={author.avatar} alt="" /> : null}
        <AvatarFallback className="font-heading text-base">
          {initials(author.name)}
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-2xl font-semibold leading-tight text-balance">
          {author.name}
        </h2>
        {author.title ? (
          <p className="meta text-sm">{author.title}</p>
        ) : null}
        <p className="font-editorial mt-2 max-w-prose text-base">
          {author.bio}
        </p>
      </div>
    </div>
  )
}
