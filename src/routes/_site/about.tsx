import { createFileRoute } from "@tanstack/react-router"

import { PageHeader } from "@/components/editorial/page-header"
import { BannerAd } from "@/components/site/banner-ad"

export const Route = createFileRoute("/_site/about")({
  head: () => ({
    meta: [{ title: "About · miami.community" }],
  }),
  component: AboutPage,
})

const TOC = [
  { id: "newsroom", label: "The newsroom" },
  { id: "sourcing", label: "Sourcing & transparency" },
  { id: "why", label: "Why we're here" },
  { id: "contact", label: "Contact" },
]

function AboutPage() {
  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        kicker="About"
        title="miami.community"
        dek="A local newspaper for Miami-Dade — news, politics, business, sports, food, arts, music, and the things that make Miami Miami. AI-drafted from cited sources, edited by a human."
      />

      <article className="mx-auto max-w-3xl">
        <nav
          aria-label="On this page"
          className="flex flex-wrap gap-x-4 gap-y-1.5 border-y py-3"
        >
          <span className="kicker text-muted-foreground">On this page</span>
          {TOC.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className="meta text-sm text-foreground hover:underline"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="prose-editorial mt-10">
          <p>
            miami.community is a local newspaper covering Miami-Dade. Each
            day a small set of AI desks reads the city's existing reporting,
            drafts short pieces, and submits them to the editor in chief for
            review. What lands here is shorter, snappier, and clearer than
            the wire copy that fed it.
          </p>

          <h2 id="newsroom" className="scroll-mt-20">
            The newsroom
          </h2>
          <p>
            Our newsroom is run by a single editor in chief working alongside
            a set of AI desks. Each desk — News, Politics, Business, Real
            Estate, Climate, Sports, Food, Arts &amp; Culture, Music,
            Investigations, This Day in Miami History, Opinion, and Events —
            scours the city's local newspapers, public radio stations, blogs,
            civic feeds, and social media for stories worth telling, drafts
            short pieces, and submits them for review.
          </p>

          <h2 id="sourcing" className="scroll-mt-20">
            Sourcing &amp; transparency
          </h2>
          <p>
            Every article in miami.community is drafted by an AI desk from
            cited sources, then reviewed and edited by a human editor before
            it is published. You'll find a <strong>Sources</strong> deck at
            the bottom of each story listing every source the desk
            consulted, with links and fetch dates so you can verify the
            reporting yourself. We don't fabricate quotes, statistics,
            names, or events. If a story stretches beyond what the cited
            sources support, it doesn't run.
          </p>
          <p>
            Articles labeled "Investigations" are cross-source synthesis
            pieces — they connect coverage from multiple outlets to provide a
            fuller picture, but they are not original reporting. We say so
            plainly so readers can calibrate.
          </p>

          <BannerAd slot="about-mid" className="my-10" />

          <h2 id="why" className="scroll-mt-20">
            Why we're here
          </h2>
          <p>
            Local news has been hollowed out across the country, and Miami's
            no exception. We can't replace shoe-leather reporting — but we
            can pull the city's existing coverage into one place, make it
            easy to scan, and keep readers connected to the institutions
            still doing the work. When we link out, we're sending readers to
            the publishers who did the original reporting.
          </p>

          <h2 id="contact" className="scroll-mt-20">
            Contact
          </h2>
          <p>
            Tips, corrections, partnerships:{" "}
            <a href="mailto:tips@miami.community">tips@miami.community</a>.
          </p>
        </div>
      </article>

      <BannerAd slot="about-bottom" className="pt-6" />
    </div>
  )
}
