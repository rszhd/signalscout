/**
 * What a real model actually answered when asked to triage.
 *
 * `capture-triage.ts` produced `fixtures/triage-verdicts.json` by asking
 * `openai/gpt-5.6-luna` about every comment US-029 labelled by hand and about
 * PLAN.md's four worked examples. Nothing here reaches a provider: this file
 * replays what came back.
 *
 * Two kinds of assertion, and they fail for different reasons.
 *
 * **The shape.** Every recorded answer still parses through the schema the
 * production path uses. That is evidence about the model, which a hand-written
 * answer could not be.
 *
 * **The numbers.** The keep rates are asserted against what was measured. If
 * the prompt is edited or the model is changed, re-run the capture and put the
 * new numbers in the ticket. A red test here means the stage's behaviour moved,
 * which is a thing to decide about rather than a thing to fix.
 *
 * **46 comments in two threads is not a distribution.** Nothing here may be
 * written up as a rate for Reddit, for comments, or for anything but these two
 * threads against this one monitor.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { triageSchema } from "./triage.js";

/** What `capture-triage.ts` writes. Read from disk, the way examples.test.ts does. */
interface CapturedTriage {
  readonly provider: string;
  readonly model: string;
  readonly monitor: { readonly product: string };
  readonly counts: {
    readonly asking: number;
    readonly askingKept: number;
    readonly answering: number;
    readonly answeringKept: number;
    readonly comments: number;
    readonly commentsKept: number;
    readonly unanswered: number;
  };
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly estimatedCostMicros?: number;
  };
  readonly answers: readonly {
    readonly kind: "comment" | "post";
    readonly id: string;
    readonly role: "asking" | "answering" | "neither" | null;
    readonly verdict: "no" | "maybe" | "yes" | null;
    readonly status: string;
    readonly item: { readonly excerpt: string };
  }[];
}

const verdicts = JSON.parse(
  readFileSync(new URL("./fixtures/triage-verdicts.json", import.meta.url), "utf8"),
) as CapturedTriage;

const answers = verdicts.answers;

describe("what the model returned", () => {
  it("was captured from a real provider, not written here", () => {
    expect(verdicts.provider).toBe("openai");
    expect(verdicts.model).toBe("gpt-5.6-luna");
    expect(answers).toHaveLength(50);
  });

  it("parses through the schema the production path uses", () => {
    for (const answer of answers) {
      if (answer.verdict === null) continue;

      expect(triageSchema.safeParse({ verdict: answer.verdict }).success).toBe(true);
    }
  });

  it("answered every item: no timeout, no refusal, no malformed reply", () => {
    expect(verdicts.counts.unanswered).toBe(0);
    expect(answers.every((answer) => answer.status === "scored")).toBe(true);
  });

  /**
   * The assumption this ticket was written on, and the measurement that broke
   * it.
   *
   * A one-word answer was expected to cost a fraction of a classification's 95
   * output tokens. It does not: this model bills its own reasoning as output,
   * so the answer being short does not make the call short. The saving comes
   * from the price gap between the two models, which is why
   * `worker/runtime.ts` warns when a deployment has no gap.
   *
   * The bound is above the classification's 95 on purpose. It goes red if some
   * later prompt makes the answer genuinely cheap, which would be good news
   * that should be measured rather than assumed.
   */
  it("did not spend fewer output tokens than a classification", () => {
    const perItem = verdicts.usage.outputTokens / answers.length;

    // ai/fixtures/manifest.json: a classification is 78 to 105 output tokens.
    expect(perItem).toBeGreaterThan(95);
    expect(perItem).toBeLessThan(200);
  });

  it("cost about a quarter of a cent an item, and the run recorded it", () => {
    expect(verdicts.usage.estimatedCostMicros).toBeGreaterThan(0);

    const perItem = (verdicts.usage.estimatedCostMicros ?? 0) / answers.length;

    // One classification on the same model is about 250 micro-dollars. Triage
    // is not cheaper per call; it is cheaper only than the dearer model it
    // stands in front of.
    expect(perItem).toBeGreaterThan(200);
    expect(perItem).toBeLessThan(400);
  });
});

describe("what it kept and dropped", () => {
  /**
   * Bands, not exact counts, and the reason is measured.
   *
   * The same 50 items were captured twice on 2026-09-06 and the model did not
   * answer the same way: 21 comments kept on the first run and 19 on the
   * second, 5 people answering kept and then 6. `examples.test.ts` uses bands
   * for the same reason. An exact count here would go red on a re-capture that
   * changed nothing, and a test that cries wolf is one nobody reads.
   */
  it("drops most of the people answering, which is the saving", () => {
    expect(verdicts.counts.answering).toBe(26);
    expect(verdicts.counts.answeringKept).toBeLessThanOrEqual(9);
  });

  it("keeps roughly half of all comments", () => {
    expect(verdicts.counts.comments).toBe(46);
    expect(verdicts.counts.commentsKept).toBeGreaterThan(12);
    expect(verdicts.counts.commentsKept).toBeLessThan(28);
  });

  /**
   * The one refusal that has to be read rather than counted.
   *
   * US-029's `asking` label answers "is this person asking?". Triage is asked
   * "could this be a person to reach?", which is not the same question. The
   * refused comment asks for a way to test a native Android app, and the
   * example monitor sells a browser test runner, so the two answers disagree
   * for a reason a person can check.
   *
   * This is asserted rather than left in prose because the next person to edit
   * the prompt needs to know that this case exists and which way it went.
   */
  it("refused one of the four people asking, and it is the one about native apps", () => {
    expect(verdicts.counts.asking).toBe(4);
    expect(verdicts.counts.askingKept).toBe(3);

    const refused = answers.filter((answer) => answer.role === "asking" && answer.verdict === "no");

    expect(refused).toHaveLength(1);
    expect(refused[0]?.item.excerpt).toContain("native android app");
    expect(verdicts.monitor.product).toContain("web apps");
  });

  /**
   * The three worked examples PLAN.md scores at 50, 90 and 96 must survive.
   *
   * These are the posts the whole product is built to find. A triage stage that
   * refuses one of them is broken however good its keep rate looks, and this is
   * the assertion that says so.
   */
  it("keeps every worked example that PLAN.md scores as a lead", () => {
    const posts = answers.filter((answer) => answer.kind === "post");
    const leads = posts.filter((answer) => answer.id !== "low-intent");

    expect(leads).toHaveLength(3);
    for (const lead of leads) expect(lead.verdict).toBe("yes");
  });
});
