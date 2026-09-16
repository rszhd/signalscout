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
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { type AiConfig, triageConfigFromEnvironment } from "./config.js";
import { createTriager, triageSchema } from "./triage.js";
import type { ItemForTriage, MonitorProfile } from "./triage-prompt.js";
import { buildTriageSystemPrompt } from "./triage-prompt.js";

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

    expect(system).toContain("WHEN YOU ARE UNSURE, ANSWER MAYBE");
    expect(system).toContain("A wrong 'no' deletes");
  });

  it("names the largest group the stage will see, so it is not mistaken for the target", () => {
    expect(buildTriageSystemPrompt(monitor)).toContain("most people are answering it");
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
