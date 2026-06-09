import { Link } from "@tanstack/react-router"

import { HeroCaption } from "./hero-caption"
import { EventCard } from "./event-card"
import type { EventWithRelations } from "@/lib/article-types"
import { HeroImg } from "@/components/site/hero-img"
import { useOpenEventDrawer } from "@/lib/use-open-article-drawer"

// Stacked "table" rows from the homepage's main column extracted as a
// reusable block. Each row is text 5 cols (left) + image 7 cols (right);
// rows are separated by a heavy `border-t border-foreground` rule that
// gives the page its newspaper grid cadence.
//
// Used by section / tag / author pages below the hero. Items without
// images render text-only across all 12 cols of their row.
export function XlRowList({
  events,
  showDek = true,
}: {
  events: Array<EventWithRelations>
  showDek?: boolean
}) {
  const openEventInDrawer = useOpenEventDrawer()
  return (
    <div className="flex flex-col">
      {events.map((a, i) => {
        const slug = a.slug ?? ""
        const linkProps = {
          to: "/event/$slug" as const,
          params: { slug },
          onClick: (e: React.MouseEvent) => openEventInDrawer(slug, e),
        } as const
        return (
          <div
            key={a._id}
            className={
              "grid grid-cols-1 gap-x-6 gap-y-4 pt-8 pb-8 md:grid-cols-12 " +
              (i > 0 ? "border-t border-foreground" : "")
            }
          >
            {a.heroImage ? (
              <>
                <Link
                  {...linkProps}
                  className="group/xl block self-start [contain:paint] md:col-span-7 md:col-start-6"
                >
                  <HeroImg
                    url={a.heroImage}
                    width={1000}
                    className="aspect-[3/2] w-full object-cover transition-transform duration-200 ease-out group-hover/xl:scale-[1.015]"
                  />
                  {a.heroCaption ? (
                    <figcaption className="mt-2">
                      <HeroCaption
                        caption={a.heroCaption}
                        citations={a.citations ?? []}
                      />
                    </figcaption>
                  ) : null}
                </Link>
                <div className="flex flex-col md:col-span-5 md:col-start-1 md:row-start-1">
                  <EventCard
                    event={a}
                    layout="text-only"
                    size="lead"
                    showDek={showDek}
                  />
                </div>
              </>
            ) : (
              <div className="md:col-span-12">
                <EventCard
                  event={a}
                  layout="text-only"
                  size="lead"
                  showDek={showDek}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
