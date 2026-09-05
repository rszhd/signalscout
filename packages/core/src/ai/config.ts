/**
 * Which model to call, as configuration.
 *
 * This file names the providers and nothing else imports an SDK to read it.
 * `config/env.ts` needs the list to validate `AI_PROVIDER`, and the API
 * process must not pull four provider packages into memory to do that.
 */

export const aiProviders = ["openai", "anthropic", "google", "openrouter", "ollama"] as const;
export type AiProvider = (typeof aiProviders)[number];

/** Providers that run on someone else's server, and so need a key. */
const remoteProviders: readonly AiProvider[] = ["openai", "anthropic", "google", "openrouter"];

export function needsApiKey(provider: AiProvider): boolean {
  return remoteProviders.includes(provider);
}

export interface AiConfig {
  readonly provider: AiProvider;
  readonly model: string;
  /** Absent for a local provider. */
  readonly apiKey?: string;
  /** Overrides the provider's own endpoint. Required for a self-hosted gateway. */
  readonly baseUrl?: string;
  /** How long one classification may take before it is abandoned. */
  readonly timeoutMs: number;
  /**
   * Micro-dollars per million input and output tokens. Set only to override
   * the built-in table, or to price a model that is not in it.
   */
  readonly inputPriceMicros?: number;
  readonly outputPriceMicros?: number;
}

/** The environment variables this reads, named structurally so nothing cycles. */
export interface AiEnvironment {
  readonly AI_PROVIDER: AiProvider;
  readonly AI_MODEL: string;
  readonly AI_API_KEY?: string;
  readonly AI_BASE_URL?: string;
  readonly AI_TIMEOUT_MS: number;
  readonly AI_INPUT_PRICE_MICROS?: number;
  readonly AI_OUTPUT_PRICE_MICROS?: number;
  readonly AI_EMBEDDING_PROVIDER?: EmbeddingProvider;
  readonly AI_EMBEDDING_MODEL?: string;
  readonly AI_EMBEDDING_API_KEY?: string;
  readonly AI_EMBEDDING_BASE_URL?: string;
  readonly AI_EMBEDDING_PRICE_MICROS?: number;
}

export function aiConfigFromEnvironment(env: AiEnvironment): AiConfig {
  return {
    provider: env.AI_PROVIDER,
    model: env.AI_MODEL,
    apiKey: env.AI_API_KEY,
    baseUrl: env.AI_BASE_URL,
    timeoutMs: env.AI_TIMEOUT_MS,
    inputPriceMicros: env.AI_INPUT_PRICE_MICROS,
    outputPriceMicros: env.AI_OUTPUT_PRICE_MICROS,
  };
}

/**
 * The providers that can embed.
 *
 * A subset of `aiProviders`, and the missing one is the point: Anthropic
 * publishes no embedding API. A deployment that names it here would fail every
 * call at run time; naming the subset makes it a startup message instead.
 */
export const embeddingProviders = ["openai", "google", "openrouter", "ollama"] as const;
export type EmbeddingProvider = (typeof embeddingProviders)[number];

export function canEmbed(provider: AiProvider): provider is EmbeddingProvider {
  return (embeddingProviders as readonly string[]).includes(provider);
}

/**
 * The default embedding model, for the one provider whose name for it we can
 * be sure of.
 *
 * `text-embedding-3-small` returns 1536 numbers, which is the width
 * `db/schema.ts` fixed the column at, and it is the cheapest of OpenAI's
 * three. Every other provider has to be told its model, because a wrong guess
 * here is a call that is billed and then thrown away for its width.
 */
export const defaultEmbeddingModels: Partial<Record<EmbeddingProvider, string>> = {
  openai: "text-embedding-3-small",
};

export interface EmbeddingConfig {
  readonly provider: EmbeddingProvider;
  readonly model: string;
  /** Absent for a local provider. */
  readonly apiKey?: string;
  readonly baseUrl?: string;
  /** How long one batch may take before it is abandoned. */
  readonly timeoutMs: number;
  /**
   * Micro-dollars per million tokens.
   *
   * There is no built-in price table for embeddings, unlike the chat models in
   * `provider.ts`. A price is a fact about someone else's product, and one we
   * have not read from the provider's own page would look exactly like one we
   * had on the bill page. Unset means the call is recorded with no cost, which
   * reads as "we cannot say" and never as "this was free".
   */
  readonly pricePerMillionTokensMicros?: number;
}

/** Embedding providers that run on someone else's server, and so need a key. */
const remoteEmbeddingProviders: readonly EmbeddingProvider[] = ["openai", "google", "openrouter"];

export function embeddingNeedsApiKey(provider: EmbeddingProvider): boolean {
  return remoteEmbeddingProviders.includes(provider);
}

/**
 * The embedding settings, or none, which is a supported answer.
 *
 * Three rules, and each one exists to stop a call that would be billed and
 * then thrown away.
 *
 * **The provider defaults to the chat provider when that provider can embed.**
 * A deployment on OpenAI gets the second stage without setting anything;
 * a deployment on Anthropic, which is our default, gets no embedder until it
 * names one.
 *
 * **The model has no default beyond OpenAI's.** Every provider spells its
 * embedding models differently, and a guessed name is a failed call once per
 * poll. No model, no embedder, and the worker says which variable to set.
 *
 * **The chat key is reused only when the provider is the same.** An Anthropic
 * key sent to OpenAI is rejected on every call, and the sentence a person
 * would read points at the wrong thing.
 */
export function embeddingConfigFromEnvironment(env: AiEnvironment): EmbeddingConfig | undefined {
  const provider =
    env.AI_EMBEDDING_PROVIDER ?? (canEmbed(env.AI_PROVIDER) ? env.AI_PROVIDER : undefined);

  if (!provider) return undefined;

  const model = env.AI_EMBEDDING_MODEL ?? defaultEmbeddingModels[provider];
  if (!model) return undefined;

  const apiKey =
    env.AI_EMBEDDING_API_KEY ?? (provider === env.AI_PROVIDER ? env.AI_API_KEY : undefined);

  return {
    provider,
    model,
    apiKey,
    baseUrl: env.AI_EMBEDDING_BASE_URL,
    // The classifier's timeout, on purpose. An embedding is the faster of the
    // two calls, so a limit that suits the slow one suits this one, and a
    // second variable would be one more thing to set for no decision.
    timeoutMs: env.AI_TIMEOUT_MS,
    pricePerMillionTokensMicros: env.AI_EMBEDDING_PRICE_MICROS,
  };
}
