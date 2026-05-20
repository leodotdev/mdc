/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentRuns from "../agentRuns.js";
import type * as agents from "../agents.js";
import type * as agentsData from "../agentsData.js";
import type * as articles from "../articles.js";
import type * as auth from "../auth.js";
import type * as authors from "../authors.js";
import type * as budget from "../budget.js";
import type * as cleanup from "../cleanup.js";
import type * as crons from "../crons.js";
import type * as dedup from "../dedup.js";
import type * as events from "../events.js";
import type * as http from "../http.js";
import type * as imageWatchdog from "../imageWatchdog.js";
import type * as lib_adapters_bluesky from "../lib/adapters/bluesky.js";
import type * as lib_adapters_eventsHtml from "../lib/adapters/eventsHtml.js";
import type * as lib_adapters_ics from "../lib/adapters/ics.js";
import type * as lib_adapters_index from "../lib/adapters/index.js";
import type * as lib_adapters_miamiNewTimes from "../lib/adapters/miamiNewTimes.js";
import type * as lib_adapters_reddit from "../lib/adapters/reddit.js";
import type * as lib_adapters_rss from "../lib/adapters/rss.js";
import type * as lib_adapters_sitemapEvents from "../lib/adapters/sitemapEvents.js";
import type * as lib_adapters_types from "../lib/adapters/types.js";
import type * as lib_adapters_web from "../lib/adapters/web.js";
import type * as lib_adapters_wikipediaOtd from "../lib/adapters/wikipediaOtd.js";
import type * as lib_adapters_x from "../lib/adapters/x.js";
import type * as lib_adapters_youtube from "../lib/adapters/youtube.js";
import type * as lib_audienceFilter from "../lib/audienceFilter.js";
import type * as lib_budget from "../lib/budget.js";
import type * as lib_cronGate from "../lib/cronGate.js";
import type * as lib_eventDedupe from "../lib/eventDedupe.js";
import type * as lib_firstSentence from "../lib/firstSentence.js";
import type * as lib_guard from "../lib/guard.js";
import type * as lib_guardData from "../lib/guardData.js";
import type * as lib_llm from "../lib/llm.js";
import type * as lib_media from "../lib/media.js";
import type * as lib_neighborhoods from "../lib/neighborhoods.js";
import type * as lib_priceExtract from "../lib/priceExtract.js";
import type * as lib_scoring from "../lib/scoring.js";
import type * as lib_storyArcs from "../lib/storyArcs.js";
import type * as me from "../me.js";
import type * as migrations from "../migrations.js";
import type * as sections from "../sections.js";
import type * as seed from "../seed.js";
import type * as siteSettings from "../siteSettings.js";
import type * as sourceHealth from "../sourceHealth.js";
import type * as sources from "../sources.js";
import type * as sourcesData from "../sourcesData.js";
import type * as systemAlerts from "../systemAlerts.js";
import type * as widgets from "../widgets.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentRuns: typeof agentRuns;
  agents: typeof agents;
  agentsData: typeof agentsData;
  articles: typeof articles;
  auth: typeof auth;
  authors: typeof authors;
  budget: typeof budget;
  cleanup: typeof cleanup;
  crons: typeof crons;
  dedup: typeof dedup;
  events: typeof events;
  http: typeof http;
  imageWatchdog: typeof imageWatchdog;
  "lib/adapters/bluesky": typeof lib_adapters_bluesky;
  "lib/adapters/eventsHtml": typeof lib_adapters_eventsHtml;
  "lib/adapters/ics": typeof lib_adapters_ics;
  "lib/adapters/index": typeof lib_adapters_index;
  "lib/adapters/miamiNewTimes": typeof lib_adapters_miamiNewTimes;
  "lib/adapters/reddit": typeof lib_adapters_reddit;
  "lib/adapters/rss": typeof lib_adapters_rss;
  "lib/adapters/sitemapEvents": typeof lib_adapters_sitemapEvents;
  "lib/adapters/types": typeof lib_adapters_types;
  "lib/adapters/web": typeof lib_adapters_web;
  "lib/adapters/wikipediaOtd": typeof lib_adapters_wikipediaOtd;
  "lib/adapters/x": typeof lib_adapters_x;
  "lib/adapters/youtube": typeof lib_adapters_youtube;
  "lib/audienceFilter": typeof lib_audienceFilter;
  "lib/budget": typeof lib_budget;
  "lib/cronGate": typeof lib_cronGate;
  "lib/eventDedupe": typeof lib_eventDedupe;
  "lib/firstSentence": typeof lib_firstSentence;
  "lib/guard": typeof lib_guard;
  "lib/guardData": typeof lib_guardData;
  "lib/llm": typeof lib_llm;
  "lib/media": typeof lib_media;
  "lib/neighborhoods": typeof lib_neighborhoods;
  "lib/priceExtract": typeof lib_priceExtract;
  "lib/scoring": typeof lib_scoring;
  "lib/storyArcs": typeof lib_storyArcs;
  me: typeof me;
  migrations: typeof migrations;
  sections: typeof sections;
  seed: typeof seed;
  siteSettings: typeof siteSettings;
  sourceHealth: typeof sourceHealth;
  sources: typeof sources;
  sourcesData: typeof sourcesData;
  systemAlerts: typeof systemAlerts;
  widgets: typeof widgets;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
