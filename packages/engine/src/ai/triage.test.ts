/**
 * Triage, driven with recorded model answers.
 *
 * No test here reaches a provider. The model is a stub, for the reason
 * `classify.test.ts` gives.
 *
 * **The assertions were written before the implementation, and one of them
 * carries the whole file.** Triage decides what the classifier never reads, so
 * its failure shape is a lead deleted before anybody sees it — no row, no
 * inbox entry, nothing a person could notice. The rule that makes that
 * survivable is that only an explicit `no` drops. Every case below that ends
 * in `kept: true` exists to go red if some later change makes a failure drop
 * an item quietly.
 */

import { APICallError, InvalidResponseDataError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { type AiConfig, triageConfigFromEnvironment, triageIsOff } from "./config.js";
import type { EvaluationModelInstance } from "./provider.js";
import { createTriager, triageSchema } from "./triage.js";
import type { ItemForTriage, MonitorProfile, TriageVerdict } from "./triage-prompt.js";
import { buildTriageSystemPrompt, triageVerdicts } from "./triage-prompt.js";

const monitor: MonitorProfile = {
  product: "A test runner that records browser flows instead of coding them",
  idealCustomer: "Small SaaS teams with no dedicated QA engineer",
  problem: "End-to-end tests break whenever the UI changes",
  signals: ["recommendation_request", "problem"],
};

const post: ItemForTriage = {
  source: "reddit",
  channel: "r/SaaS",
  title: "How are small teams handling regression testing?",
  excerpt: "We're a four-person SaaS and still manually test signup and checkout every release.",
};

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    apiKey: "test-key",
    timeoutMs: 5_000,
    ...overrides,
  };
}

function modelReturning(text: string, tokens = { input: 300, output: 6 }) {
  return new MockLanguageModelV4({
    provider: "test",
    modelId: "test-model",
    doGenerate: async () => ({
      content: [{ type: "text" as const, text }],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage: {
        inputTokens: { total: tokens.input, noCache: tokens.input, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: tokens.output, text: tokens.output, reasoning: 0 },
      },
      warnings: [],
    }),
  });
}

function modelThrowing(error: unknown) {
  return new MockLanguageModelV4({
    provider: "test",
    modelId: "test-model",
    doGenerate: async () => {
      throw error;
    },
  });
}

describe("a model that answers", () => {
  it("drops the item on no, and says so", async () => {
    const triager = createTriager({
      config: config(),
      model: modelReturning(JSON.stringify({ verdict: "no" })),
    });

    const outcome = await triager.triage({ monitor, post });

    expect(outcome.kept).toBe(false);
    expect(outcome.verdict).toBe("no");
    expect(outcome.status).toBe("scored");
  });

  it.each(["yes", "maybe"] as const)("keeps the item on %s", async (verdict) => {
    const triager = createTriager({
      config: config(),
      model: modelReturning(JSON.stringify({ verdict })),
    });

    const outcome = await triager.triage({ monitor, post });

    expect(outcome.kept).toBe(true);
    expect(outcome.verdict).toBe(verdict);
  });

  it("records what the call cost, so the ledger can show what triage spent", async () => {
    const triager = createTriager({
      config: config({ inputPriceMicros: 1_000_000, outputPriceMicros: 5_000_000 }),
      model: modelReturning(JSON.stringify({ verdict: "yes" }), { input: 300, output: 6 }),
    });

    const outcome = await triager.triage({ monitor, post });

    expect(outcome.call.inputTokens).toBe(300);
    expect(outcome.call.outputTokens).toBe(6);
    // 300/1e6 x 1e6 + 6/1e6 x 5e6 = 300 + 30
    expect(outcome.call.estimatedCostMicros).toBe(330);
  });
});

/**
 * Every case here must keep the item. This is the block that stops a silent
 * drop, and it is the reason the file exists.
 */
