/**
 * Drizzle schema, by table family. `schema/vocabulary.ts` holds the closed
 * lists and the check fragments; each other file holds one family of tables.
 * This file re-exports all of it, so an importer names one module and
 * drizzle-kit reads one.
 *
 * Correctness-critical. Three of the surfaces in docs/testing.md are database
 * constraints declared here, not code: the post deduplication that stops the
 * same X read being billed twice, the score and intent-type checks that stop
 * an invalid classification being stored as a verdict, and the verification
 * columns the deletion job writes. `schema.test.ts` holds the assertions, and
 * they were written first.
 */
import {
  type AiTask,
  aiTasks,
  defaultMinimumScore,
  defaultSimilarityThreshold,
  embeddingDimensions,
  type IntentType,
  intentTypes,
  type Provider,
  providers,
  type Signal,
  type Source,
  signals,
  sources,
} from "@signalscout/engine";

export * from "./schema/estimates.js";
export * from "./schema/keys.js";
export * from "./schema/ledgers.js";
export * from "./schema/matches.js";
export * from "./schema/monitors.js";
export * from "./schema/notifications.js";
export * from "./schema/posts.js";
export * from "./schema/runs.js";
export * from "./schema/vocabulary.js";
export {
  type AiTask,
  aiTasks,
  defaultMinimumScore,
  defaultSimilarityThreshold,
  embeddingDimensions,
  type IntentType,
  intentTypes,
  type Provider,
  providers,
  type Signal,
  type Source,
  signals,
  sources,
};
