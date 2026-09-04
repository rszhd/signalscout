/**
 * Which model runs the classifier, and what one call to it costs.
 *
 * The provider is configuration, never code. PLAN.md says users bring their
 * own AI key, and STACK.md chose the AI SDK exactly so that OpenAI, Anthropic,
 * Google, OpenRouter and a local Ollama are five values of one variable rather
 * than five code paths. Nothing outside this file names a provider.
 *
 * OpenRouter and Ollama both speak the OpenAI wire format, so they arrive
 * through the same compatible provider with a different base URL. That is not
 * a shortcut: it is the reason a self-hoster can point `AI_BASE_URL` at
 * anything that speaks it — vLLM, LM Studio, a gateway — without us shipping a
 * package for each.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { type AiConfig, type AiProvider, needsApiKey } from "./config.js";

const defaultBaseUrls: Partial<Record<AiProvider, string>> = {
  openrouter: "https://openrouter.ai/api/v1",
  // Ollama serves an OpenAI-compatible API on this path. A self-hoster who
  // runs it in another container overrides AI_BASE_URL.
  ollama: "http://localhost:11434/v1",
};

export class MissingAiKeyError extends Error {
  constructor(provider: AiProvider) {
    super(
      `The ${provider} provider needs AI_API_KEY. Set it, or set AI_PROVIDER=ollama to run a local model.`,
    );
    this.name = "MissingAiKeyError";
  }
}

export function createModel(config: AiConfig): LanguageModel {
  const { provider, model, apiKey, baseUrl } = config;

  if (needsApiKey(provider) && !apiKey) throw new MissingAiKeyError(provider);

  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey, baseURL: baseUrl })(model);
    case "anthropic":
      return createAnthropic({ apiKey, baseURL: baseUrl })(model);
    case "google":
      return createGoogleGenerativeAI({ apiKey, baseURL: baseUrl })(model);
    default:
      return createOpenAICompatible({
        name: provider,
        apiKey: apiKey ?? "not-needed",
        baseURL: baseUrl ?? defaultBaseUrls[provider] ?? "",
      })(model);
  }
}

/**
 * Prices we have a source for, in micro-dollars per million tokens.
 *
 * A price is a fact about someone else's product, so this table holds only the
 * models whose published price we checked, and everything else is priced by
 * `AI_INPUT_PRICE_MICROS` and `AI_OUTPUT_PRICE_MICROS`. An unpriced call
 * records no cost and says so, which a self-hoster can act on. A guessed price
 * would look exactly like a real one on the bill page US-014 builds.
 *
 * Anthropic list prices, read 2026-09-05. One US dollar is 1,000,000 micros,
 * so $1.00 per million tokens is 1_000_000 here.
 */
export const modelPrices: Readonly<Record<string, { input: number; output: number }>> = {
  "claude-haiku-4-5": { input: 1_000_000, output: 5_000_000 },
  "claude-sonnet-5": { input: 2_000_000, output: 10_000_000 },
  "claude-opus-5": { input: 5_000_000, output: 25_000_000 },
};

export interface TokenUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

/**
 * What one call cost, in micro-dollars, or undefined when we cannot say.
 *
 * A local model costs nothing to call, so Ollama is zero rather than unknown.
 */
export function estimateCostMicros(config: AiConfig, usage: TokenUsage): number | undefined {
  if (config.provider === "ollama") return 0;

  const listed = modelPrices[config.model];
  const input = config.inputPriceMicros ?? listed?.input;
  const output = config.outputPriceMicros ?? listed?.output;

  if (input === undefined || output === undefined) return undefined;
  if (usage.inputTokens === undefined || usage.outputTokens === undefined) return undefined;

  return Math.round((usage.inputTokens * input + usage.outputTokens * output) / 1_000_000);
}
