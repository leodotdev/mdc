/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activity from "../activity.js";
import type * as adminOps from "../adminOps.js";
import type * as agentRuns from "../agentRuns.js";
import type * as agents from "../agents.js";
import type * as agentsData from "../agentsData.js";
import type * as auth from "../auth.js";
import type * as authors from "../authors.js";
import type * as budget from "../budget.js";
import type * as cleanup from "../cleanup.js";
import type * as coverage from "../coverage.js";
import type * as crons from "../crons.js";
import type * as discovery from "../discovery.js";
import type * as events from "../events.js";
import type * as feeders from "../feeders.js";
import type * as http from "../http.js";
import type * as imageWatchdog from "../imageWatchdog.js";
import type * as lib_adapters_browserExtract from "../lib/adapters/browserExtract.js";
import type * as lib_adapters_eventsHtml from "../lib/adapters/eventsHtml.js";
import type * as lib_adapters_ics from "../lib/adapters/ics.js";
import type * as lib_adapters_index from "../lib/adapters/index.js";
import type * as lib_adapters_llmExtract from "../lib/adapters/llmExtract.js";
import type * as lib_adapters_miamiNewTimes from "../lib/adapters/miamiNewTimes.js";
import type * as lib_adapters_sitemapEvents from "../lib/adapters/sitemapEvents.js";
import type * as lib_adapters_types from "../lib/adapters/types.js";
import type * as lib_audienceFilter from "../lib/audienceFilter.js";
import type * as lib_budget from "../lib/budget.js";
import type * as lib_classify from "../lib/classify.js";
import type * as lib_cronGate from "../lib/cronGate.js";
import type * as lib_effectiveStartsAt from "../lib/effectiveStartsAt.js";
import type * as lib_eventDedupe from "../lib/eventDedupe.js";
import type * as lib_extract from "../lib/extract.js";
import type * as lib_firstSentence from "../lib/firstSentence.js";
import type * as lib_geocode from "../lib/geocode.js";
import type * as lib_guard from "../lib/guard.js";
import type * as lib_guardData from "../lib/guardData.js";
import type * as lib_hydrationHelpers from "../lib/hydrationHelpers.js";
import type * as lib_llm from "../lib/llm.js";
import type * as lib_media from "../lib/media.js";
import type * as lib_neighborhoods from "../lib/neighborhoods.js";
import type * as lib_priceExtract from "../lib/priceExtract.js";
import type * as lib_quality from "../lib/quality.js";
import type * as lib_rrule from "../lib/rrule.js";
import type * as lib_scoring from "../lib/scoring.js";
import type * as lib_sourceProbe from "../lib/sourceProbe.js";
import type * as lib_titleCase from "../lib/titleCase.js";
import type * as me from "../me.js";
import type * as migrations from "../migrations.js";
import type * as popularity from "../popularity.js";
import type * as recurrence from "../recurrence.js";
import type * as sections from "../sections.js";
import type * as seed from "../seed.js";
import type * as siteSettings from "../siteSettings.js";
import type * as sourceHealth from "../sourceHealth.js";
import type * as sources from "../sources.js";
import type * as sourcesData from "../sourcesData.js";
import type * as systemAlerts from "../systemAlerts.js";
import type * as taxonomy from "../taxonomy.js";
import type * as widgets from "../widgets.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  adminOps: typeof adminOps;
  agentRuns: typeof agentRuns;
  agents: typeof agents;
  agentsData: typeof agentsData;
  auth: typeof auth;
  authors: typeof authors;
  budget: typeof budget;
  cleanup: typeof cleanup;
  coverage: typeof coverage;
  crons: typeof crons;
  discovery: typeof discovery;
  events: typeof events;
  feeders: typeof feeders;
  http: typeof http;
  imageWatchdog: typeof imageWatchdog;
  "lib/adapters/browserExtract": typeof lib_adapters_browserExtract;
  "lib/adapters/eventsHtml": typeof lib_adapters_eventsHtml;
  "lib/adapters/ics": typeof lib_adapters_ics;
  "lib/adapters/index": typeof lib_adapters_index;
  "lib/adapters/llmExtract": typeof lib_adapters_llmExtract;
  "lib/adapters/miamiNewTimes": typeof lib_adapters_miamiNewTimes;
  "lib/adapters/sitemapEvents": typeof lib_adapters_sitemapEvents;
  "lib/adapters/types": typeof lib_adapters_types;
  "lib/audienceFilter": typeof lib_audienceFilter;
  "lib/budget": typeof lib_budget;
  "lib/classify": typeof lib_classify;
  "lib/cronGate": typeof lib_cronGate;
  "lib/effectiveStartsAt": typeof lib_effectiveStartsAt;
  "lib/eventDedupe": typeof lib_eventDedupe;
  "lib/extract": typeof lib_extract;
  "lib/firstSentence": typeof lib_firstSentence;
  "lib/geocode": typeof lib_geocode;
  "lib/guard": typeof lib_guard;
  "lib/guardData": typeof lib_guardData;
  "lib/hydrationHelpers": typeof lib_hydrationHelpers;
  "lib/llm": typeof lib_llm;
  "lib/media": typeof lib_media;
  "lib/neighborhoods": typeof lib_neighborhoods;
  "lib/priceExtract": typeof lib_priceExtract;
  "lib/quality": typeof lib_quality;
  "lib/rrule": typeof lib_rrule;
  "lib/scoring": typeof lib_scoring;
  "lib/sourceProbe": typeof lib_sourceProbe;
  "lib/titleCase": typeof lib_titleCase;
  me: typeof me;
  migrations: typeof migrations;
  popularity: typeof popularity;
  recurrence: typeof recurrence;
  sections: typeof sections;
  seed: typeof seed;
  siteSettings: typeof siteSettings;
  sourceHealth: typeof sourceHealth;
  sources: typeof sources;
  sourcesData: typeof sourcesData;
  systemAlerts: typeof systemAlerts;
  taxonomy: typeof taxonomy;
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
