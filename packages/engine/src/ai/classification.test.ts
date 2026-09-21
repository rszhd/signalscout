/**
 * The classification schema, asserted before it was written.
 *
 * docs/testing.md lists this as a correctness-critical surface: an invalid
 * score stored as if it were a verdict. The database check constraints are the
 * second guard; this is the first, and it is the only one that can reject a
 * model's answer without the row ever being built.
 *
 * Every expected value here is a literal a person can check against PLAN.md
 * without reading the implementation.
 */
import { describe, expect, it } from "vitest";
import {
  classificationSchema,
  leadScore,
  maximumReasons,
  minimumReasons,
  restatesTheScores,
  withoutRestatedScores,
} from "./classification.js";

/** PLAN.md, *Intent classification*, the worked example, with its reason split into claims. */
const planExample = {
  reasons: [
    "Four-person SaaS team, so a small team with no dedicated QA",
    "Says they manually test signup and checkout every release",
    "Asks what tools other small teams use",
  ],
  relevance: 98,
  problemFit: 96,
  icpFit: 91,
  intent: 88,
  urgency: 82,
  intentType: "recommendation_request",
};

function withScores(overrides: Record<string, unknown>) {
  return { ...planExample, ...overrides };
}

describe("the classification schema", () => {
  it("accepts PLAN.md's own worked example", () => {
    const result = classificationSchema.safeParse(planExample);

    expect(result.success).toBe(true);
    expect(result.data?.intentType).toBe("recommendation_request");
    expect(result.data?.reasons).toHaveLength(3);
  });

  // The model returns a number it was asked to keep between 0 and 100. It is
  // the value nothing downstream re-checks before the inbox shows it, so every
  // way of leaving that range is refused here.
  it.each([
    ["above the range", 150],
    ["below the range", -1],
    ["not a number", "high"],
    ["infinite", Number.POSITIVE_INFINITY],
    ["absent", undefined],
  ])("rejects a relevance score that is %s", (_case, value) => {
    expect(classificationSchema.safeParse(withScores({ relevance: value })).success).toBe(false);
  });

  // Each score is its own field, and a rule is only as tested as its
  // least-tested caller. Five fields, five cases.
  it.each(["relevance", "problemFit", "icpFit", "intent", "urgency"])(
    "rejects 150 in the %s field",
    (field) => {
      expect(classificationSchema.safeParse(withScores({ [field]: 150 })).success).toBe(false);
    },
  );

  /**
   * A model that answers 87.5 has answered the question. The range is the
   * guard; the integer column is a storage detail, and `leadScore` rounds.
   */
  it("accepts a fractional score inside the range", () => {
    expect(classificationSchema.safeParse(withScores({ intent: 87.5 })).success).toBe(true);
  });

  it("rejects an intent type outside the list PLAN.md gives", () => {
    expect(classificationSchema.safeParse(withScores({ intentType: "spam" })).success).toBe(false);
  });

  it("accepts every intent type PLAN.md gives", () => {
    for (const intentType of [
      "none",
      "problem",
      "recommendation_request",
      "alternative_search",
      "competitor_complaint",
      "comparison",
      "purchase",
      "hiring",
    ]) {
      expect(classificationSchema.safeParse(withScores({ intentType })).success).toBe(true);
    }
  });
});

/**
 * PLAN.md's inbox shows *why* a post matched, as a list of claims about that
 * post. A reason that says "intent is 88" tells the reader what the number
 * beside it already says, so it is taken off the list — and only off the
 * list. BUG-288: the schema accepts the answer, because a rule that can
 * only cost a line must not be able to cost a post.
 */
describe("the reasons", () => {
  it.each([
    "Intent is 88 out of 100",
    "Relevance: high",
    "Problem fit 96, which is strong",
    "The score is high for this post",
    "High intent and strong urgency",
  ])("removes %s, which only restates the scores, and keeps the answer", (reason) => {
    expect(restatesTheScores(reason)).toBe(true);

    const good = "Says they manually test signup and checkout";
    expect(withoutRestatedScores([reason, good])).toEqual({ kept: [good], removed: [reason] });
    // The schema no longer refuses it: that is the point.
    expect(classificationSchema.safeParse(withScores({ reasons: [reason, good] })).success).toBe(
      true,
    );
  });

  /**
   * The live answer that BUG-288 was written from: "high-intent" quoting the
   * post's own subject. The rule still matches it — the phrase is the same
   * letters as "high intent" — and it costs one line of three, not the post.
   */
  it("leaves a classification standing when a quoted phrase matches the rule", () => {
    const live = [
      "Author asks B2B founders how long it took them to land their first paying client.",
      "They want a breakdown between high-intent conversations and legal/compliance contract timeline.",
      "They ask whether the first deal came from connection, cold outreach, or organic community interaction.",
    ];
    const { kept, removed } = withoutRestatedScores(live);
    expect(removed).toEqual([live[1]]);
    expect(kept).toEqual([live[0], live[2]]);
    expect(classificationSchema.safeParse(withScores({ reasons: live })).success).toBe(true);
  });

  it("keeps an answer whose reasons all restate the scores, with none left", () => {
    const all = ["Intent is 88 out of 100", "Relevance: high"];
    expect(withoutRestatedScores(all)).toEqual({ kept: [], removed: all });
    expect(classificationSchema.safeParse(withScores({ reasons: all })).success).toBe(true);
  });

  // The other half of the guard. These are PLAN.md's own inbox bullets, and a
  // rule that rejected them would be rejecting the feature.
  it.each([
    "Small SaaS team of four people",
    "Explicit manual-testing pain before every release",
    "Asking for solutions, not opinions",
    "Names Playwright as the suite they cannot maintain",
  ])("accepts %s, which cites the post", (reason) => {
    expect(restatesTheScores(reason)).toBe(false);
    expect(
      classificationSchema.safeParse(withScores({ reasons: [reason, "Current problem, not past"] }))
        .success,
    ).toBe(true);
  });

  it("rejects fewer reasons than the minimum", () => {
    const reasons = planExample.reasons.slice(0, minimumReasons - 1);
    expect(classificationSchema.safeParse(withScores({ reasons })).success).toBe(false);
  });

  it("rejects more reasons than the maximum", () => {
    const reasons = Array.from(
      { length: maximumReasons + 1 },
      (_value, index) => `A specific claim about this post, number ${index}`,
    );
    expect(classificationSchema.safeParse(withScores({ reasons })).success).toBe(false);
  });

  it("rejects the same claim twice", () => {
    const reasons = [planExample.reasons[0], planExample.reasons[0]];
    expect(classificationSchema.safeParse(withScores({ reasons })).success).toBe(false);
  });

  it("rejects a claim too short to say anything", () => {
    expect(classificationSchema.safeParse(withScores({ reasons: ["yes", "no"] })).success).toBe(
      false,
    );
  });
});

