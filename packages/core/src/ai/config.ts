/**
 * Which model to call, as configuration.
 *
 * This file names the providers and nothing else imports an SDK to read it.
 * `config/env.ts` needs the list to validate `AI_PROVIDER`, and the API
 * process must not pull four provider packages into memory to do that.
 */

export const aiProviders = [
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "openrouter",
  "ollama",
] as const;
export type AiProvider = (typeof aiProviders)[number];

/** Providers that run on someone else's server, and so need a key. */
const remoteProviders: readonly AiProvider[] = [
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "openrouter",
];

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
  readonly AI_TRIAGE_MODEL?: string;
  readonly AI_TRIAGE_PROVIDER?: AiProvider;
  readonly AI_TRIAGE_API_KEY?: string;
  readonly AI_TRIAGE_BASE_URL?: string;
  readonly AI_TRIAGE_INPUT_PRICE_MICROS?: number;
  readonly AI_TRIAGE_OUTPUT_PRICE_MICROS?: number;
  readonly AI_DRAFT_MODEL?: string;
  readonly AI_DRAFT_PROVIDER?: AiProvider;
  readonly AI_DRAFT_API_KEY?: string;
  readonly AI_DRAFT_BASE_URL?: string;
  readonly AI_DRAFT_INPUT_PRICE_MICROS?: number;
  readonly AI_DRAFT_OUTPUT_PRICE_MICROS?: number;
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
 * A subset of `aiProviders`, and the missing ones are the point: neither
 * Anthropic nor DeepSeek publishes an embedding API. A deployment that names
 * one here would fail every call at run time; naming the subset makes it a
 * startup message instead.
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
 *
 * **Google is absent for a narrower reason than "we do not know its name",
 * measured 2026-09-09.** `gemini-embedding-2` and `gemini-embedding-001` both
 * reach 1536, but only when the request carries `output_dimensionality`, and
 * `embed.ts` sends no such parameter. So a Gemini embedding comes back wider
 * than the column, is refused by the width check, and is billed anyway.
 * Naming one here would turn that into a cost per poll on a deployment that
 * chose nothing. Sending the parameter is the change that would let Google in,
 * and it needs a real call to prove the width — which no test here may make.
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

/**
 * The triage settings. Always present, because triage always runs.
 *
 * This is the one place US-030 deliberately differs from the embedding block
 * above. An embedding stage that is not configured does not run, and that is
 * safe: a stage which is off drops nothing. Triage is the opposite. On a
 * comment it is the only paid stage in front of the classifier, so a
 * deployment that has not configured it must still get the stage — on the
 * classifier's own model, which is always configured.
 *
 * So every field falls back to the classifier's, and a deployment that sets
 * nothing runs triage and classification on one model with one key. That is
 * not a cost saving; the saving comes from the short answer, which is where
 * most of it was anyway. Naming a cheaper model here is how the rest is taken.
 *
 * The key is reused only when the provider is the same, for the reason the
 * embedding block gives: an Anthropic key sent to OpenAI fails every call and
 * the sentence a person reads points at the wrong thing.
 */
export function triageConfigFromEnvironment(env: AiEnvironment): AiConfig {
  const provider = env.AI_TRIAGE_PROVIDER ?? env.AI_PROVIDER;
  const sameProvider = provider === env.AI_PROVIDER;

  return {
    provider,
    model: env.AI_TRIAGE_MODEL ?? env.AI_MODEL,
    apiKey: env.AI_TRIAGE_API_KEY ?? (sameProvider ? env.AI_API_KEY : undefined),
    baseUrl: env.AI_TRIAGE_BASE_URL ?? (sameProvider ? env.AI_BASE_URL : undefined),
    // The classifier's timeout. Triage is the shorter call of the two, so a
    // limit that suits the long one suits this one, and a second variable
    // would be one more thing to set for no decision.
    timeoutMs: env.AI_TIMEOUT_MS,
    // The price falls back only with the model. A cheaper triage model priced
    // at the classifier's rate would report a saving that did not happen,
    // which is the one number this stage exists to prove.
    inputPriceMicros: env.AI_TRIAGE_MODEL
      ? env.AI_TRIAGE_INPUT_PRICE_MICROS
      : (env.AI_TRIAGE_INPUT_PRICE_MICROS ?? env.AI_INPUT_PRICE_MICROS),
    outputPriceMicros: env.AI_TRIAGE_MODEL
      ? env.AI_TRIAGE_OUTPUT_PRICE_MICROS
      : (env.AI_TRIAGE_OUTPUT_PRICE_MICROS ?? env.AI_OUTPUT_PRICE_MICROS),
  };
}

/**
 * The model that writes a reply draft. US-070.
 *
 * Triage's shape, and deliberately so: every setting falls back to the
 * classifier's, so a deployment that names nothing here drafts on the model it
 * already has, and a person who sets only a key on the Models screen keeps the
 * rest.
 *
 * It exists as its own setting because the two jobs are not the same job.
 * Scoring reads carefully and answers in numbers; drafting writes something
 * that will carry somebody's name into another person's conversation, and
 * `ai/reply.ts` is strict about what that may say. On some providers those are
 * different models.
 *
 * The key is reused only when the provider is the same, and the price falls
 * back only with the model — both for the reasons the triage block gives. A
 * draft billed at the classifier's rate would misreport what it cost, and that
 * figure is shown to the person who pressed the button.
 */
export function draftConfigFromEnvironment(env: AiEnvironment): AiConfig {
  const provider = env.AI_DRAFT_PROVIDER ?? env.AI_PROVIDER;
  const sameProvider = provider === env.AI_PROVIDER;

  return {
    provider,
    model: env.AI_DRAFT_MODEL ?? env.AI_MODEL,
    apiKey: env.AI_DRAFT_API_KEY ?? (sameProvider ? env.AI_API_KEY : undefined),
    baseUrl: env.AI_DRAFT_BASE_URL ?? (sameProvider ? env.AI_BASE_URL : undefined),
    timeoutMs: env.AI_TIMEOUT_MS,
    inputPriceMicros: env.AI_DRAFT_MODEL
      ? env.AI_DRAFT_INPUT_PRICE_MICROS
      : (env.AI_DRAFT_INPUT_PRICE_MICROS ?? env.AI_INPUT_PRICE_MICROS),
    outputPriceMicros: env.AI_DRAFT_MODEL
      ? env.AI_DRAFT_OUTPUT_PRICE_MICROS
      : (env.AI_DRAFT_OUTPUT_PRICE_MICROS ?? env.AI_OUTPUT_PRICE_MICROS),
  };
}
