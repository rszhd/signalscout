/**
 * SocialCrawl, the provider.
 *
 * One key, one account, one list of credential fields — and every platform we
 * fetch through it shares them. That is why the field list is here and not on
 * a platform: keyed by platform, one key would be pasted once per platform and
 * rotated once per platform, and a person would have three chances to leave
 * one behind.
 *
 * It is the third provider, and the first that fetches X. US-006 chose it by
 * elimination rather than by preference: Bright Data's X dataset discovers
 * only by profile, and ScrapeCreators publishes no X search endpoint at all.
 * Neither can find a stranger describing a problem, which is the product.
 * STACK.md, *A source is not a provider*.
 */
import type { CredentialField, ProviderDescriptor } from "../../types.js";

export const socialCrawlProviderId = "socialcrawl";

/**
 * The user brings a SocialCrawl key, not an X one. The label says so, because
 * a settings form that asks for "API key" next to the word X sends people to
 * X's developer portal, where the same searches cost about thirty times more.
 */
const credentialFields: readonly CredentialField[] = [
  { name: "apiKey", label: "SocialCrawl API key", secret: true },
];

export const socialCrawlProvider: ProviderDescriptor = {
  id: socialCrawlProviderId,
  displayName: "SocialCrawl",
  websiteUrl: "https://www.socialcrawl.dev/",
  credentialFields,
};
