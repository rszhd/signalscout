/**
 * The classifier, driven with recorded model answers.
 *
 * No test here reaches a provider. The model is a stub that returns the text a
 * real one would return, which is our own JSON shape rather than someone
 * else's wire format, so writing it is honest: `fixtures/` holds the answers a
 * real model actually gave, and `examples.test.ts` asserts those.
 *
 * The cases below are the ones docs/testing.md asks for by name: schema
 * validation, a refusal, a timeout, an out-of-range score, and a malformed
 * response — plus the one that matters most, a programming error that must not
 * be reported as a handled model failure.
 */
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { createClassifier } from "./classify.js";
import type { AiConfig } from "./config.js";
import type { MonitorProfile, PostForClassification } from "./prompt.js";

const monitor: MonitorProfile = {
  product: "A test runner that records browser flows instead of coding them",
  idealCustomer: "Small SaaS teams with no dedicated QA engineer",
  problem: "End-to-end tests break whenever the UI changes",
  signals: ["recommendation_request", "problem"],
};

const post: PostForClassification = {
  source: "reddit",
  channel: "r/SaaS",
  author: "someone",
  title: "How are small teams handling regression testing?",
  excerpt:
    "We're a four-person SaaS and still manually test signup and checkout every release. What tools are other small teams using?",
  postedAt: new Date("2026-09-05T09:00:00.000Z"),
};

/** PLAN.md's worked example, as a model would return it. */
const goodAnswer = JSON.stringify({
  reasons: [
    "Four-person SaaS team with no dedicated QA",
    "Manually tests signup and checkout every release",
    "Asks what tools other small teams use",
  ],
  relevance: 98,
  problemFit: 96,
  icpFit: 91,
  intent: 88,
  urgency: 82,
  intentType: "recommendation_request",
});

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    apiKey: "test-key",
    timeoutMs: 5_000,
    ...overrides,
  };
}

