/**
 * Turning text into vectors, and what that cost.
 *
 * The pre-filter's second stage compares a post against the monitor's own
 * description, and this is the call that makes both sides comparable. It is a
 * different model from the classifier, a different price, and about one
 * hundredth of the cost, which is the whole reason US-008 exists.
 *
 * Three things here are not obvious.
 *
 * **Not every model provider embeds.** Anthropic has no embedding endpoint, and
 * it is this product's default chat provider, so the common deployment has a
 * classifier and no embedder at all. That is a supported state, not a broken
 * one: `worker/filter.ts` skips the second stage and every post the keyword
 * stage kept reaches the model. It costs more and it drops nothing, which is
 * the direction US-008 says to fail in.
 *
 * **A vector of the wrong width is a failure, not a row.** `posts.embedding` is
 * fixed at `embeddingDimensions`, because pgvector cannot index a dimensionless
 * column. A model that answers with 768 numbers — Google's `text-embedding-004`
 * does — would otherwise reach the insert and fail there, once per post, with a
 * message about a column. It is caught here, where the sentence can name the
 * model and the variable that chose it.
 *
 * **The catch is narrow, for `call.ts`'s reason.** Errors the AI SDK raises for
 * the provider's behaviour become a `failed` outcome that the caller handles by
 * sending the post to the model anyway. Anything else is ours and is rethrown:
 * a bug that returned "the embedder failed" would turn the pre-filter into an
 * expensive no-op that nothing reports.
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, type EmbeddingModel, embedMany, RetryError } from "ai";
import { embeddingDimensions } from "../db/schema.js";
import type { ModelCall } from "./call.js";
import { type EmbeddingConfig, type EmbeddingProvider, embeddingNeedsApiKey } from "./config.js";

/**
 * Two outcomes, and only the first carries vectors.
 *
 * There is no `rejected` here, unlike the classifier. An embedding answers no
 * schema, so there is no such thing as the model answering badly: either the
 * vectors came back with the right width, or the call failed.
 */
export type EmbedOutcome =
  | {
      readonly status: "embedded";
      /** In the order the values were given, one row of numbers each. */
      readonly embeddings: readonly (readonly number[])[];
      readonly call: ModelCall;
    }
  | { readonly status: "failed"; readonly error: string; readonly call: ModelCall };

export interface Embedder {
  readonly provider: EmbeddingProvider;
  readonly model: string;
  /** How wide a vector this embedder must produce for the column to hold it. */
  readonly dimensions: number;
  embed(values: readonly string[]): Promise<EmbedOutcome>;
}

export class MissingEmbeddingKeyError extends Error {
  constructor(provider: EmbeddingProvider) {
    super(
      `The ${provider} embedding provider needs AI_EMBEDDING_API_KEY. Set it, or set AI_EMBEDDING_PROVIDER=ollama to embed with a local model.`,
    );
    this.name = "MissingEmbeddingKeyError";
  }
}

const defaultBaseUrls: Partial<Record<EmbeddingProvider, string>> = {
  openrouter: "https://openrouter.ai/api/v1",
  ollama: "http://localhost:11434/v1",
};

export function createEmbeddingModel(config: EmbeddingConfig): EmbeddingModel {
  const { provider, model, apiKey, baseUrl } = config;

  if (embeddingNeedsApiKey(provider) && !apiKey) throw new MissingEmbeddingKeyError(provider);

  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey, baseURL: baseUrl }).textEmbeddingModel(model);
    case "google":
      return createGoogleGenerativeAI({ apiKey, baseURL: baseUrl }).textEmbeddingModel(model);
    default:
      return createOpenAICompatible({
        name: provider,
        apiKey: apiKey ?? "not-needed",
        baseURL: baseUrl ?? defaultBaseUrls[provider] ?? "",
      }).textEmbeddingModel(model);
  }
}

/**
 * What one batch cost, in micro-dollars, or undefined when we cannot say.
 *
 * A local model costs nothing to call, so Ollama is zero rather than unknown —
 * the same rule `estimateCostMicros` applies to the classifier.
 */
export function estimateEmbeddingCostMicros(
  config: EmbeddingConfig,
  tokens: number | undefined,
): number | undefined {
  if (config.provider === "ollama") return 0;
  if (config.pricePerMillionTokensMicros === undefined || tokens === undefined) return undefined;

  return Math.round((tokens * config.pricePerMillionTokensMicros) / 1_000_000);
}

export interface EmbedderOptions {
  readonly config: EmbeddingConfig;
  /** Overrides the model the config names. A test passes a fake; nothing else does. */
  readonly model?: EmbeddingModel;
  readonly now?: () => number;
}

function isAbort(error: unknown): boolean {
  const name = (error as { name?: unknown })?.name;
  return name === "AbortError" || name === "TimeoutError";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createEmbedder({ config, model, now = Date.now }: EmbedderOptions): Embedder {
  const embeddingModel = model ?? createEmbeddingModel(config);

  return {
    provider: config.provider,
    model: config.model,
    dimensions: embeddingDimensions,

    async embed(values: readonly string[]): Promise<EmbedOutcome> {
      const startedAt = now();

      const measure = (tokens?: number): ModelCall => ({
        // `ModelCall` speaks of `AiProvider`, and every embedding provider is
        // one. The ledger holds both kinds of call, so it has to.
        provider: config.provider,
        model: config.model,
        inputTokens: tokens,
        // An embedding produces no output tokens. Null is the honest column
        // value: a zero would read as a measurement.
        outputTokens: undefined,
        latencyMs: now() - startedAt,
        estimatedCostMicros: estimateEmbeddingCostMicros(config, tokens),
      });

      if (values.length === 0) {
        return { status: "embedded", embeddings: [], call: measure(0) };
      }

      try {
        const result = await embedMany({
          model: embeddingModel,
          values: [...values],
          // The queue owns retries, for `call.ts`'s reason: three tries inside
          // one step are three charges reported as one call.
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(config.timeoutMs),
        });

        const wrong = result.embeddings.find(
          (embedding) => embedding.length !== embeddingDimensions,
        );

        if (wrong) {
          return {
            status: "failed",
            error:
              `${config.model} returned ${wrong.length} numbers per embedding and this ` +
              `database stores ${embeddingDimensions}. Set AI_EMBEDDING_MODEL to a model ` +
              `of that width, such as text-embedding-3-small.`,
            call: measure(result.usage?.tokens),
          };
        }

        return {
          status: "embedded",
          embeddings: result.embeddings,
          call: measure(result.usage?.tokens),
        };
      } catch (error) {
        if (APICallError.isInstance(error) || RetryError.isInstance(error) || isAbort(error)) {
          return { status: "failed", error: messageOf(error), call: measure() };
        }

        // Ours. See the header: a bug reported as a provider failure would
        // leave the pre-filter passing everything through for ever, quietly.
        throw error;
      }
    },
  };
}
