/**
 * HarvestAPI, the provider.
 *
 * The company whose actor Apify runs for LinkedIn, sold directly. It is the
 * same upstream as `apify`, so it is not a second source of LinkedIn data: an
 * outage there stops both. It is a second *bill*, and a smaller one — a
 * request here returns a page of fifty posts for what Apify charges for two.
 * US-386 holds the measurements.
 *
 * Pay-as-you-go: a person buys a top-up and spends it down, and the credits
 * expire a year after purchase.
 */
import type { CredentialField, ProviderDescriptor } from "../../types.js";

export const harvestApiProviderId = "harvestapi";

/** `apiKey`, which makes `environmentVariableFor` produce `HARVESTAPI_API_KEY`. */
const credentialFields: readonly CredentialField[] = [
  { name: "apiKey", label: "HarvestAPI key", secret: true },
];

export const harvestApiProvider: ProviderDescriptor = {
  id: harvestApiProviderId,
  displayName: "HarvestAPI",
  websiteUrl: "https://harvestapi.io/",
  credentialFields,
  /** A request, at the $20 top-up. */
  unitPriceMicros: 4000,
};
