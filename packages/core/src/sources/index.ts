export {
  clearProviderChoice,
  readProviderChoices,
  setProviderChoice,
} from "./choices.js";
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
  groupByPlatform,
  instagramPlatform,
  instagramPlatformId,
  linkedInPlatform,
  linkedInPlatformId,
  type PlatformConnectors,
  platforms,
  redditPlatform,
  redditPlatformId,
  xPlatform,
  xPlatformId,
} from "./platforms.js";
export {
  ApifyLinkedInSource,
  apifyLinkedIn,
  toCandidatePost as toApifyLinkedInCandidatePost,
} from "./providers/apify/linkedin.js";
export { apifyProvider, apifyProviderId } from "./providers/apify/provider.js";
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
  SocialCrawlInstagramSource,
  socialCrawlInstagram,
  toCandidatePost as toSocialCrawlInstagramCandidatePost,
} from "./providers/socialcrawl/instagram.js";
export {
  SocialCrawlLinkedInSource,
  socialCrawlLinkedIn,
  toCandidatePost as toSocialCrawlLinkedInCandidatePost,
} from "./providers/socialcrawl/linkedin.js";
export {
  AmbiguousConnectorError,
  type ChoiceOptions,
  type ConnectorKey,
  type CreateSourceRegistryOptions,
  createSourceRegistry,
  decideProvider,
  NoUsableProviderError,
  type ProviderDecision,
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
  ProviderChoices,
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

import { apifyLinkedIn } from "./providers/apify/linkedin.js";
import { brightDataReddit } from "./providers/brightdata/reddit.js";
import { scrapeCreatorsReddit } from "./providers/scrapecreators/reddit.js";
import { socialCrawlInstagram } from "./providers/socialcrawl/instagram.js";
import { socialCrawlLinkedIn } from "./providers/socialcrawl/linkedin.js";
import { socialCrawlReddit } from "./providers/socialcrawl/reddit.js";
import { socialCrawlTikTok } from "./providers/socialcrawl/tiktok.js";
import { socialCrawlX } from "./providers/socialcrawl/x.js";
import { socialCrawlYouTube } from "./providers/socialcrawl/youtube.js";
import type { ConnectorDefinition } from "./types.js";

/**
 * The connectors this build ships.
 *
 * A connector is a platform and a provider together. US-005 added Reddit
 * through Bright Data, US-025 added Reddit through ScrapeCreators, US-006
 * added X and US-028 added LinkedIn. The interface was settled before any of
 * them existed so that the second connector is not the one that argues about
 * the shape.
 *
 * SocialCrawl now fetches two platforms on one key, which is the case
 * `ProviderDescriptor` was split out for: a person pastes that key once and
 * rotates it once, however many platforms sit behind it.
 *
 * Reddit now has two providers, so `registry.only("reddit")` may need a
 * recorded choice. `source_providers` holds it, `choices.ts` reads it, and a
 * deployment holding one provider's key needs no row.
 *
 * Adding a *provider* for a platform we already fetch is one new file under
 * `sources/providers/` and one line here. Adding a *platform* is a descriptor
 * in `sources/platforms.ts` and a migration for `posts.source`, because a post
 * it cannot store is a poll that fails at night. See docs/sources.md.
 */
export const builtInSources: readonly ConnectorDefinition[] = [
  brightDataReddit,
  scrapeCreatorsReddit,
  socialCrawlReddit,
  socialCrawlX,
  // Grouped by platform, not by provider. `groupByPlatform` keeps registration
  // order, and that order is what the monitor form and the connections screen
  // show — so a new provider goes beside the others for its platform, or it
  // moves the platform up the screen for everybody. US-055 found that out.
  socialCrawlLinkedIn,
  apifyLinkedIn,
  socialCrawlYouTube,
  socialCrawlTikTok,
  socialCrawlInstagram,
];
