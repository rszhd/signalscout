/**
 * Which client a provider name builds, and what a call on it costs. US-124.
 *
 * The cases here are about DeepSeek, because DeepSeek is the first provider
 * added since the table stopped being able to price one. Three things could go
 * wrong and none of them shows on a screen: a call sent to the wrong host, a
 * key that is not asked for, and a price invented for a model that publishes
 * four of them.
 *
 * No case here makes a call. `createModel` builds a client and sends nothing.
 */
import { describe, expect, it } from "vitest";
import { type AiConfig, aiProviders, canEmbed, needsApiKey } from "./config.js";
import {
  createEvaluationModel,
  createModel,
  EvaluationProviderCannotChatError,
  estimateCostMicros,
  MissingAiKeyError,
  modelPrices,
  NotAnEvaluationProviderError,
  pricedModelsFor,
} from "./provider.js";

const deepseek = {
  provider: "deepseek",
  model: "deepseek-flash",
  apiKey: "sk-deepseek",
  timeoutMs: 30_000,
} as const;

/**
 * Where a built client would send its next request.
 *
 * The AI SDK carries this on the model rather than offering it back, so the
 * assertion reaches for it. That is deliberate: the alternative is asserting
 * that our own constant equals our own constant, which would pass with the
 * host spelled wrong.
 */
function chatUrl(model: unknown): string {
  const config = (model as { config: { url: (at: { path: string; modelId: string }) => string } })
    .config;

  return config.url({ path: "/chat/completions", modelId: deepseek.model });
}

describe("the DeepSeek provider", () => {
  it("is a provider this build offers, and it needs a key", () => {
    expect(aiProviders).toContain("deepseek");
    expect(needsApiKey("deepseek")).toBe(true);
  });

  it("cannot embed, so a deployment is told at startup rather than per call", () => {
    expect(canEmbed("deepseek")).toBe(false);
  });

  it("refuses to build a client with no key", () => {
    expect(() => createModel({ ...deepseek, apiKey: undefined })).toThrow(MissingAiKeyError);
  });

  it("sends a call to DeepSeek's own host", () => {
    expect(chatUrl(createModel(deepseek))).toBe("https://api.deepseek.com/v1/chat/completions");
  });

  it("lets a self-hoster point the same provider at a gateway", () => {
    const model = createModel({ ...deepseek, baseUrl: "https://gateway.example/v1" });

    expect(chatUrl(model)).toBe("https://gateway.example/v1/chat/completions");
  });

  /**
   * The decision US-124 made, as an assertion.
   *
   * DeepSeek prices one model in four bands and does not tell us which band a
   * call landed in. A row here would read as a measurement on the spend page.
   * An unpriced call records no cost, which reads as "we cannot say".
   */
  it("carries no price, so a call records no cost until somebody sets one", () => {
    expect(pricedModelsFor("deepseek")).toEqual([]);
    expect(modelPrices["deepseek-flash"]).toBeUndefined();
    expect(modelPrices["deepseek-v4-pro"]).toBeUndefined();

    const usage = { inputTokens: 1000, outputTokens: 200 };
    expect(estimateCostMicros(deepseek, usage)).toBeUndefined();

    // And a deployment that sets its own band is costed on it.
    const priced = { ...deepseek, inputPriceMicros: 300_000, outputPriceMicros: 1_200_000 };
    expect(estimateCostMicros(priced, usage)).toBe(540);
  });
});

/**
 * A provider that evaluates and cannot converse. US-230.
 *
 * The failure this guards is quiet: `AI_PROVIDER=typesafe` would build a
 * client for a model with no chat endpoint, and the first sign of it would be
 * an SDK error inside a poll rather than a sentence at startup.
 */
describe("an evaluation provider", () => {
  const typesafe: AiConfig = {
    provider: "typesafe",
    model: "jev-latest",
    apiKey: "test-key",
    timeoutMs: 30_000,
  };

  it("is refused by the language-model factory, by name and with the fix", () => {
    expect(() => createModel(typesafe)).toThrow(EvaluationProviderCannotChatError);
    expect(() => createModel(typesafe)).toThrow(/AI_TRIAGE_PROVIDER/);
  });

  it("builds an evaluation model instead", () => {
    const model = createEvaluationModel(typesafe);

    expect(model.modelId).toBe("jev-latest");
    expect(model.specificationVersion).toBe("v4");
  });

  it("needs a key like any other remote provider", () => {
    expect(() => createEvaluationModel({ ...typesafe, apiKey: undefined })).toThrow(
      MissingAiKeyError,
    );
  });

  it("refuses the evaluation factory for a provider that has no such endpoint", () => {
    expect(() =>
      createEvaluationModel({ ...typesafe, provider: "openai", model: "gpt-5.6-luna" }),
    ).toThrow(NotAnEvaluationProviderError);
  });

  /**
   * The output price is zero and that is a price, not a gap. A missing one
   * makes `estimateCostMicros` answer undefined, and the spend page would go
   * quiet on the cheapest stage in the pipeline.
   */
  it("costs a call on a free output price rather than reporting nothing", () => {
    expect(estimateCostMicros(typesafe, { inputTokens: 960, outputTokens: 39 })).toBe(40);
    expect(pricedModelsFor("typesafe")).toEqual(["jev-latest"]);
  });
});