describe("a model that does not answer keeps the item", () => {
  it("keeps it when the answer is not JSON", async () => {
    const triager = createTriager({
      config: config(),
      model: modelReturning("I cannot help with that."),
    });

    const outcome = await triager.triage({ monitor, post });

    expect(outcome.kept).toBe(true);
    expect(outcome.verdict).toBeNull();
    expect(outcome.status).toBe("rejected");
  });

  it("keeps it when the verdict is not one of the three", async () => {
    const triager = createTriager({
      config: config(),
      model: modelReturning(JSON.stringify({ verdict: "probably" })),
    });

    const outcome = await triager.triage({ monitor, post });

    expect(outcome.kept).toBe(true);
    expect(outcome.verdict).toBeNull();
    expect(outcome.status).toBe("rejected");
  });

  it("keeps it when the model times out", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    const triager = createTriager({ config: config(), model: modelThrowing(abort) });

    const outcome = await triager.triage({ monitor, post });

    expect(outcome.kept).toBe(true);
    expect(outcome.status).toBe("failed");
  });

  it("keeps it when the provider rate-limits", async () => {
    const triager = createTriager({
      config: config(),
      model: modelThrowing(
        new APICallError({
          message: "rate limit exceeded",
          url: "https://example.invalid",
          requestBodyValues: {},
          statusCode: 429,
          isRetryable: true,
        }),
      ),
    });

    const outcome = await triager.triage({ monitor, post });

    expect(outcome.kept).toBe(true);
    expect(outcome.status).toBe("failed");
  });

  it("keeps it when the provider is unreachable", async () => {
    const triager = createTriager({
      config: config(),
      model: modelThrowing(
        new APICallError({
          message: "service unavailable",
          url: "https://example.invalid",
          requestBodyValues: {},
          statusCode: 503,
          isRetryable: true,
        }),
      ),
    });

    const outcome = await triager.triage({ monitor, post });

    expect(outcome.kept).toBe(true);
    expect(outcome.status).toBe("failed");
  });

  it("does not hide a programming error as a model failure", async () => {
    const triager = createTriager({
      config: config(),
      model: modelThrowing(new TypeError("monitor.signals is not iterable")),
    });

    await expect(triager.triage({ monitor, post })).rejects.toThrow(
      "monitor.signals is not iterable",
    );
  });
});

describe("the schema", () => {
  it("refuses a verdict outside the three", () => {
    expect(triageSchema.safeParse({ verdict: "definitely" }).success).toBe(false);
  });

  it("carries no reasons, because the output tokens are the cost", () => {
    const parsed = triageSchema.parse({ verdict: "yes", reasons: ["ignored"] });

    expect(parsed).toEqual({ verdict: "yes" });
  });
});

describe("the prompt", () => {
  it("tells the model which way to fail, because the two mistakes differ in cost", () => {
    const system = buildTriageSystemPrompt(monitor);

    expect(system).toContain("MAYBE IS FOR A PERSON WHO MIGHT WANT SOMETHING");
    expect(system).toContain("A wrong 'no' deletes");
  });

  it("names the largest group the stage will see, so it is not mistaken for the target", () => {
    expect(buildTriageSystemPrompt(monitor)).toContain("most people are answering it");
  });

  /**
   * US-221. The two lines that carry the narrowing, and the one that holds it
   * open.
   *
   * Triage screens for what the classifier scores, and three of its five
   * dimensions are about what the author wants. Without the first line a
   * plausible person who wants nothing is a `maybe` and a paid call; without
   * the second, `maybe` widens back out into doubt about anything.
   */
  it("asks what the author wants, not only who the author is", () => {
    const system = buildTriageSystemPrompt(monitor);

    expect(system).toContain("whether anything here says they want an answer");
    expect(system).toContain("plainly wants nothing is a 'no'");
  });

  it("still leaves maybe open for a person who might want something", () => {
    const system = buildTriageSystemPrompt(monitor);

    expect(system).toContain("answer maybe and let the second reader decide");
  });
});

/**
 * The fallback, which decides what an unconfigured deployment runs.
 *
 * It differs from the embedding block's on purpose: an unset embedding
 * provider means no stage, and an unset triage model means the classifier's
 * model. A stage that is off drops nothing, which is safe, but on a comment
 * this is the only paid stage in front of the classifier.
 */