function modelReturning(text: string, tokens = { input: 900, output: 120 }) {
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

/** A clock that advances 250 ms between the two readings one call takes. */
function fakeClock(steps = [1_000, 1_250]) {
  let index = 0;
  return () => steps[Math.min(index++, steps.length - 1)] as number;
}

describe("a model that answers", () => {
  it("returns the classification and the weighted score", async () => {
    const classifier = createClassifier({ config: config(), model: modelReturning(goodAnswer) });

    const outcome = await classifier.classify({ monitor, post });

    expect(outcome.status).toBe("scored");
    if (outcome.status !== "scored") return;

    expect(outcome.classification.intent).toBe(88);
    expect(outcome.classification.intentType).toBe("recommendation_request");
    expect(outcome.classification.reasons).toContain("Asks what tools other small teams use");
    // 0.35 x 88 + 0.25 x 96 + 0.20 x 98 + 0.10 x 91 + 0.10 x 82 = 91.7
    expect(outcome.score).toBe(92);
  });

  it("records the model, the token counts, the latency and the estimated cost", async () => {
    const classifier = createClassifier({
      config: config(),
      model: modelReturning(goodAnswer),
      now: fakeClock(),
    });

    const outcome = await classifier.classify({ monitor, post });

    expect(outcome.call.provider).toBe("anthropic");
    expect(outcome.call.model).toBe("claude-haiku-4-5");
    expect(outcome.call.inputTokens).toBe(900);
    expect(outcome.call.outputTokens).toBe(120);
    expect(outcome.call.latencyMs).toBe(250);
    // Claude Haiku 4.5 is $1 per million input tokens and $5 per million
    // output. 900 x $1/1e6 + 120 x $5/1e6 = $0.0015, which is 1500 micros.
    expect(outcome.call.estimatedCostMicros).toBe(1_500);
  });

  it("records no cost for a model whose price nobody configured", async () => {
    const classifier = createClassifier({
      config: config({ provider: "openai", model: "some-new-model" }),
      model: modelReturning(goodAnswer),
    });

    const outcome = await classifier.classify({ monitor, post });

    // Not zero. Zero is a claim about the bill; undefined is the truth.
    expect(outcome.call.estimatedCostMicros).toBeUndefined();
  });

  it("prices a local model at nothing", async () => {
    const classifier = createClassifier({
      config: config({ provider: "ollama", model: "llama3.2", apiKey: undefined }),
      model: modelReturning(goodAnswer),
    });

    const outcome = await classifier.classify({ monitor, post });

    expect(outcome.call.estimatedCostMicros).toBe(0);
  });
});

describe("a model that answers badly", () => {
  it("rejects a score outside 0 to 100 rather than storing it", async () => {
    const answer = JSON.parse(goodAnswer);
    answer.intent = 150;

    const classifier = createClassifier({
      config: config(),
      model: modelReturning(JSON.stringify(answer)),
    });

    const outcome = await classifier.classify({ monitor, post });

    expect(outcome.status).toBe("rejected");
    expect(outcome).not.toHaveProperty("classification");
  });

  it("rejects reasons that only restate the scores", async () => {
    const answer = JSON.parse(goodAnswer);
    answer.reasons = ["Intent is 88 out of 100", "Relevance: high"];

    const classifier = createClassifier({
      config: config(),
      model: modelReturning(JSON.stringify(answer)),
    });

    expect((await classifier.classify({ monitor, post })).status).toBe("rejected");
  });

  it("rejects prose that is not JSON at all", async () => {
    const classifier = createClassifier({
      config: config(),
      model: modelReturning("Here is my assessment: the post looks quite relevant."),
    });

    expect((await classifier.classify({ monitor, post })).status).toBe("rejected");
  });

  it("rejects a refusal, and still records what the call cost", async () => {
    const classifier = createClassifier({
      config: config(),
      model: modelReturning("I can't help with analysing social media posts about people."),
    });

    const outcome = await classifier.classify({ monitor, post });

    expect(outcome.status).toBe("rejected");
    // The provider billed for the refusal, so the record has to carry it.
    expect(outcome.call.inputTokens).toBe(900);
    expect(outcome.call.estimatedCostMicros).toBe(1_500);
  });
});

describe("a model that does not answer", () => {
  it("fails when the provider rejects the call", async () => {
    const classifier = createClassifier({
      config: config(),
      model: modelThrowing(
        new APICallError({
          message: "overloaded_error",
          url: "https://api.anthropic.com/v1/messages",
          requestBodyValues: {},
          statusCode: 529,
        }),
      ),
    });

    const outcome = await classifier.classify({ monitor, post });

    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") expect(outcome.error).toContain("overloaded_error");
  });

  it("fails when the call takes longer than the timeout", async () => {
    const hangs = new MockLanguageModelV4({
      provider: "test",
      modelId: "test-model",
      doGenerate: ({ abortSignal }) =>
        new Promise((_resolve, reject) => {
          abortSignal?.addEventListener("abort", () => reject(abortSignal.reason));
        }),
    });

    const classifier = createClassifier({ config: config({ timeoutMs: 50 }), model: hangs });

    expect((await classifier.classify({ monitor, post })).status).toBe("failed");
  });
});

/**
 * The reason the catch above is narrow.
 *
 * docs/testing.md: a memory generator swallowed every error under an honest
 * promise, raised on every call, and nothing went red. Our version would be a
 * classifier that reports a bug in this file as "the model failed", scores
 * nothing, and leaves an empty inbox that reads as a quiet day.
 */
describe("a programming error", () => {
  it("is thrown, not reported as a model failure", async () => {
    const classifier = createClassifier({
      config: config(),
      model: modelThrowing(new TypeError("reasons.map is not a function")),
    });

    await expect(classifier.classify({ monitor, post })).rejects.toThrow(
      "reasons.map is not a function",
    );
  });
});
