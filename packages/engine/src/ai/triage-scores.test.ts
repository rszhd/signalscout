/**
 * The scores that say whether triage drops the right items — and the guard
 * that stops them going stale without anybody noticing.
 *
 * `capture:triage` says how much triage drops. It cannot say whether it drops
 * the **right** items, because a drop leaves no score: the whole point of the
 * stage is that the classification is never bought. `capture:scores` buys them
 * anyway, outside the pipeline, and puts the score beside the verdict. This
 * file replays what came back, for nothing, the way `triage-examples.test.ts`
 * replays the verdicts.
 *
 * **The last test is the important one.** A recorded score is only evidence
 * while the prompt that produced it is the prompt the product sends. Edit
 * `prompt.ts` and every number in this file becomes a claim about a prompt
 * that no longer exists — and nothing would say so, because the fixture still
 * parses and the counts still add up. So the fixture carries a hash of the
 * exact system prompt it was captured under, and that test goes red the moment
 * the prompt moves.
 *
 * A red test there is not a bug to fix in an assertion. It means: re-run
 * `capture:triage` and `capture:scores`, read whether the leads survived, and
 * put the new numbers in the ticket. `docs/instruments.md` has the loop.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exampleMonitor } from "./fixtures/examples.js";
import { pinnedClassifierModel, pinnedTriageModel } from "./fixtures/pinned.js";
import { buildSystemPrompt } from "./prompt.js";

interface CapturedScores {
  readonly model: string;
  readonly promptHash: string;
  readonly threshold: number;
  readonly counts: {
    readonly items: number;
    readonly unscored: number;
    readonly dropped: number;
    readonly kept: number;
    readonly droppedAtOrAboveThreshold: number;
    readonly droppedAtOrAbove60: number;
    readonly keptAtOrAboveThreshold: number;
    readonly highestDropped: number;
  };
  readonly scored: readonly {
    readonly kind: "comment" | "post";
    readonly id: string;
    readonly kept: boolean;
    readonly score: number | null;
  }[];
}

/**
 * The pinned pair, not a file name written here.
 *
 * Every capture writes a file per model, so an experiment leaves its evidence
 * beside production's instead of on top of it. This reads the pair the product
 * sends, and fails with a missing file if a promotion in `pinned.ts` lands
 * before the capture that justifies it.
 */
const scores = JSON.parse(
  readFileSync(
    new URL(
      `./fixtures/triage-scores-${pinnedClassifierModel}-by-${pinnedTriageModel}.json`,
      import.meta.url,
    ),
    "utf8",
  ),
) as CapturedScores;

describe("what triage refused was worth", () => {
  it("was captured from a real classifier, not written here", () => {
    expect(scores.model).toBe(pinnedClassifierModel);
    expect(scores.scored).toHaveLength(50);
  });

  /**
   * The safety number, and the only one that matters more than the saving.
   *
   * A drop leaves no row, no inbox entry and nothing a person can notice, so a
   * strong lead refused here is a failure the product could never report. 60
   * is the band a person would call a good lead; the bound is a band rather
   * than zero-at-any-score because the stage does refuse marginal items on
   * purpose, and saying so is the honest version of this test.
   */
  it("refused nothing a person would call a good lead", () => {
    expect(scores.counts.droppedAtOrAbove60).toBe(0);
  });

  it("kept every worked example that PLAN.md scores as a lead", () => {
    const posts = scores.scored.filter((row) => row.kind === "post");
    const leads = posts.filter((row) => row.id !== "low-intent");

    expect(leads).toHaveLength(3);
    for (const lead of leads) {
      expect(lead.kept).toBe(true);
      expect(lead.score ?? 0).toBeGreaterThanOrEqual(60);
    }
  });

  /**
   * Bands, for the reason `triage-examples.test.ts` gives: the same items
   * scored twice on one day drifted 2.4 points each, and two of fifty moved by
   * ten. An exact count would go red on a re-capture that changed nothing.
   */
  it("refused only marginal items, and not many of them", () => {
    expect(scores.counts.highestDropped).toBeLessThan(60);
    expect(scores.counts.droppedAtOrAboveThreshold).toBeLessThanOrEqual(10);
  });

  it("still pays for items that score nothing, which is the work left", () => {
    // 8 of 11 on 2026-09-18. Asserted so that it is a number somebody has to
    // look at rather than a disappointment nobody wrote down.
    const waste = scores.counts.kept - scores.counts.keptAtOrAboveThreshold;

    expect(waste).toBeGreaterThan(0);
    expect(waste).toBeLessThanOrEqual(12);
  });

  /**
   * The guard. Read this file's header before changing anything here.
   */
  it("was captured under the prompt the product sends today", () => {
    const hash = createHash("sha256")
      .update(`${scores.model}\n${buildSystemPrompt(exampleMonitor)}`)
      .digest("hex")
      .slice(0, 16);

    expect(hash).toBe(scores.promptHash);
  });
});
