export { fakePosts } from "./fake/fixtures.js";
export {
  createFakeSource,
  type FakeSource,
  type FakeSourceOptions,
  fakeSourceDefinition,
  fakeSourceId,
} from "./fake/index.js";
export {
  type CreateSourceRegistryOptions,
  createSourceRegistry,
  type SourceRegistry,
  UnknownSourceError,
} from "./registry.js";
export { createSourceRuntime } from "./runtime.js";
export { assertSourcesCanBeStored } from "./storage.js";
export type {
  CandidatePost,
  CredentialCheck,
  CredentialField,
  NextPage,
  SearchRequest,
  SearchResult,
  SocialSource,
  SourceCredentials,
  SourceDefinition,
  SourceDescriptor,
  SourceId,
  SourceQuery,
  SourceRuntime,
} from "./types.js";
export { sourceIdPattern } from "./types.js";

import type { SourceDefinition } from "./types.js";

/**
 * The connectors this build ships.
 *
 * It is empty on purpose. US-005 adds Reddit and US-006 adds X, and the
 * interface was settled before either existed so that the second connector is
 * not the one that argues about the shape. A connector is added here and in
 * one new folder under `sources/`; nothing else in the repository changes,
 * unless its posts are stored, which also needs a migration. See
 * docs/sources.md.
 */
export const builtInSources: readonly SourceDefinition[] = [];