describe("the triage settings", () => {
  const base = {
    AI_PROVIDER: "openai",
    AI_MODEL: "gpt-5.6-terra",
    AI_API_KEY: "classifier-key",
    AI_TIMEOUT_MS: 30_000,
  } as const;

  it("falls back to the classifier's model and key when nothing is set", () => {
    const config = triageConfigFromEnvironment(base);

    expect(config.provider).toBe("openai");
    expect(config.model).toBe("gpt-5.6-terra");
    expect(config.apiKey).toBe("classifier-key");
  });

  /**
   * US-177. The stage is not cheap in itself — a triage answer measured 113
   * output tokens against a classification's 95 — so the whole saving is the
   * price gap. A deployment with no gap is allowed to say so.
   */
  it("is on unless a deployment says off, and the settings stay readable either way", () => {
    expect(triageIsOff(base)).toBe(false);
    expect(triageIsOff({ ...base, AI_TRIAGE: "on" })).toBe(false);
    expect(triageIsOff({ ...base, AI_TRIAGE: "off" })).toBe(true);

    // The config still answers "how would it triage", because a capture that
    // measures the stage builds a triager whatever the deployment runs.
    expect(triageConfigFromEnvironment({ ...base, AI_TRIAGE: "off" }).model).toBe("gpt-5.6-terra");
  });

  it("uses the cheaper model when one is named, on the same key", () => {
    const config = triageConfigFromEnvironment({ ...base, AI_TRIAGE_MODEL: "gpt-5.6-luna" });

    expect(config.model).toBe("gpt-5.6-luna");
    expect(config.apiKey).toBe("classifier-key");
  });

  it("does not lend the classifier's key to another provider", () => {
    const config = triageConfigFromEnvironment({ ...base, AI_TRIAGE_PROVIDER: "anthropic" });

    expect(config.provider).toBe("anthropic");
    expect(config.apiKey).toBeUndefined();
  });

  /**
   * The one number this ticket exists to prove is what triage saved. A cheaper
   * model priced at the classifier's rate would report a saving that did not
   * happen, which is worse than reporting none.
   */
  it("does not price a named triage model at the classifier's rate", () => {
    const config = triageConfigFromEnvironment({
      ...base,
      AI_INPUT_PRICE_MICROS: 2_000_000,
      AI_OUTPUT_PRICE_MICROS: 10_000_000,
      AI_TRIAGE_MODEL: "gpt-5.6-luna",
    });

    expect(config.inputPriceMicros).toBeUndefined();
    expect(config.outputPriceMicros).toBeUndefined();
  });

  it("keeps the classifier's price while triage shares its model", () => {
    const config = triageConfigFromEnvironment({ ...base, AI_INPUT_PRICE_MICROS: 2_000_000 });

    expect(config.inputPriceMicros).toBe(2_000_000);
  });
});

/**
 * Triage on an evaluation model. US-230.
 *
 * The same rule as every test above, on a second path: **only an explicit `no`
 * drops.** The branch this covers is new and the failure it exists to catch is
 * the old one — a `catch`, or a floor, that starts returning `kept: false`.
 *
 * One thing here is not in the language-model path. An evaluation model reports
 * how sure it is, and a `no` it is unsure of is not an explicit `no`. So there
 * is a floor, it keeps rather than drops below it, and these cases are what
 * stop a later edit inverting that.
 */

/** A stand-in evaluation model: the SDK ships no mock for this specification. */
function evaluationModel(
  answer: () => {
    answers: Record<string, unknown>;
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
    providerMetadata?: Record<string, unknown>;
  },
): EvaluationModelInstance {
  return {
    specificationVersion: "v4",
    provider: "typesafe",
    modelId: "jev-latest",
    supportedQuestionTypes: ["choice", "score", "boolean"],
    async doEvaluate() {
      const given = answer();
      return {
        answers: given.answers,
        usage: given.usage ?? { inputTokens: 900, outputTokens: 6, totalTokens: 906 },
        warnings: [],
        providerMetadata: given.providerMetadata,
      } as never;
    },
  } as EvaluationModelInstance;
}

/**
 * The distribution is complete on purpose: the SDK refuses an answer that
 * gives a probability for some options and not others, which is a rule worth
 * meeting in the stub rather than discovering in production.
 */
function choosing(choice: TriageVerdict, confidence?: number): EvaluationModelInstance {
  const probabilities = Object.fromEntries(
    triageVerdicts.map((verdict) => [verdict, verdict === choice ? 0.8 : 0.1]),
  );

  return evaluationModel(() => ({
    answers: { verdict: { type: "choice", choice, probabilities } },
    ...(confidence === undefined
      ? {}
      : { providerMetadata: { typesafe: { confidence: { verdict: confidence } } } }),
  }));
}

function evaluationThrowing(error: unknown): EvaluationModelInstance {
  return evaluationModel(() => {
    throw error;
  });
}

const evaluationConfig = () =>
  config({ provider: "typesafe", model: "jev-latest", apiKey: "test-key" });

describe("an evaluation model that answers", () => {
  it("drops the item on a confident no", async () => {
    const triager = createTriager({
      config: evaluationConfig(),
      evaluationModel: choosing("no", 0.9),
    });

    const outcome = await triager.triage({ monitor, post });

    expect(outcome.verdict).toBe("no");
    expect(outcome.kept).toBe(false);
    expect(outcome.status).toBe("scored");
  });

  it.each(["yes", "maybe"] as const)("keeps the item on %s", async (verdict) => {
    const triager = createTriager({
      config: evaluationConfig(),
      evaluationModel: choosing(verdict, 0.9),
    });

    const outcome = await triager.triage({ monitor, post });

    expect(outcome.verdict).toBe(verdict);
    expect(outcome.kept).toBe(true);
  });

  it("records the provider, the model and what the call cost", async () => {
    const triager = createTriager({
      config: evaluationConfig(),
      evaluationModel: choosing("no", 0.9),
    });

    const { call } = await triager.triage({ monitor, post });

    expect(call.provider).toBe("typesafe");
    expect(call.model).toBe("jev-latest");
    expect(call.inputTokens).toBe(900);
    // 900 input tokens at 42,000 micro-dollars a million, and output is free.
    expect(call.estimatedCostMicros).toBe(38);
  });
});

