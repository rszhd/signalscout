/**
 * Bright Data, the provider.
 *
 * One key, one account, one list of credential fields — and every platform we
 * fetch through it shares them. That is why the field list is here and not on
 * a platform: keyed by platform, one key would be pasted once per platform and
 * rotated once per platform, and a person would have three chances to leave
 * one behind.
 *
 * Reddit's own API is closed to us, so Reddit arrives through this provider.
 * STACK.md, *A source is not a provider*.
 */
import type { CredentialField, ProviderDescriptor } from "../../types.js";

export const brightDataProviderId = "brightdata";

/**
 * The user brings a Bright Data key, not a Reddit one. The label says so,
 * because a settings form that asks for "API key" next to the word Reddit
 * sends people to Reddit's developer portal, which is exactly where they
 * cannot get one any more.
 */
const credentialFields: readonly CredentialField[] = [
  { name: "apiKey", label: "Bright Data API key", secret: true },
];

export const brightDataProvider: ProviderDescriptor = {
  id: brightDataProviderId,
  displayName: "Bright Data",
  credentialFields,
};
