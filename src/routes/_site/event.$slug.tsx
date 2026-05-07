import { convexQuery } from "@convex-dev/react-query"
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, notFound } from "@tanstack/react-router"
import { useEffect } from "react"

import { api } from "../../../convex/_generated/api"
import { EventLayout } from "@/components/editorial/event-layout"
import { BannerAd } from "@/components/site/banner-ad"
import { convexSuspenseQuery } from "@/lib/convex-suspense"
import { useTranslation } from "@/lib/i18n/context"
import { localizedEvent } from "@/lib/localized-event"

export const Route = createFileRoute("/_site/event/$slug")({
  loader: async ({ context, params }) => {
    const event = await context.queryClient.ensureQueryData(
      convexQuery(api.events.getBySlug, { slug: params.slug }),
    )
    if (!event) throw notFound()
    if (event.section) {
      void context.queryClient.ensureQueryData(
        convexQuery(api.events.moreInSection, {
          sectionSlug: event.section.slug,
          excludeId: event._id,
          limit: 5,
        }),
      )
    }
    return { event }
  },
  head: ({ loaderData }) => {
    const e = loaderData?.event
    if (!e) return {}
    const heroImage = e.heroImage
    return {
      meta: [
        { title: `${e.title} · miami.community` },
        { name: "description", content: e.description },
        { property: "og:title", content: e.title },
        { property: "og:description", content: e.description },
        ...(heroImage ? [{ property: "og:image", content: heroImage }] : []),
        { property: "og:type", content: "event" },
      ],
    }
  },
  component: EventPage,
})

function EventPage() {
  const { slug } = Route.useParams()
  const { data: rawEvent } = useSuspenseQuery(
    convexSuspenseQuery(api.events.getBySlug, { slug }),
  )
  const { lang } = useTranslation()
  if (!rawEvent) return null

  // Patch tab title on lang change. The route's head() runs SSR-only with
  // the canonical EN title; this hook keeps the DOM in sync after a swap.
  const localized = localizedEvent(rawEvent, lang)
  useEffect(() => {
    if (typeof document === "undefined") return
    document.title = `${localized.title} · miami.community`
  }, [localized.title])

  return (
    <div className="flex flex-col gap-10">
      <BannerAd slot="event-mid" className="pt-2" />
      <EventLayout rawEvent={rawEvent} />
      <BannerAd slot="event-bottom" className="pt-6" />
    </div>
  )
}