/**
 * The floor, and why it keeps rather than drops.
 *
 * US-229 measured the two leads a weaker rule lost at confidence 0.13 and
 * 0.25, and the six it kept between 0.64 and 0.86. A `no` under the floor is
 * the model saying it cannot tell, and this stage may not delete a lead on
 * that.
 */
describe("an unsure no keeps the item", () => {
  it("keeps a no below the floor", async () => {
    const triager = createTriager({
      config: evaluationConfig(),
      evaluationModel: choosing("no", 0.2),
    });

    const outcome = await triager.triage({ monitor, post });

    expect(outcome.verdict).toBe("no");
    expect(outcome.kept).toBe(true);
    expect(outcome.status).toBe("scored");
  });

  it("drops a no exactly at the floor, so the boundary is not a gap", async () => {
    const triager = createTriager({
      config: evaluationConfig(),
      evaluationModel: choosing("no", 0.6),
    });

    expect((await triager.triage({ monitor, post })).kept).toBe(false);
  });

  it("keeps a no when the provider reports no confidence at all", async () => {
    const triager = createTriager({
      config: evaluationConfig(),
      evaluationModel: choosing("no"),
    });

    const outcome = await triager.triage({ monitor, post });

    expect(outcome.kept).toBe(true);
  });

  it("takes a floor the caller sets", async () => {
    const triager = createTriager({
      config: evaluationConfig(),
      evaluationModel: choosing("no", 0.5),
      confidenceFloor: 0.4,
    });

    expect((await triager.triage({ monitor, post })).kept).toBe(false);
  });

  it("never drops on a yes or a maybe, however unsure", async () => {
    for (const verdict of ["yes", "maybe"] as const) {
      const triager = createTriager({
        config: evaluationConfig(),
        evaluationModel: choosing(verdict, 0.01),
      });

      expect((await triager.triage({ monitor, post })).kept).toBe(true);
    }
  });
});

describe("an evaluation model that does not answer keeps the item", () => {
  it("keeps the item when the provider refuses the call", async () => {
    const triager = createTriager({
      config: evaluationConfig(),
      evaluationModel: evaluationThrowing(
        new APICallError({
          message: "401 unauthorised",
          url: "https://api.typesafe.ai/v1",
          requestBodyValues: {},
        }),
      ),
    });

    const outcome = await triager.triage({ monitor, post });

    expect(outcome.kept).toBe(true);
    expect(outcome.verdict).toBeNull();
    expect(outcome.status).toBe("failed");
  });

  it("keeps the item when our own timeout fires", async () => {
    const abort = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const triager = createTriager({
      config: evaluationConfig(),
      evaluationModel: evaluationThrowing(abort),
    });

    expect((await triager.triage({ monitor, post })).kept).toBe(true);
  });

  /**
   * The rounding near-tie, which is a real provider behaviour and not a
   * hypothetical. TypeSafe rounds to two decimals and the SDK checks the
   * chosen option holds the highest one; 0.40 against 0.41 fails that check.
   */
  it("keeps the item when rounding makes the chosen option not the highest", async () => {
    const triager = createTriager({
      config: evaluationConfig(),
      evaluationModel: evaluationThrowing(
        new InvalidResponseDataError({
          data: { verdict: { type: "choice", choice: "no" } },
          message: 'Question "verdict" did not select a highest-probability option.',
        }),
      ),
    });

    const outcome = await triager.triage({ monitor, post });

    expect(outcome.kept).toBe(true);
    expect(outcome.verdict).toBeNull();
    expect(outcome.status).toBe("rejected");
  });

  it("keeps the item when the provider answers a question we did not ask", async () => {
    const triager = createTriager({
      config: evaluationConfig(),
      evaluationModel: evaluationModel(() => ({
        answers: { verdict: { type: "score", score: 2 } },
      })),
    });

    const outcome = await triager.triage({ monitor, post });

    expect(outcome.kept).toBe(true);
    expect(outcome.status).toBe("rejected");
  });
});
