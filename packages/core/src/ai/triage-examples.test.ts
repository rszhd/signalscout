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
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
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

  it("spent about six output tokens an item, which is where the saving is", () => {
    // A classification is 95 output tokens, from ai/fixtures/manifest.json.
    // Output is priced about five times input, so this ratio is the cascade.
    expect(verdicts.usage.outputTokens / answers.length).toBeLessThan(130);
    expect(verdicts.usage.inputTokens / answers.length).toBeLessThan(700);
  });
});

describe("what it kept and dropped", () => {
  it("dropped four fifths of the people answering, which is the saving", () => {
    expect(verdicts.counts.answering).toBe(26);
    expect(verdicts.counts.answeringKept).toBe(5);
  });

  it("kept about half of all comments", () => {
    expect(verdicts.counts.comments).toBe(46);
    expect(verdicts.counts.commentsKept).toBe(21);
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
