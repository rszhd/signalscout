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
