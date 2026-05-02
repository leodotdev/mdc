import { getAuthUserId } from "@convex-dev/auth/server"
import type { MutationCtx, QueryCtx } from "../_generated/server"

export async function requireEditor(
  ctx: QueryCtx | MutationCtx,
): Promise<string> {
  const userId = await getAuthUserId(ctx)
  if (!userId) throw new Error("Unauthenticated")
  const user = await ctx.db.get(userId)
  const email =
    user && typeof (user as { email?: unknown }).email === "string"
      ? ((user as { email: string }).email).toLowerCase()
      : null
  if (!email) throw new Error("Unauthenticated: no email on user")
  const editor = await ctx.db
    .query("editors")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique()
  if (!editor) throw new Error(`Forbidden: ${email} is not an editor`)
  return email
}

export async function isEditor(
  ctx: QueryCtx | MutationCtx,
): Promise<boolean> {
  try {
    await requireEditor(ctx)
    return true
  } catch {
    return false
  }
}
