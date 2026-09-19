/**
 * Which model runs the classifier, and what one call to it costs.
 *
 * The provider is configuration, never code. PLAN.md says users bring their
 * own AI key, and STACK.md chose the AI SDK exactly so that OpenAI, Anthropic,
 * Google, DeepSeek, OpenRouter and a local Ollama are six values of one
 * variable rather than six code paths. Nothing outside this file names a
 * provider.
 *
 * DeepSeek, OpenRouter and Ollama all speak the OpenAI wire format, so they
 * arrive through the same compatible provider with a different base URL. That
 * is not a shortcut: it is the reason a self-hoster can point `AI_BASE_URL` at
 * anything that speaks it — vLLM, LM Studio, a gateway — without us shipping a
 * package for each.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createTypeSafeAi } from "@ai-sdk/typesafe-ai";
import type { Experimental_EvaluationModel, LanguageModel } from "ai";
import { type AiConfig, type AiProvider, isEvaluationProvider, needsApiKey } from "./config.js";

const defaultBaseUrls: Partial<Record<AiProvider, string>> = {
  // DeepSeek documents this host as an OpenAI drop-in. It answers `/v1` for
  // the chat completions path, which is what the compatible client appends.
  deepseek: "https://api.deepseek.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  // Ollama serves an OpenAI-compatible API on this path. A self-hoster who
  // runs it in another container overrides AI_BASE_URL.
  ollama: "http://localhost:11434/v1",
};

/**
 * Which client each provider is built with. BUG-018.
 *
 * A table rather than the `switch` below alone, because two questions are
 * asked of it and they must never disagree: which SDK package to build, and
 * whether that package can carry a JSON schema to the provider. Adding a name
 * to `aiProviders` and forgetting this is a compile error, which is the only
 * kind of reminder that works.
 */
type ClientKind = "openai" | "anthropic" | "google" | "compatible" | "evaluation";

const clients: Readonly<Record<AiProvider, ClientKind>> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  deepseek: "compatible",
  openrouter: "compatible",
  ollama: "compatible",
  typesafe: "evaluation",
};

/**
 * A built evaluation model, never the string alias the SDK also accepts.
 *
 * `Experimental_EvaluationModel` is `string | <the model>`, because
 * `experimental_evaluate` will resolve a bare id through a configured default
 * provider. Nothing here does that — the provider and the key are arguments,
 * for the reason AGENTS.md gives about the engine reading no environment — so
 * this factory returns the built thing and callers get its real shape.
 */
export type EvaluationModelInstance = Exclude<Experimental_EvaluationModel, string>;

/**
 * The evaluation model for a provider that answers questions rather than
 * prompts. US-230.
 *
 * Separate from `createModel` because the two return different things and no
 * caller wants both. An evaluation model takes a shared state and typed
 * questions; it has no prompt, no system message and no token stream. Making
 * one function return either would push the distinction into every call site,
 * and the call site that got it wrong is the one that drops leads silently.
 */
export function createEvaluationModel(config: AiConfig): EvaluationModelInstance {
  const { provider, model, apiKey, baseUrl } = config;

  if (!isEvaluationProvider(provider)) throw new NotAnEvaluationProviderError(provider);
  if (needsApiKey(provider) && !apiKey) throw new MissingAiKeyError(provider);

  return createTypeSafeAi({ apiKey, baseURL: baseUrl }).evaluationModel(model);
}

/** The mirror of `EvaluationProviderCannotChatError`, for the other direction. */
export class NotAnEvaluationProviderError extends Error {
  constructor(provider: AiProvider) {
    super(
      `The ${provider} provider has no evaluation endpoint. Triage runs on it through the ` +
        "language-model path, not this one.",
    );
    this.name = "NotAnEvaluationProviderError";
  }
}

/**
 * Whether this provider's client sends the schema, or the prompt must. BUG-018.
 *
 * `createOpenAICompatible` asks for `response_format: json_object` and drops
 * the schema, with a warning nothing reads: *JSON response format schema is
 * only supported with structuredOutputs*. So the model is told to answer JSON
 * and never told which JSON. DeepSeek refuses the call outright — the word
 * "json" is not in the prompt either — and a provider that does not refuse
 * answers a shape our schema then rejects. Either way the call is billed and
 * scores nothing.
 *
 * `call.ts` puts the schema in the system prompt for these three. That is what
 * the AI SDK itself did before version 5 moved the decision into each
 * provider, and it is the only thing that works for a provider whose JSON mode
 * takes no schema.
 */
