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
  search: {
    /**
     * Eight words, which is the generator's own ceiling: a Reddit post has a
     * title and paragraphs, so a long phrase has somewhere to appear. US-022
     * measured the real limit here, and it is not length — the keyword
     * `end to end tests keep breaking` returned posts from r/AllFinraExams and
     * r/islam because the provider matched `test` and `end` as ordinary words.
     */
    maxQueryWords: 8,
    note:
      "A Reddit post has a title and paragraphs, so a longer phrase can appear " +
      "in one. Prefer the words a person in trouble types over the words of " +
      "the product category.",
  },
};

export const xPlatformId = "x";

export const xPlatform: PlatformDescriptor = {
  id: xPlatformId,
  displayName: "X",
  search: {
    /**
     * Four words, and the number is measured rather than chosen for
     * roundness. US-006 sent `end to end tests keep breaking` to a live X
     * search twice: unquoted it returned anime, Bitcoin and a CIA story across
     * three weeks, and quoted it matched nothing at all. `flaky tests`
     * returned twenty posts, all on topic and all within three days.
     *
     * Four leaves room for a short phrase and stops a sentence. It is a
     * ceiling and not a target: two words is a good X query.
     */
    maxQueryWords: 4,
    note:
      "An X post is a few sentences, so a long phrase matches nothing at all. " +
      "Two to four words. Write the words that would appear inside somebody's " +
      "complaint, not a description of it.",
  },
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
