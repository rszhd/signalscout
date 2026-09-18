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
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exampleMonitor } from "./fixtures/examples.js";
import { pinnedTriageModel } from "./fixtures/pinned.js";
import { triageSchema } from "./triage.js";
import { buildTriageSystemPrompt } from "./triage-prompt.js";

/** What `capture-triage.ts` writes. Read from disk, the way examples.test.ts does. */
interface CapturedTriage {
  readonly provider: string;
  readonly model: string;
  readonly promptHash: string;
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
  readFileSync(
    new URL(`./fixtures/triage-verdicts-${pinnedTriageModel}.json`, import.meta.url),
    "utf8",
  ),
) as CapturedTriage;

const answers = verdicts.answers;

describe("what the model returned", () => {
  it("was captured from a real provider, not written here", () => {
    expect(verdicts.provider).toBe("openai");
    expect(verdicts.model).toBe(pinnedTriageModel);
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
   * The assumption this ticket was written on, the measurement that broke it,
   * and the second measurement that partly restored it.
   *
   * A one-word answer was expected to cost a fraction of a classification's 95
   * output tokens. On the first prompt it did not: this model bills its own
   * reasoning as output, and a short answer does not shorten the thinking. The
   * bound here used to sit *above* 95 to say so.
   *
   * US-221 sharpened the question and the thinking shrank with it, from 123
   * output tokens an item to 80. That is below a classification, so the bound
   * turned over. It is the good news the old comment said should be measured
   * rather than assumed, and it is measured here.
   *
   * It is still not where the saving comes from. Read the next test.
   */
  it("spends about what a classification spends on output", () => {
    const perItem = verdicts.usage.outputTokens / answers.length;

    // ai/fixtures/manifest.json: a classification is 78 to 105 output tokens.
    // 123 on the first prompt, 80 after US-221 sharpened the question, 97
    // after US-222 added the rules for junk. The thinking tracks the length of
    // the question, and none of the three is far from a classification's own
    // output. This band says only that: the answer being one word has never
    // made the call cheap.
    expect(perItem).toBeGreaterThan(40);
    expect(perItem).toBeLessThan(140);
  });

  /**
   * The cost per item did not move, and that is the point of asserting it.
   *
   * US-221 cut the output by a third and added as much to the input: 267
   * micro-dollars an item before, 273 after. A cheaper answer is not a cheaper
   * call. The saving is the classification that never happens, on a model that
   * costs several times this one, which is why `worker/runtime.ts` warns when a
   * deployment has no price gap between the two.
   */
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

  /**
   * The keep rate has moved four times in one day and the direction is not the
   * point. 19 before US-221, 13 after it, 8 after US-222 tightened, 14 after
   * US-223 loosened again to stop a real lead being deleted on live data.
   *
   * Tightening and loosening trade the same two numbers against each other:
   * this run refuses 3 items that would have matched where the tightest one
   * refused 7, and pays for 12 worthless classifications where that one paid
   * for 8. Neither is a fault on its own. `triage-scores.test.ts` holds the
   * one that is — a lead deleted — and this band only says the stage has not
   * quietly stopped filtering.
   */
  it("keeps between a tenth and a half of all comments", () => {
    expect(verdicts.counts.comments).toBe(46);
    expect(verdicts.counts.commentsKept).toBeGreaterThan(4);
    expect(verdicts.counts.commentsKept).toBeLessThan(23);
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
  /**
   * Two of the four, and the count alone would read as a fault.
   *
   * US-029's `asking` label answers "is this person asking?". Triage is asked
   * "could this be a person to reach, and do they want an answer?", which is
   * not the same question, so a refused asker has to be read rather than
   * counted.
   *
   * Both refusals are about a different product. One asks how to test a native
   * Android app and the example monitor sells a browser test runner. The other
   * asks whether Detox is useful, which is the same mismatch in fewer words;
   * US-222 added the rule that made it a `no`, and
   * `triage-scores-*.json` scores it **4**, so refusing it costs nothing.
   *
   * That is why the score fixture exists. A keep rate falling is not by itself
   * bad news, and only a score beside the verdict can say which it is.
   */
  it("refused two of the four people asking, and both are about another product", () => {
    expect(verdicts.counts.asking).toBe(4);
    expect(verdicts.counts.askingKept).toBe(2);

    const refused = answers.filter((answer) => answer.role === "asking" && answer.verdict === "no");
    const text = refused
      .map((answer) => answer.item.excerpt)
      .join(" ")
      .toLowerCase();

    expect(refused).toHaveLength(2);
    expect(text).toContain("native android app");
    expect(text).toContain("detox");
    expect(verdicts.monitor.product).toContain("web apps");
  });

  /**
   * The guard. Read `triage-scores.test.ts`'s header: this is the same one,
   * for the other prompt.
   *
   * A recorded verdict is evidence only while the prompt that produced it is
   * the prompt the product sends. A red test here means re-run
   * `capture:triage` and `capture:scores`, read whether the leads survived,
   * and put the numbers in the ticket. `docs/instruments.md` has the loop.
   */
  it("was captured under the prompt the product sends today", () => {
    const hash = createHash("sha256")
      .update(`${verdicts.model}\n${buildTriageSystemPrompt(exampleMonitor)}`)
      .digest("hex")
      .slice(0, 16);

    expect(hash).toBe(verdicts.promptHash);
  });

  /**
   * The three worked examples PLAN.md scores at 50, 90 and 96 must survive.
   *
   * These are the posts the whole product is built to find. A triage stage that
   * refuses one of them is broken however good its keep rate looks, and this is
   * the assertion that says so.
   */
  /**
   * Kept, not `yes`, and the difference is the stage's whole contract.
   *
   * Only an explicit `no` drops. `mild-problem-signal` — "our tests break
   * whenever the UI changes" — has answered `yes` and `maybe` on different
   * prompts and different days, and both pass it on to the classifier, which
   * is the only thing this assertion may care about. Demanding `yes` made the
   * test fail on a run where nothing was lost.
   */
  it("keeps every worked example that PLAN.md scores as a lead", () => {
    const posts = answers.filter((answer) => answer.kind === "post");
    const leads = posts.filter((answer) => answer.id !== "low-intent");

    expect(leads).toHaveLength(3);
    for (const lead of leads) expect(lead.verdict).not.toBe("no");
  });
});
