import { convexQuery } from "@convex-dev/react-query"
import type { UseSuspenseQueryOptions } from "@tanstack/react-query"
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server"

// `convexQuery`'s return type is a distributing conditional over `args | "skip"`,
// so when args is a real object TS still produces the union `UseQueryOptions |
// UseSuspenseQueryOptions`. `useSuspenseQuery` rejects the wider variant. This
// helper narrows it for the always-runs case.
type SuspenseOpts<T> = Pick<
  UseSuspenseQueryOptions<T, Error, T, ReadonlyArray<unknown>>,
  "queryKey" | "queryFn" | "staleTime"
>

export function convexSuspenseQuery<TQuery extends FunctionReference<"query">>(
  ref: TQuery,
  args: FunctionArgs<TQuery>,
): SuspenseOpts<FunctionReturnType<TQuery>> {
  return convexQuery(ref, args) as unknown as SuspenseOpts<
    FunctionReturnType<TQuery>
  >
}
