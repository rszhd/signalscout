/**
 * Apify, the provider.
 *
 * One token, one account, and every actor we run through it shares them. That
 * is why the field list is here and not on a platform: keyed by platform, one
 * token would be pasted once per platform and rotated once per platform, and a
 * person would have as many chances to leave one behind.
 *
 * It is the fourth provider, and the first that is a *marketplace* rather than
 * a data API. What we actually call is one actor somebody else publishes —
 * `harvestapi/linkedin-post-search` — and Apify bills us for running it. Two
 * things follow that no other provider here has. The price belongs to the
 * actor and not to Apify, so it lives on the connector as always but is read
 * from the actor's own `pricingInfos`. And the actor can change under us
 * without the API changing at all, which is a reason to re-run the capture
 * rather than to trust a fixture for ever.
 *
 * US-057. STACK.md, *A source is not a provider*.
 */
import type { CredentialField, ProviderDescriptor } from "../../types.js";

export const apifyProviderId = "apify";

/**
 * `apiToken`, not `apiKey`, because Apify calls it a token and because
 * `environmentVariableFor` builds the variable name from this field: the pair
 * gives `APIFY_API_TOKEN`, which is what the console calls it and what a person
 * will already have in `.env`. A field named `apiKey` would silently ask for
 * `APIFY_API_KEY` and find nothing.
 */
const credentialFields: readonly CredentialField[] = [
  { name: "apiToken", label: "Apify API token", secret: true },
];

export const apifyProvider: ProviderDescriptor = {
  id: apifyProviderId,
  displayName: "Apify",
  websiteUrl: "https://apify.com/",
  credentialFields,
};
