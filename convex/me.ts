import { getAuthUserId } from "@convex-dev/auth/server"
import { query } from "./_generated/server"

export const current = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    const user = await ctx.db.get(userId)
    if (!user) return null
    const email =
      typeof (user as { email?: unknown }).email === "string"
        ? ((user as { email: string }).email).toLowerCase()
        : null
    if (!email) return { userId, email: null, isEditor: false }
    const editor = await ctx.db
      .query("editors")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique()
    return { userId, email, isEditor: editor !== null, role: editor?.role }
  },
})