/**
 * The lead score is the number the inbox sorts on and the number the monitor's
 * threshold is compared against, so it is computed here and never asked of the
 * model: a model that returns both the parts and the total can contradict
 * itself, and there would be no way to say which half was wrong.
 */
describe("the lead score", () => {
  it("weights PLAN.md's worked example to 92", () => {
    // 0.35 x 88 + 0.25 x 96 + 0.20 x 98 + 0.10 x 91 + 0.10 x 82 = 91.7
    expect(leadScore(classificationSchema.parse(planExample))).toBe(92);
  });

  it("is 100 when every part is 100, and 0 when every part is 0", () => {
    const all = (value: number) =>
      classificationSchema.parse(
        withScores({
          relevance: value,
          problemFit: value,
          icpFit: value,
          intent: value,
          urgency: value,
        }),
      );

    expect(leadScore(all(100))).toBe(100);
    expect(leadScore(all(0))).toBe(0);
  });

  /**
   * The opposite mistake, and the one that reached a real inbox.
   *
   * These two are live matches from 2026-09-18, on a monitor for a social
   * listening tool. Both were scored **0 for relevance and 0 for problem fit**
   * by the classifier, and both became matches anyway: the weighted sum let
   * intent and urgency carry 45% between them. "What can I do to stop these
   * loan offer emails?" scored 31 and "Free trial vs Free plan" scored 42.
   *
   * Wanting something urgently is not wanting this. A post the classifier says
   * is not about this area cannot be a lead, and now it cannot score as one.
   */
  it("is nothing when the classifier says the post is not about this area", () => {
    const loanSpam = classificationSchema.parse(
      withScores({ relevance: 0, problemFit: 0, icpFit: 30, intent: 70, urgency: 90 }),
    );
    const pricingQuestion = classificationSchema.parse(
      withScores({ relevance: 0, problemFit: 0, icpFit: 50, intent: 80, urgency: 90 }),
    );

    expect(leadScore(loanSpam)).toBe(0);
    expect(leadScore(pricingQuestion)).toBe(0);
  });

  /**
   * A ratio rather than a cliff, so no single point of relevance decides a
   * match.
   *
   * The fall is steeper than the gate alone, because relevance is in both
   * halves: it is still one of the five weighted parts, and now it also scales
   * the result. With the other four held at 80/40/40/40, the sums are 54 at
   * relevance 40, 50 at 20, 48 at 10 and 46 at 0, and the gate multiplies them
   * by 1, 0.5, 0.25 and 0.
   */
  it("scales the score down as relevance falls, rather than cutting it off", () => {
    const at = (relevance: number) =>
      leadScore(
        classificationSchema.parse(
          withScores({ relevance, problemFit: 40, icpFit: 40, intent: 80, urgency: 40 }),
        ),
      );

    expect(at(40)).toBe(54);
    expect(at(20)).toBe(25);
    expect(at(10)).toBe(12);
    expect(at(0)).toBe(0);

    // At and above the floor the gate does nothing, so relevance is back to
    // being one weighted part of five and a higher one scores higher.
    expect(at(80)).toBe(62);
  });

  /**
   * The floor is where it is so that nothing on topic moves. PLAN.md's four
   * worked examples score 45, 94, 95 and 98 for relevance, and `low-intent` is
   * the closest of them: at 45 it clears the floor and keeps the score it
   * always had.
   */
  it("leaves a post that is on topic exactly where it was", () => {
    const lowIntent = classificationSchema.parse(
      withScores({ relevance: 45, problemFit: 0, icpFit: 5, intent: 0, urgency: 0 }),
    );

    expect(leadScore(lowIntent)).toBe(10);
  });

  /**
   * "Playwright is awesome" against a monitor for a test runner: the post is
   * about the product area, so relevance is high, and nobody is asking for
   * anything. PLAN.md puts its intent at 3. The lead score has to stay low
   * even though two of the five parts are not.
   */
  it("stays low when relevance is high and intent is not", () => {
    const score = leadScore(
      classificationSchema.parse(
        withScores({
          relevance: 90,
          problemFit: 10,
          icpFit: 50,
          intent: 3,
          urgency: 0,
          intentType: "none",
        }),
      ),
    );

    // 0.35 x 3 + 0.25 x 10 + 0.20 x 90 + 0.10 x 50 + 0.10 x 0 = 26.55
    expect(score).toBe(27);
  });
});