export function schemaGoesInThePrompt(provider: AiProvider): boolean {
  return clients[provider] === "compatible";
}

export class MissingAiKeyError extends Error {
  constructor(provider: AiProvider) {
    super(
      `The ${provider} provider needs AI_API_KEY. Set it, or set AI_PROVIDER=ollama to run a local model.`,
    );
    this.name = "MissingAiKeyError";
  }
}

/**
 * A provider named for a job it cannot do. US-230.
 *
 * `typesafe` answers evaluation questions and has no chat endpoint, so a
 * deployment that sets `AI_PROVIDER=typesafe` has asked the classifier to run
 * on a model that cannot classify. Failing here, by name, is the difference
 * between a sentence that says which setting to change and a stack trace from
 * inside the SDK on the first poll at 02:00.
 */
export class EvaluationProviderCannotChatError extends Error {
  constructor(provider: AiProvider) {
    super(
      `The ${provider} provider answers evaluation questions and cannot run this job. ` +
        "Use it for triage only: set AI_TRIAGE_PROVIDER and leave AI_PROVIDER on a chat provider.",
    );
    this.name = "EvaluationProviderCannotChatError";
  }
}

export function createModel(config: AiConfig): LanguageModel {
  const { provider, model, apiKey, baseUrl } = config;

  if (isEvaluationProvider(provider)) throw new EvaluationProviderCannotChatError(provider);
  if (needsApiKey(provider) && !apiKey) throw new MissingAiKeyError(provider);

  switch (clients[provider]) {
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
 *
 * **There is no DeepSeek row either, and US-124 read the page before deciding
 * that.** DeepSeek prices each model in four bands: peak hours and off-peak
 * hours, each split into cache hit and cache miss. One million input tokens on
 * `deepseek-flash` is $0.003 in the cheapest band and $0.30 in the dearest, and
 * the usage we are given does not say which tokens were cached. A single figure
 * would be wrong by a factor of one hundred while looking exactly like the rows
 * above it. The page also says `deepseek-v4-pro` is routed to Flash and billed
 * at Flash's price from 2026-09-14, which is the `gemini-3.8-flash` problem as
 * well. A DeepSeek deployment prices itself with `AI_INPUT_PRICE_MICROS` and
 * `AI_OUTPUT_PRICE_MICROS`, or per job on the Models screen.
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
  // TypeSafe's evaluation model, read 2026-09-19 off the AI Gateway catalog:
  // $0.000000042 per input token and nothing for output. It is the first row
  // here whose output is free, and the zero is a price we have rather than a
  // price we lack — `estimateCostMicros` needs both numbers to cost a call.
  "jev-latest": { input: 42_000, output: 0, provider: "typesafe" },
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

/**
 * Model names we have read off a provider's own page and hold no price for.
 * US-124.
 *
 * A screen needs a name to offer even where a price cannot be had, and the
 * alternative is a person typing `deepseek-flash` from memory into a blank
 * field. These are facts about somebody else's product like the prices above,
 * read the same way, and kept apart from them for `embeddingModels`' reason:
 * nothing here may be mistaken for a price we have.
 *
 * A job put on one of these records no cost until somebody sets a price. The
 * screen says so beside the name, and `recommended.ts` will still not choose
 * one by itself.
 *
 * DeepSeek's two, read 2026-09-11 off api-docs.deepseek.com. OpenRouter and
 * Ollama have no entry and should not get one: one resells four hundred models
 * and the other runs whatever a machine has pulled, so any list would be a
 * fraction of the truth presented as the whole of it.
 */
export const unpricedModels: Readonly<Record<string, readonly string[]>> = {
  deepseek: ["deepseek-flash", "deepseek-v4-pro"],
};

/** The names one provider sells that we can name but not cost. For a screen. */
export function unpricedModelsFor(provider: string): string[] {
  return [...(unpricedModels[provider] ?? [])];
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
