/**
 * PLAN.md's four worked examples, replayed through the real classifier.
 *
 * The answers in `fixtures/` were given by a live model, recorded by
 * `fixtures/capture.ts`. This file spends nothing and reaches nothing: it
 * feeds each recorded answer back through the schema, the reason rule and the
 * weighting, so the numbers under test are the model's and the code under test
 * is ours.
 *
 * What this can say: the model told these four posts apart, its answers passed
 * our schema, and the weighting keeps the order PLAN.md gives. What it cannot
 * say: that the model still does. That claim is only as fresh as the capture,
 * which is why the capture is committed and re-runnable.
 */
import { readFileSync } from "node:fs";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { defaultMinimumScore } from "../db/schema.js";
import { classificationSchema, restatesTheScores } from "./classification.js";
import { createClassifier } from "./classify.js";
import type { AiConfig } from "./config.js";
import {
  type CapturedClassification,
  exampleMonitor,
  type LabelledExample,
  labelledExamples,
} from "./fixtures/examples.js";

const config: AiConfig = {
  provider: "anthropic",
  model: "recorded",
  apiKey: "not-used",
  timeoutMs: 5_000,
};

function recorded(slug: string): CapturedClassification {
  try {
    return JSON.parse(
      readFileSync(new URL(`./fixtures/${slug}.json`, import.meta.url), "utf8"),
    ) as CapturedClassification;
  } catch {
    throw new Error(
      `No recorded answer for "${slug}". Run \`pnpm --filter @signalscout/core capture:classifier\` ` +
        "with a model key. A model fixture is recorded, never written.",
    );
  }
}

/** Replay one recorded answer through the classifier the worker uses. */
async function replay(example: LabelledExample) {
  const fixture = recorded(example.slug);

  const model = new MockLanguageModelV4({
    provider: "recorded",
    modelId: fixture.model,
    doGenerate: async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(fixture.object) }],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage: {
        inputTokens: {
          total: fixture.usage.inputTokens,
          noCache: fixture.usage.inputTokens,
          cacheRead: 0,
          cacheWrite: 0,
        },
        outputTokens: {
          total: fixture.usage.outputTokens,
          text: fixture.usage.outputTokens,
          reasoning: 0,
        },
      },
      warnings: [],
    }),
  });

  const classifier = createClassifier({ config, model });
  return classifier.classify({ monitor: exampleMonitor, post: example.post });
}

describe.each(labelledExamples)("$label", (example) => {
  it(`scores intent inside ${example.intentBand[0]} to ${example.intentBand[1]}, where PLAN.md says ${example.plannedIntent}`, async () => {
    const outcome = await replay(example);

    // A recorded answer that our own schema rejects is a prompt problem, and
    // this is where it shows: in CI, for nothing, rather than at 02:00.
    expect(outcome.status).toBe("scored");
    if (outcome.status !== "scored") return;

    const [low, high] = example.intentBand;
    expect(outcome.classification.intent).toBeGreaterThanOrEqual(low);
    expect(outcome.classification.intent).toBeLessThanOrEqual(high);
  });

  it("gives reasons that cite the post rather than the scores", async () => {
    const outcome = await replay(example);
    if (outcome.status !== "scored") throw new Error("the recorded answer did not parse");

    expect(outcome.classification.reasons.length).toBeGreaterThanOrEqual(2);
    for (const reason of outcome.classification.reasons) {
      expect(restatesTheScores(reason)).toBe(false);
    }
  });
});

describe("the four examples together", () => {
  it("are ordered the way PLAN.md orders them", async () => {
    const scores: number[] = [];

    for (const example of labelledExamples) {
      const outcome = await replay(example);
      if (outcome.status !== "scored") throw new Error(`${example.slug} did not parse`);
      scores.push(outcome.score);
    }

    // PLAN.md's own ordering: praise, then a complaint, then a question, then
    // a small team asking what others use. A classifier that scores them out
    // of order is wrong however good any single number looks.
    for (let index = 1; index < scores.length; index += 1) {
      expect(scores[index]).toBeGreaterThan(scores[index - 1] as number);
    }
  });

  /**
   * The evidence for the default threshold. docs/testing.md: a measured
   * constant needs a committed instrument, and `fixtures/capture.ts` is it.
   * If this goes red, the fix is the constant or the prompt, and the commit
   * says which and why.
   */
  it("separate at the default minimum score", async () => {
    const first = await replay(labelledExamples[0] as LabelledExample);
    const last = await replay(labelledExamples[3] as LabelledExample);

    if (first.status !== "scored" || last.status !== "scored") {
      throw new Error("a recorded answer did not parse");
    }

    expect(first.score).toBeLessThan(defaultMinimumScore);
    expect(last.score).toBeGreaterThanOrEqual(defaultMinimumScore);
  });
});

describe("every recorded answer", () => {
  it("still satisfies the schema it was recorded against", () => {
    for (const example of labelledExamples) {
      const fixture = recorded(example.slug);
      expect(classificationSchema.safeParse(fixture.object).success).toBe(true);
    }
  });
});
