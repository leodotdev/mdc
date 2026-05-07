import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { api } from "../../../convex/_generated/api"
import { MetricCard } from "@/components/widgets/metric-card"

// `[[metric:slug]]` token regex — matches anywhere on a line. The mega
// desk drops these into article bodies when a current metric is
// relevant; we replace each one with a rendered <MetricCard inline>.
const METRIC_TOKEN_RE = /\[\[metric:([a-z0-9-]{1,80})\]\]/gi

export function ArticleBody({ markdown }: { markdown: string }) {
  // Split the body on metric tokens, preserving order. Even-indexed
  // chunks are markdown text; odd-indexed chunks are metric slugs.
  const chunks = splitOnMetricTokens(markdown)

  return (
    <div className="prose-editorial mx-auto">
      {chunks.map((chunk, i) =>
        chunk.kind === "markdown" ? (
          <ReactMarkdown
            key={i}
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children, ...rest }) => (
                <a
                  href={href}
                  target={href?.startsWith("http") ? "_blank" : undefined}
                  rel={
                    href?.startsWith("http") ? "noopener noreferrer" : undefined
                  }
                  {...rest}
                >
                  {children}
                </a>
              ),
            }}
          >
            {chunk.text}
          </ReactMarkdown>
        ) : (
          <MetricInline key={i} slug={chunk.slug} />
        ),
      )}
    </div>
  )
}

type Chunk =
  | { kind: "markdown"; text: string }
  | { kind: "metric"; slug: string }

function splitOnMetricTokens(markdown: string): Array<Chunk> {
  const out: Array<Chunk> = []
  let lastIndex = 0
  for (const match of markdown.matchAll(METRIC_TOKEN_RE)) {
    const idx = match.index ?? 0
    if (idx > lastIndex) {
      out.push({ kind: "markdown", text: markdown.slice(lastIndex, idx) })
    }
    out.push({ kind: "metric", slug: match[1].toLowerCase() })
    lastIndex = idx + match[0].length
  }
  if (lastIndex < markdown.length) {
    out.push({ kind: "markdown", text: markdown.slice(lastIndex) })
  }
  if (out.length === 0) {
    out.push({ kind: "markdown", text: markdown })
  }
  return out
}

// Inline metric — looks up the metric by slug and renders a bordered
// callout. When the slug doesn't resolve (e.g. typo, deleted metric),
// renders nothing rather than a broken token. The MetricCard itself
// is the "inline" variant — slightly tighter than the homepage tile,
// with full-width breakout from the prose column on wider viewports.
function MetricInline({ slug }: { slug: string }) {
  const { data: metric } = useQuery(
    convexQuery(api.metrics.getBySlug, { slug }),
  )
  if (!metric) return null
  return (
    <aside className="not-prose my-6 mx-auto max-w-[680px]">
      <MetricCard metric={metric} variant="inline" />
    </aside>
  )
}
