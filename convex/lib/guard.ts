import { getAuthUserId } from "@convex-dev/auth/server"
import { internal } from "../_generated/api"
import type {
  ActionCtx,
  MutationCtx,
  QueryCtx,
} from "../_generated/server"

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

// Action-context variant — actions can't `ctx.db.query` directly, so
// we delegate to an internal query that performs the same check. Use
// this on any public action that should be editor-only (mega-desk
// runner, manual sweeps, anything that spends Anthropic credit).
export async function requireEditorInAction(ctx: ActionCtx): Promise<void> {
  const ok = await ctx.runQuery(internal.lib.guardData.checkEditor, {})
  if (!ok) throw new Error("Forbidden: editor access required")
}
