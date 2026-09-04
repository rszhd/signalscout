export { type Env, envSchema, loadEnv } from "./config/env.js";
export { createDatabase, type Database } from "./db/client.js";
export { migrationsFolder, runMigrations } from "./db/migrate.js";
export {
  embeddingDimensions,
  feedback,
  type IntentType,
  intentTypes,
  matches,
  monitors,
  posts,
  type Signal,
  type Source,
  signals,
  sources,
  type Verdict,
  verdicts,
} from "./db/schema.js";
export { createLogger, type Logger } from "./logger.js";
export {
  assertSourcesCanBeStored,
  builtInSources,
  type CandidatePost,
  type CredentialCheck,
  type CredentialField,
  createFakeSource,
  createSourceRegistry,
  createSourceRuntime,
  type FakeSource,
  type FakeSourceOptions,
  fakePosts,
  fakeSourceDefinition,
  fakeSourceId,
  type NextPage,
  type SearchRequest,
  type SearchResult,
  type SocialSource,
  type SourceCredentials,
  type SourceDefinition,
  type SourceDescriptor,
  type SourceId,
  type SourceQuery,
  type SourceRegistry,
  type SourceRuntime,
  sourceIdPattern,
  UnknownSourceError,
} from "./sources/index.js";
export {
  type HeartbeatPayload,
  heartbeatQueue,
  type StartWorkerOptions,
  startWorker,
  type WorkerHandle,
} from "./worker/runtime.js";
