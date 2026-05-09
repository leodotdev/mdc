import { internalQuery } from "../_generated/server"
import { isEditor } from "./guard"

// Internal query used by `requireEditorInAction` to check editor
// status from an action context (which can't access ctx.db directly).
// Returns a plain boolean so the caller can throw with the message
// it wants. Internal-only — callers must already be inside the
// Convex sandbox.
export const checkEditor = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await isEditor(ctx)
  },
})
