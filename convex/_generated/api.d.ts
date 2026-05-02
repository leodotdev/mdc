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
import type * as events from "../events.js";
import type * as http from "../http.js";
import type * as lib_adapters_index from "../lib/adapters/index.js";
import type * as lib_adapters_reddit from "../lib/adapters/reddit.js";
import type * as lib_adapters_rss from "../lib/adapters/rss.js";
import type * as lib_adapters_types from "../lib/adapters/types.js";
import type * as lib_adapters_web from "../lib/adapters/web.js";
import type * as lib_adapters_wikipediaOtd from "../lib/adapters/wikipediaOtd.js";
import type * as lib_adapters_x from "../lib/adapters/x.js";
import type * as lib_adapters_youtube from "../lib/adapters/youtube.js";
import type * as lib_eventKinds from "../lib/eventKinds.js";
import type * as lib_guard from "../lib/guard.js";
import type * as lib_llm from "../lib/llm.js";
import type * as lib_media from "../lib/media.js";
import type * as lib_neighborhoods from "../lib/neighborhoods.js";
import type * as lib_scoring from "../lib/scoring.js";
import type * as lib_storyArcs from "../lib/storyArcs.js";
import type * as me from "../me.js";
import type * as migrations from "../migrations.js";
import type * as sections from "../sections.js";
import type * as seed from "../seed.js";
import type * as sources from "../sources.js";
import type * as sourcesData from "../sourcesData.js";

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
  events: typeof events;
  http: typeof http;
  "lib/adapters/index": typeof lib_adapters_index;
  "lib/adapters/reddit": typeof lib_adapters_reddit;
  "lib/adapters/rss": typeof lib_adapters_rss;
  "lib/adapters/types": typeof lib_adapters_types;
  "lib/adapters/web": typeof lib_adapters_web;
  "lib/adapters/wikipediaOtd": typeof lib_adapters_wikipediaOtd;
  "lib/adapters/x": typeof lib_adapters_x;
  "lib/adapters/youtube": typeof lib_adapters_youtube;
  "lib/eventKinds": typeof lib_eventKinds;
  "lib/guard": typeof lib_guard;
  "lib/llm": typeof lib_llm;
  "lib/media": typeof lib_media;
  "lib/neighborhoods": typeof lib_neighborhoods;
  "lib/scoring": typeof lib_scoring;
  "lib/storyArcs": typeof lib_storyArcs;
  me: typeof me;
  migrations: typeof migrations;
  sections: typeof sections;
  seed: typeof seed;
  sources: typeof sources;
  sourcesData: typeof sourcesData;
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
