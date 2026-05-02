import { Skeleton } from "@/components/ui/skeleton"
import { TableCell, TableRow } from "@/components/ui/table"

type Variant = "hero" | "lead" | "secondary" | "list" | "compact"

export function StoryCardSkeleton({
  variant = "secondary",
  showImage = true,
}: {
  variant?: Variant
  showImage?: boolean
}) {
  const isList = variant === "list"
  const isHero = variant === "hero"
  return (
    <div
      className={
        isList
          ? "flex flex-row gap-3 border-b py-3 last:border-b-0"
          : "flex flex-col gap-3"
      }
    >
      {showImage ? (
        <Skeleton
          className={
            isList
              ? "h-20 w-28 shrink-0 rounded"
              : isHero
                ? "aspect-[16/9] w-full"
                : "aspect-[16/10] w-full"
          }
        />
      ) : null}
      <div
        className={
          isList ? "flex min-w-0 flex-1 flex-col gap-1.5" : "flex flex-col gap-2"
        }
      >
        <Skeleton className="h-3 w-20" />
        <Skeleton className={isHero ? "h-10 w-11/12" : "h-6 w-11/12"} />
        <Skeleton className={isHero ? "h-10 w-3/4" : "h-6 w-3/4"} />
        <Skeleton className="h-3 w-32" />
      </div>
    </div>
  )
}

export function StoryCardSkeletonGrid({
  count = 6,
  variant = "secondary",
}: {
  count?: number
  variant?: Variant
}) {
  return (
    <div className="grid gap-x-8 gap-y-8 md:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <StoryCardSkeleton key={i} variant={variant} />
      ))}
    </div>
  )
}

export function TableRowSkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <ul className="divide-y border-t border-b">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-center gap-4 py-3">
          <Skeleton className="h-12 w-16 shrink-0 rounded" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </li>
      ))}
    </ul>
  )
}

// Skeleton rows for use inside <Table><TableBody>...</TableBody></Table>.
// Keeps the same column structure so the layout doesn't shift on data load.
export function TableLoadingRows({
  rows = 5,
  cols = 4,
}: {
  rows?: number
  cols?: number
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: cols }).map((_, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 w-full max-w-[18rem]" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  )
}
