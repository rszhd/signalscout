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

export const linkedInPlatformId = "linkedin";

export const linkedInPlatform: PlatformDescriptor = {
  id: linkedInPlatformId,
  displayName: "LinkedIn",
  search: {
    /**
     * Eight words, and the number is measured the same way X's four were.
     * US-028 sent `end to end tests keep breaking` to a live LinkedIn search
     * and got ten posts, eight of them about flaky tests, brittle end-to-end
     * suites and coverage that hid a production bug. The two-word `flaky
     * tests` returned ten that were all on topic. Both work here, where on X
     * only the short one did.
     *
     * So the ceiling is the generator's own, not a narrower one — a LinkedIn
     * post is long-form and a phrase has somewhere to appear.
     *
     * One thing the same run showed that no word limit can fix: this search
     * never answers "nothing". A phrase that cannot occur anywhere returned
     * ten unrelated posts and was billed in full. A bad query here does not
     * come back empty; it comes back irrelevant, and the pre-filter and the
     * model pay for it.
     */
    maxQueryWords: 8,
    note:
      "A LinkedIn post is long-form, so a whole phrase can appear in one. " +
      "Write the words a person uses when they describe the problem to " +
      "colleagues, not the words of the product category. A vague query is " +
      "not refused here — it returns unrelated posts at full price.",
  },
};

export const youTubePlatformId = "youtube";

export const youTubePlatform: PlatformDescriptor = {
  id: youTubePlatformId,
  displayName: "YouTube",
  search: {
    /**
     * Six words. Measured, and the number matters less here than on the other
     * three platforms because of what a YouTube search returns.
     *
     * US-034 searched `flaky tests` live: 45 results, and **every one of the
     * first twelve was a tutorial** — "How To Fix Flaky Tests In CI/CD", "3
     * Steps to Fix Flaky Tests", a conference talk. Not one was a person with
     * the problem. That is not a bad query; it is what the platform is. A
     * video is something somebody published to be seen.
     *
     * So on YouTube a query is aimed at the *conversation*, not the video: the
     * lead is in the comments underneath, which is why this platform is only
     * useful with replies switched on. A title is a headline, so six words is
     * enough to name a topic and short enough not to demand a sentence.
     *
     * A search that matches nothing is billed in full and comes back wrong
     * rather than empty — a phrase that cannot occur returned twelve unrelated
     * videos. Same as LinkedIn, opposite of X.
     */
    maxQueryWords: 6,
    note:
      "A YouTube search returns videos people published, not people with a " +
      "problem — every result for a topic is a tutorial about it. The lead is " +
      "in the comments, so this platform needs replies switched on to be " +
      "worth polling. Name the topic a person would search for when stuck. A " +
      "vague query is not refused here; it returns unrelated videos at full " +
      "price.",
  },
};

export const tikTokPlatformId = "tiktok";

export const tikTokPlatform: PlatformDescriptor = {
  id: tikTokPlatformId,
  displayName: "TikTok",
  search: {
    /**
     * Five words. The number matters less here than what the query is *about*,
     * and US-044 measured that the hard way.
     *
     * A search for `flaky tests` returned dandruff and school exams, because on
     * TikTok *flaky* means flakes and *test* means an exam. The words a person
     * uses in a technical field are not the words this platform indexes. Two
     * consumer queries — `budgeting app recommendations`, `best skincare for
     * acne scars` — returned thirty on-topic videos each.
     *
     * Five words is enough for the way people phrase a question out loud here
     * and short enough to stop a sentence.
     */
    maxQueryWords: 5,
    note:
      "A TikTok search returns creators, not people with problems, and the " +
      "lead is in the comments — so this platform needs replies switched on to " +
      "be worth polling. It suits a monitor whose customers have something they " +
      "must describe to get a useful answer: under a skincare video people " +
      "write out their whole condition, and under a recipe they write 'code?'. " +
      "Words also mean something else here, so prefer the words a person says " +
      "out loud over the words of a trade.",
  },
};

export const instagramPlatformId = "instagram";

export const instagramPlatform: PlatformDescriptor = {
  id: instagramPlatformId,
  displayName: "Instagram",
  search: {
    /**
     * Five words, the same as TikTok and for the same reason: this is a place
     * people speak rather than write, and a technical phrase is not what it
     * indexes.
     *
     * What US-049 measured here is not the word count, though. It is the
     * **age** of what a search returns. Thirty results for `skincare for acne
     * scars`, ranked by relevance, ran from 2021 to 2026 and the newest was
     * **five months old** — not one post from the last month. A monitor asking
     * "what was said since I last looked" would have been billed a credit a
     * poll for nothing, forever.
     *
     * The same query with the provider's date window returned eight reels and
     * every one was inside it. So on this platform the window is not a filter,
     * it is the thing that makes the search work, and the connector always
     * sends one.
     *
     * The second measurement decides whether to tick this box at all, and the
     * live poll corrected what the capture suggested about it.
     *
     * **The comments are mostly not words**: 56 of 89 collected were under ten
     * characters, and the median was four. But **the leads are all in the
     * tail**. The two highest-scoring matches, 90 and 77, are the two longest
     * comments in the run at 233 and 289 characters — a person whose barrier
     * retinol destroyed asking how to treat scars safely, and a person on
     * tretinoin for years still getting comedones. The 90 is the highest score
     * any comment has reached on any platform here; TikTok's best was 82.
     *
     * So a median is the wrong statistic for this platform. About one comment
     * in seven carries words at all, and that seventh is where every lead is.
     */
    maxQueryWords: 5,
    note:
      "An Instagram search returns creators, not people with problems, and it " +
      "is ranked by relevance rather than by date — so it suits a topic that " +
      "keeps being discussed, not a phrase somebody used this week. The lead " +
      "is in the comments, and they are worth reading: the best one a live " +
      "poll found scored higher than any comment on any other platform here. " +
      "But most comments are emoji — about one in seven carries words — and a " +
      "comment page costs five times TikTok's, so the provider bill here is " +
      "several times the model bill, which is true nowhere else. Budget for " +
      "the reading, not for the searching.",
  },
};

/** Every platform the schema accepts, for a screen that lists them. */
export const platforms: readonly PlatformDescriptor[] = [
  redditPlatform,
  xPlatform,
  linkedInPlatform,
  youTubePlatform,
  tikTokPlatform,
  instagramPlatform,
];

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
