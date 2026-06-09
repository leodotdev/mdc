import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useConvex } from "convex/react"
import { useState } from "react"

import { api } from "../../../convex/_generated/api"
import { Button } from "@/components/ui/button"

// /admin/settings — site-wide toggles and caps. Single page for the
// short list of operational knobs: LLM on/off (Lights Out), ads
// on/off, daily LLM spend cap. Every setting persists in the
// siteSettings singleton and propagates via Convex's reactive
// subscriptions — no redeploy needed.

export const Route = createFileRoute("/_admin/admin/settings")({
  component: SettingsPage,
})

function SettingsPage() {
  const settings = useQuery(convexQuery(api.siteSettings.get, {}))
  return (
    <div className="flex flex-col gap-8 max-w-2xl">
      <header>
        <h1 className="font-sans text-3xl font-semibold tracking-[-0.02em]">
          Settings
        </h1>
        <p className="meta mt-1 text-sm">
          Site-wide toggles. Changes apply instantly across every page and
          every cron tick.
        </p>
      </header>
      {settings.data === undefined ? (
        <p className="meta text-sm">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <LightsOutCard llmEnabled={settings.data.llmEnabled} />
          <AdsCard adsEnabled={settings.data.adsEnabled} />
          <BudgetCard dailyBudgetCents={settings.data.dailyBudgetCents} />
        </div>
      )}
    </div>
  )
}

function LightsOutCard({ llmEnabled }: { llmEnabled: boolean }) {
  const convex = useConvex()
  const queryClient = useQueryClient()
  const refetch = () =>
    queryClient.invalidateQueries({
      queryKey: convexQuery(api.siteSettings.get, {}).queryKey,
    })
  const toggle = useMutation({
    mutationFn: async (enabled: boolean) =>
      await convex.mutation(api.siteSettings.setLlmEnabled, { enabled }),
    onSuccess: refetch,
  })
  return (
    <SettingCard
      title="LLM (AI) calls"
      sub={
        llmEnabled
          ? "On — adapters, enrichment, translation and feeders use Haiku as designed."
          : "Lights Out — every LLM call short-circuits. Site keeps running on deterministic adapters (ICS / JSON-LD / sitemap / SeatGeek / Ticketmaster) only."
      }
      status={llmEnabled ? "On" : "Lights Out"}
      statusTone={llmEnabled ? "ok" : "warn"}
    >
      <Button
        size="sm"
        variant={llmEnabled ? "destructive" : "default"}
        disabled={toggle.isPending}
        onClick={() => toggle.mutate(!llmEnabled)}
      >
        {llmEnabled ? "Turn off LLM" : "Turn on LLM"}
      </Button>
    </SettingCard>
  )
}

function AdsCard({ adsEnabled }: { adsEnabled: boolean }) {
  const convex = useConvex()
  const queryClient = useQueryClient()
  const refetch = () =>
    queryClient.invalidateQueries({
      queryKey: convexQuery(api.siteSettings.get, {}).queryKey,
    })
  const toggle = useMutation({
    mutationFn: async (enabled: boolean) =>
      await convex.mutation(api.siteSettings.setAdsEnabled, { enabled }),
    onSuccess: refetch,
  })
  return (
    <SettingCard
      title="Ads"
      sub={
        adsEnabled
          ? "On — BannerAd placeholders + AdSense blocks render."
          : "Off — every ad slot hides across the public site."
      }
      status={adsEnabled ? "On" : "Off"}
      statusTone={adsEnabled ? "ok" : "muted"}
    >
      <Button
        size="sm"
        variant="outline"
        disabled={toggle.isPending}
        onClick={() => toggle.mutate(!adsEnabled)}
      >
        {adsEnabled ? "Hide ads" : "Show ads"}
      </Button>
    </SettingCard>
  )
}

function BudgetCard({
  dailyBudgetCents,
}: {
  dailyBudgetCents: number
}) {
  const convex = useConvex()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(
    (dailyBudgetCents / 100).toFixed(2),
  )
  const save = useMutation({
    mutationFn: async (dollars: number) =>
      await convex.mutation(api.siteSettings.setDailyBudgetCents, {
        cents: Math.round(dollars * 100),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: convexQuery(api.siteSettings.get, {}).queryKey,
      }),
  })
  const valid =
    !Number.isNaN(Number(draft)) && Number(draft) >= 0.5 && Number(draft) <= 50
  return (
    <SettingCard
      title="Daily LLM spend cap"
      sub={`Hard cap on Anthropic spend per day. When hit, every adapter / enrichment / translation skips silently and the site keeps running on what's already deterministic. Allowed range: $0.50 — $50.00.`}
      status={`$${(dailyBudgetCents / 100).toFixed(2)} / day`}
      statusTone="ok"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          save.mutate(Number(draft))
        }}
        className="flex items-center gap-2"
      >
        <span className="meta text-sm">$</span>
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-24 rounded-md border bg-background px-2 py-1 text-sm"
        />
        <Button
          size="sm"
          type="submit"
          disabled={!valid || save.isPending}
        >
          Save
        </Button>
      </form>
    </SettingCard>
  )
}

function SettingCard({
  title,
  sub,
  status,
  statusTone,
  children,
}: {
  title: string
  sub: string
  status: string
  statusTone: "ok" | "warn" | "muted"
  children: React.ReactNode
}) {
  const tone =
    statusTone === "ok"
      ? "text-emerald-600"
      : statusTone === "warn"
        ? "text-amber-600"
        : "text-muted-foreground"
  return (
    <section className="rounded-md border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-sans text-base font-semibold">{title}</h2>
        <span className={`text-sm tabular-nums ${tone}`}>{status}</span>
      </div>
      <p className="meta mt-1 text-sm leading-snug">{sub}</p>
      <div className="mt-3">{children}</div>
    </section>
  )
}
