// Card types for the public site. Every card on the public site is
// an event — `EventWithRelations` is the hydrated row returned by
// `api.events.getBySlug` (title, dek, body, citations, section, etc.).
//
// File name kept as `article-types.ts` for now to avoid a 15-importer
// rename pass; it will be renamed to `event-types.ts` in a focused
// follow-up.

import type { FunctionReturnType } from "convex/server"
import type { api } from "../../convex/_generated/api"

export type EventWithRelations = NonNullable<
  FunctionReturnType<typeof api.events.getBySlug>
>

export type Section = EventWithRelations["section"]
export type Citation = NonNullable<EventWithRelations["citations"]>[number]
