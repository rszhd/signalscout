/**
 * SocialData, the provider.
 *
 * One key, one account, one balance — and every platform we fetch through it
 * shares them. That is why the field list is here and not on a platform.
 *
 * It is the fifth provider and the second that can search X. US-006 asked
 * three and found that two could not: Bright Data's X dataset discovers by
 * profile only and ScrapeCreators publishes no X search at all. So until
 * US-061 every X poll this product made depended on one account at one
 * company, and nothing measured what happened when that account was refused.
 *
 * **This provider is prepaid rather than metered.** Every other one here bills
 * an account that keeps working; this one answers 402 the moment the balance
 * runs out. That is a failure mode no other connector has, and `client.ts`
 * gives it its own error kind: a person whose account is empty must be told to
 * top it up, not to replace a working key.
 */
import type { CredentialField, ProviderDescriptor } from "../../types.js";

export const socialDataProviderId = "socialdata";

/**
 * `apiKey`, which makes `environmentVariableFor` produce
 * `SOCIALDATA_API_KEY`.
 *
 * **The value can contain a pipe character.** An unquoted `KEY=…` line makes a
 * shell read the second half as a command, run it, and leave the variable
 * empty — which looks exactly like a missing key. `.env.example` says to quote
 * it, and the capture script says so too when it finds nothing.
 */
const credentialFields: readonly CredentialField[] = [
  { name: "apiKey", label: "SocialData API key", secret: true },
];

export const socialDataProvider: ProviderDescriptor = {
  id: socialDataProviderId,
  displayName: "SocialData",
  credentialFields,
};
