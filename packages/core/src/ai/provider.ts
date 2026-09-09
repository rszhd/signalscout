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
 * Anthropic list prices, read 2026-09-05 and again 2026-09-09 off
 * platform.claude.com/docs/en/about-claude/pricing; OpenAI's, read 2026-09-06
 * and again 2026-09-09 off developers.openai.com/api/docs/pricing; Google's,
 * read 2026-09-09 off ai.google.dev/gemini-api/docs/pricing. One US dollar is
 * 1,000,000 micros, so $1.00 per million tokens is 1_000_000 here.
 *
 * The OpenAI family matters to US-030 beyond its own bill. Luna is a tenth of
 * Terra on both halves, where Haiku is half of Sonnet — so the model a
 * deployment triages with decides whether the cascade saves a little or a lot,
 * and the ticket's arithmetic is only true for the pair it names.
 *
 * **Two prices this table deliberately does not hold.** Google's
 * `gemini-3.8-flash` is $0.75 and $3.75 only until 2026-12-31 and then $1.50
 * and $7.50, and a price that expires becomes wrong in silence on a date
 * nobody is watching for. Google's Pro models are quoted in two bands, one
 * above 200k input tokens and one below; the figures here are the lower band,
 * which is every call this product makes — a post and a monitor description
 * are thousands of tokens, not hundreds of thousands.
 *
 * There is no OpenRouter row and there never should be a guessed one. It
 * resells four hundred models at the upstream provider's price, so a snapshot
 * taken here would be a guess sitting in a table whose whole rule is that it
 * holds only what somebody read off a page.
 */
export const modelPrices: Readonly<
  Record<string, { input: number; output: number; provider: AiProvider }>
> = {
  "claude-haiku-4-5": { input: 1_000_000, output: 5_000_000, provider: "anthropic" },
  "claude-sonnet-5": { input: 2_000_000, output: 10_000_000, provider: "anthropic" },
  "claude-opus-5": { input: 5_000_000, output: 25_000_000, provider: "anthropic" },
  "claude-fable-5-1": { input: 10_000_000, output: 50_000_000, provider: "anthropic" },
  "gpt-5.6-luna": { input: 200_000, output: 1_200_000, provider: "openai" },
  "gpt-5.6-terra": { input: 2_000_000, output: 12_000_000, provider: "openai" },
  "gpt-5.6-sol": { input: 4_000_000, output: 20_000_000, provider: "openai" },
  "gpt-6-astra": { input: 10_000_000, output: 50_000_000, provider: "openai" },
  "gemini-3.5-flash-lite": { input: 300_000, output: 2_500_000, provider: "google" },
  "gemini-3.5-flash": { input: 1_500_000, output: 9_000_000, provider: "google" },
  "gemini-3.1-pro-preview": { input: 2_000_000, output: 12_000_000, provider: "google" },
};

/**
 * The priced models one provider sells.
 *
 * A person choosing a model for a job on Anthropic has no use for OpenAI's
 * names, and a list holding both invites the pairing that fails every call.
 * A provider with none here — Ollama, whose models are whatever somebody has
 * pulled — answers with an empty list, and the field still takes any name.
 */
export function pricedModelsFor(provider: string): string[] {
  return Object.entries(modelPrices)
    .filter(([, price]) => price.provider === provider)
    .map(([model]) => model);
}

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
