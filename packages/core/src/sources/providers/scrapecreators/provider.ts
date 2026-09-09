/**
 * ScrapeCreators, the provider.
 *
 * One key, one account, one list of credential fields — and every platform we
 * fetch through it shares them. That is why the field list is here and not on
 * a platform: keyed by platform, one key would be pasted once per platform and
 * rotated once per platform, and a person would have three chances to leave
 * one behind.
 *
 * It is the second provider that fetches Reddit, and the first that gives the
 * split US-024 made a reason to exist. STACK.md, *A source is not a provider*.
 */
import type { CredentialField, ProviderDescriptor } from "../../types.js";

export const scrapeCreatorsProviderId = "scrapecreators";

/**
 * The user brings a ScrapeCreators key, not a Reddit one. The label says so,
 * because a settings form that asks for "API key" next to the word Reddit
 * sends people to Reddit's developer portal, which is exactly where they
 * cannot get one any more.
 */
const credentialFields: readonly CredentialField[] = [
  { name: "apiKey", label: "ScrapeCreators API key", secret: true },
];

export const scrapeCreatorsProvider: ProviderDescriptor = {
  id: scrapeCreatorsProviderId,
  displayName: "ScrapeCreators",
  websiteUrl: "https://scrapecreators.com/",
  credentialFields,
};
