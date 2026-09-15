/**
 * Which provider fetches each platform for an account whose plan lends this
 * instance's keys. US-130.
 *
 * An account on that plan never pastes a key, so nothing ever records it a
 * provider choice — `recordChoiceForUnassigned` runs when a key is saved and
 * this account saves none. That is fine while the instance holds one key per
 * platform, because `decideProvider` answers with the only provider that can
 * run. It stops being fine the moment the instance holds two: `registry.only`
 * refuses, the poll logs `no_provider_choice`, and the person it refuses was
 * told this plan means not choosing anything.
 *
 * **The default is the deployment's, not the customer's.** The key is the
 * deployment's, the bill is the deployment's, and the person on this plan has
 * no reason to hold an opinion about which scraper answers. That is the
 * opposite of US-026's case, where the key belongs to the person and choosing
 * for them would spend their money at an account they did not pick — so an
 * account spending its own keys never reads this file.
 *
 * One variable per platform, named the way a credential's is, so nothing here
 * lists platforms and adding one adds no case:
 *
 *     KEYS_INCLUDED_PROVIDER_<PLATFORM ID>, upper snake case
 *     reddit  -> KEYS_INCLUDED_PROVIDER_REDDIT=scrapecreators
 *     x       -> KEYS_INCLUDED_PROVIDER_X=socialdata
 *
 * A value that names a provider this build cannot run, or one that does not
 * fetch the platform, is refused here — at boot, where both composition roots
 * call this — rather than at a poll at 02:00. Unset means the deployment named
 * nothing for that platform, and the poll answers as it did before: one usable
 * provider is its own answer, two is a refusal.
 */
import type { ConnectorDescriptor, PlatformId, ProviderChoices, ProviderId } from "./types.js";

/** `reddit` -> `KEYS_INCLUDED_PROVIDER_REDDIT`. */
export function lentProviderVariableName(platformId: PlatformId): string {
  const platform = platformId.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase();
  return `KEYS_INCLUDED_PROVIDER_${platform}`;
}

/**
 * The deployment's named provider per platform, read from the environment and
 * checked against what this build registers and offers.
 *
 * Every registered platform is asked about, switched-off connectors included in
 * the check: a variable naming a switched-off provider is a configuration that
 * cannot work, and saying so at boot is the whole point of reading it here.
 */
export function lentProvidersFrom(
  environment: Record<string, string | undefined>,
  connectors: readonly ConnectorDescriptor[],
): ProviderChoices {
  const platforms = [...new Set(connectors.map((connector) => connector.platform.id))];
  const named: Partial<Record<PlatformId, ProviderId>> = {};

  for (const platformId of platforms) {
    const variable = lentProviderVariableName(platformId);
    const raw = environment[variable]?.trim();
    if (!raw) continue;

    const candidates = connectors.filter((connector) => connector.platform.id === platformId);
    const match = candidates.find((connector) => connector.provider.id === raw);

    if (!match) {
      const fetching = candidates.map((connector) => connector.provider.id).join(", ");
      throw new Error(
        `${variable}=${raw} names a provider that does not fetch ${platformId} in this build. ` +
          `Those that do: ${fetching}.`,
      );
    }

    if (match.notOffered !== undefined) {
      throw new Error(
        `${variable}=${raw} names a provider this build has switched off: ${match.notOffered}`,
      );
    }

    named[platformId] = match.provider.id;
  }

  return named;
}
