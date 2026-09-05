export { fakePosts } from "./fake/fixtures.js";
export {
  createFakeSource,
  type FakeSource,
  type FakeSourceOptions,
  fakeProviderId,
  fakeSourceDefinition,
  fakeSourceId,
} from "./fake/index.js";
export {
  platforms,
  redditPlatform,
  redditPlatformId,
  xPlatform,
  xPlatformId,
} from "./platforms.js";
export {
  brightDataProvider,
  brightDataProviderId,
} from "./providers/brightdata/provider.js";
export {
  brightDataReddit,
  RedditSource,
  toCandidatePost,
} from "./providers/brightdata/reddit.js";
export {
  scrapeCreatorsProvider,
  scrapeCreatorsProviderId,
} from "./providers/scrapecreators/provider.js";
export {
  ScrapeCreatorsRedditSource,
  scrapeCreatorsReddit,
  toCandidatePost as toScrapeCreatorsCandidatePost,
} from "./providers/scrapecreators/reddit.js";
export {
  AmbiguousConnectorError,
  type ConnectorKey,
  type CreateSourceRegistryOptions,
  createSourceRegistry,
  type SourceRegistry,
  UnknownConnectorError,
  UnknownSourceError,
} from "./registry.js";
export { createSourceRuntime } from "./runtime.js";
export { assertSourcesCanBeStored } from "./storage.js";
export type {
  CandidatePost,
  ConnectorDefinition,
  ConnectorDescriptor,
  CredentialCheck,
  CredentialField,
  NextPage,
  PlatformDescriptor,
  PlatformId,
  ProviderDescriptor,
  ProviderId,
  SearchRequest,
  SearchResult,
  SocialSource,
  SourceCredentials,
  SourceQuery,
  SourceRuntime,
} from "./types.js";
export { connectorIdPattern } from "./types.js";

import { brightDataReddit } from "./providers/brightdata/reddit.js";
import { scrapeCreatorsReddit } from "./providers/scrapecreators/reddit.js";
import type { ConnectorDefinition } from "./types.js";

/**
 * The connectors this build ships.
 *
 * A connector is a platform and a provider together. US-005 added Reddit
 * through Bright Data, US-025 added Reddit through ScrapeCreators, and US-006
 * adds X. The interface was settled before any of them existed so that the
 * second connector is not the one that argues about the shape.
 *
 * Reddit now has two providers, so `registry.only("reddit")` needs a recorded
 * choice. `createSourceRegistry`'s `defaultProviders` is where it goes.
 *
 * Adding a *provider* for a platform we already fetch is one new file under
 * `sources/providers/` and one line here. Adding a *platform* is a descriptor
 * in `sources/platforms.ts` and a migration for `posts.source`, because a post
 * it cannot store is a poll that fails at night. See docs/sources.md.
 */
export const builtInSources: readonly ConnectorDefinition[] = [
  brightDataReddit,
  scrapeCreatorsReddit,
];
