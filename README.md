# miami.community

A modern AI-orchestrated local newspaper for Miami. Public site + editor CMS + AI desk agents.

- Frontend: TanStack Start (React 19, file-based routing, SSR)
- Backend: Convex (data, actions, auth)
- Hosting: Cloudflare Workers via `@cloudflare/vite-plugin`
- LLM: Anthropic Claude (Sonnet 4.6 default)
- UI: shadcn/ui + Tailwind v4

## First-time setup

### 1. Provision Convex

In a separate terminal, run and **leave running**:

```bash
npx convex dev
```

This logs into Convex (browser flow), creates a deployment, generates `convex/_generated/` types, and writes `VITE_CONVEX_URL` into `.env.local`. The terminal keeps watching `convex/` and pushing changes — keep it open while you work.

### 2. Set Convex env vars

These are server-only secrets used inside Convex actions. Set them once:

```bash
# Required for AI drafting
npx convex env set ANTHROPIC_API_KEY  sk-ant-...

# Required for magic-link sign-in (Resend free tier is fine)
npx convex env set AUTH_RESEND_KEY    re_...
npx convex env set AUTH_RESEND_FROM   "miami.community <onboarding@resend.dev>"

# Required for image fallback
npx convex env set UNSPLASH_ACCESS_KEY  ...

# Required only if you add YouTube sources
npx convex env set YOUTUBE_API_KEY  ...

# Used by Convex Auth for magic-link redirects
npx convex env set SITE_URL  http://localhost:3000
```

Convex Auth also needs JWT keys. Run once:

```bash
npx @convex-dev/auth
```

This generates `JWT_PRIVATE_KEY` and `JWKS` and pushes them to your Convex env.

### 3. Seed the database

Once `convex dev` has pushed the schema (you'll see "schema written" in its output), seed it:

```bash
npx convex run seed:run
```

This inserts the section taxonomy (News, Politics, Business, Sports, Food, Arts, Music, Things to Do, Opinion, Investigations, Miami History), two AI desks (Arts & Culture, Sports), starter sources (r/Miami, r/SouthFlorida, plus a handful of disabled-by-default RSS / YouTube / X examples), and adds **`leo@leo.dev` to the editor allowlist**. Edit `convex/seed.ts` if you need a different super-user email.

### 4. Run the app

```bash
pnpm dev
```

→ http://localhost:3000

## Daily flow

1. **`/admin/login`** — enter your email, click the magic link in your inbox, you're in.
2. **`/admin/sources`** — add or enable the sources you want today's desks to read. Hit **Test fetch** on a source to confirm it works and pull recent items into the queue.
3. **`/admin/agents`** — hit **Run desk** on a desk. The agent fetches its sources, calls Claude, and lands drafts in the review queue.
4. **`/admin/queue`** — review each draft. Edit headline / dek / body / hero. **Publish** to send it live, **Reject** to discard.
5. Published stories appear at `/`, in their section front, and on the agent persona's author page.

## Deploy to Cloudflare

```bash
# Push final Convex changes (or use convex dev --once)
npx convex deploy

# Build + deploy the Worker
pnpm deploy
```

Set the production `VITE_CONVEX_URL` (the prod deployment URL from `npx convex deploy`) as a CI/CD env var before `pnpm deploy`. Convex env vars set via `npx convex env set` apply to the prod deployment automatically.

## Source types

| Type      | What you provide                              | Notes |
|-----------|-----------------------------------------------|-------|
| `rss`     | Feed URL                                      | Atom + RSS 2.0 supported |
| `reddit`  | Subreddit name (e.g. `Miami`)                 | Public JSON, no auth |
| `youtube` | `@handle`, `UCxxx` channel id, or `PL...` playlist id | Needs `YOUTUBE_API_KEY` |
| `x`       | X handle (e.g. `MiamiHerald`)                 | Best-effort via RSSHub; fragile |
| `web`     | Any URL                                        | One-shot fetch + LLM extraction |

## Architecture quick map

- `convex/schema.ts` — sections, articles, authors, sources, ingestedItems, agents, agentRuns, editors
- `convex/agents.ts` — `runDesk` orchestrator (fetch → dedupe → Claude → drafts)
- `convex/lib/adapters/` — pluggable per-source fetchers
- `convex/lib/llm.ts` — Anthropic SDK wrapper, JSON tool-output validation
- `convex/lib/media.ts` — OG image → Unsplash → text-only fallback
- `convex/auth.ts` — Convex Auth magic-link via Resend
- `src/routes/_site/` — public site (home, section, article, author, about)
- `src/routes/_admin/` — gated CMS (queue, sources, agents)
- `src/routes/admin.login.tsx` — sign-in page

## Things AI desks must do, and must not do

- Must cite ≥ 1 source per article, surfaced in the **Sources** block on every story page.
- Must summarize and synthesize, never reproduce source text verbatim.
- Must not invent quotes, statistics, names, or events.
- Must surface the "AI desk" label on every byline so readers can calibrate.
