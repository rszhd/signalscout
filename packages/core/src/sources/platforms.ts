/**
 * The platforms this product watches, apart from any provider code.
 *
 * A platform is what a person ticks and what `posts.source` stores. It is
 * described here rather than inside a connector folder because two providers
 * may fetch the same platform, and the platform must not belong to whichever
 * of them was written first. US-024 separated the two axes; `types.ts` says
 * why.
 *
 * Adding a platform is this file, a migration for `posts.source`, and at least
 * one connector. docs/sources.md holds the list.
 */
import type { ConnectorDescriptor, PlatformDescriptor, ProviderDescriptor } from "./types.js";

export const redditPlatformId = "reddit";

export const redditPlatform: PlatformDescriptor = {
  id: redditPlatformId,
  displayName: "Reddit",
};

export const xPlatformId = "x";

export const xPlatform: PlatformDescriptor = {
  id: xPlatformId,
  displayName: "X",
};

/** Every platform the schema accepts, for a screen that lists them. */
export const platforms: readonly PlatformDescriptor[] = [redditPlatform, xPlatform];

/** One platform, with every provider a build has for it. */
export interface PlatformConnectors {
  readonly platform: PlatformDescriptor;
  readonly providers: readonly ProviderDescriptor[];
}

/**
 * The connectors a build ships, grouped by the platform they fetch.
 *
 * One function rather than a group-by in each screen. A connector list is per
 * pair, and every screen that shows platforms — the monitor form, the
 * connections rows — has to collapse it the same way, or Reddit appears twice
 * on one screen and once on the other. Registration order is kept, so the two
 * screens list platforms and providers in the same order.
 */
export function groupByPlatform(connectors: readonly ConnectorDescriptor[]): PlatformConnectors[] {
  const grouped = new Map<
    string,
    { platform: PlatformDescriptor; providers: ProviderDescriptor[] }
  >();

  for (const connector of connectors) {
    const found = grouped.get(connector.platform.id);

    if (!found) {
      grouped.set(connector.platform.id, {
        platform: connector.platform,
        providers: [connector.provider],
      });
      continue;
    }

    if (!found.providers.some((provider) => provider.id === connector.provider.id)) {
      found.providers.push(connector.provider);
    }
  }

  return [...grouped.values()];
}
