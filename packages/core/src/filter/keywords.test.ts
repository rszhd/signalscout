/**
 * The free stage, on its own.
 *
 * The claim under test is one sentence: a post is kept unless it matches
 * nothing at all. Every case below is a post a person can read, next to the
 * answer they would give. That is deliberate — docs/testing.md, *anchor the
 * expected value to intent*: a case that computed the answer the way the rule
 * computes it would prove only that the rule is itself.
 *
 * The dangerous direction is the drop. A post kept by mistake costs one
 * classification. A post dropped by mistake is gone with no trace in the
 * inbox, so the cases that matter most here are the ones that assert a post is
 * kept.
 */
import { describe, expect, it } from "vitest";
import { keepsPost, keywordRuleFor, ruleIsEmpty } from "./keywords.js";

/** The monitor from PLAN.md's worked example: a test runner for small teams. */
const rule = keywordRuleFor({
  queries: ["flaky end to end tests", "our test suite keeps breaking", "playwright maintenance"],
  subreddits: ["SaaS", "QualityAssurance"],
});

function post(excerpt: string, extra: { title?: string; channel?: string } = {}) {
  return { excerpt, title: extra.title ?? null, channel: extra.channel ?? null };
}

describe("a post that shares a word with the monitor's queries", () => {
  it("is kept", () => {
    expect(
      keepsPost(rule, post("Our Playwright suite fails twice a week and nobody knows why")),
    ).toBe(true);
  });

  it("is kept on the strength of the title alone", () => {
    expect(
      keepsPost(rule, post("We ship on Fridays and hope.", { title: "The suite is flaky again" })),
    ).toBe(true);
  });

  it("is kept whatever the case", () => {
    expect(keepsPost(rule, post("PLAYWRIGHT is eating my week"))).toBe(true);
  });

  it("is kept when only the plural differs", () => {
    // The query says "tests"; the post says "test". A person would call that
    // the same word, and a stage that did not would drop a good lead.
    expect(keepsPost(rule, post("Every test in the repo broke after a redesign"))).toBe(true);
  });
});

describe("a post that shares nothing", () => {
  it("is dropped", () => {
    expect(keepsPost(rule, post("Does anyone have a good sourdough starter recipe?"))).toBe(false);
  });

  it("is dropped even when it shares only common words", () => {
    // "the", "best", "to" and "our" are in every query and every post. A stage
    // that matched on them would keep the whole internet and mean nothing.
    expect(keepsPost(rule, post("What is the best way to do our taxes?"))).toBe(false);
  });
});

describe("a post from a subreddit the monitor named", () => {
  it("is kept even when it shares no word", () => {
    // The person named this subreddit as a place their customers post. That
    // is a stronger statement than any word count.
    expect(
      keepsPost(
        rule,
        post("Anyone else struggling with churn this quarter?", {
          channel: "SaaS",
        }),
      ),
    ).toBe(true);
  });

  it("is kept whatever case or prefix the source wrote", () => {
    expect(keepsPost(rule, post("Hiring an ops lead.", { channel: "r/saas" }))).toBe(true);
  });

  it("is still dropped when the subreddit is a different one", () => {
    expect(
      keepsPost(rule, post("Anyone else struggling with churn?", { channel: "startups" })),
    ).toBe(false);
  });
});

describe("a monitor with nothing to match on", () => {
  const empty = keywordRuleFor({ queries: [], subreddits: [] });

  it("has an empty rule", () => {
    expect(ruleIsEmpty(empty)).toBe(true);
  });

  it("keeps every post", () => {
    // A stage that dropped all of them would stop the pipeline with no reason
    // anybody could read from the inbox.
    expect(keepsPost(empty, post("Does anyone have a good sourdough starter recipe?"))).toBe(true);
  });
});

describe("the words a query contributes", () => {
  it("skips the words that are in every sentence", () => {
    const words = keywordRuleFor({
      queries: ["how do i fix the flaky tests"],
      subreddits: [],
    }).keywords;

    expect([...words].sort()).toEqual(["fix", "flaky", "test"]);
  });

  it("skips words too short to mean anything on their own", () => {
    const words = keywordRuleFor({ queries: ["ci is red again"], subreddits: [] }).keywords;

    // "ci" is two letters. It appears inside enough words and names that
    // matching on it would keep posts about anything.
    expect([...words].sort()).toEqual(["again", "red"]);
  });
});
