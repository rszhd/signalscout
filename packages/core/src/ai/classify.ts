/**
 * One post, one monitor, one model call.
 *
 * Correctness-critical, and for a reason docs/testing.md spells out: a model
 * error must leave the post unclassified and retryable, and the `catch` that
 * makes that true is exactly where a programming error would hide. If it
 * swallowed one, nothing would ever be scored and the empty inbox would read
 * as a quiet day rather than a broken product.
 *
 * So the catch here is narrow. Errors the AI SDK raises for the model's own
 * behaviour become an outcome; everything else is rethrown, reaches the queue,
 * and fails the job loudly. `classify.test.ts` asserts both halves, and
 * `worker/classify.test.ts` asserts the happy path through the entry point the
 * worker actually calls.
 */

import type { LanguageModel } from "ai";
import { APICallError, generateObject, NoObjectGeneratedError, RetryError } from "ai";
import { type Classification, classificationSchema, leadScore } from "./classification.js";
import type { AiConfig, AiProvider } from "./config.js";
import {
  buildSystemPrompt,
  buildUserPrompt,
  type MonitorProfile,
  type PostForClassification,
} from "./prompt.js";
import { createModel, estimateCostMicros } from "./provider.js";

/** What one call spent and how long it took. Recorded whatever the outcome. */
export interface ModelCall {
  readonly provider: AiProvider;
  readonly model: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly latencyMs: number;
  /** Undefined when the model's price is not configured. Never guessed. */
  readonly estimatedCostMicros?: number;
}

/**
 * Three outcomes, and only the first writes anything.
 *
 * `rejected` and `failed` are both "leave the post unclassified"; they are
 * separate because they need different answers from a person. `rejected` is
 * the model answering badly — a refusal, prose instead of JSON, a score of
 * 150 — and points at the prompt or the model. `failed` is not reaching the
 * model at all, and points at the key, the network or the provider.
 */
export type ClassificationOutcome =
  | {
      readonly status: "scored";
      readonly classification: Classification;
      /** The weighted total the monitor's threshold is compared against. */
      readonly score: number;
      readonly call: ModelCall;
    }
  | { readonly status: "rejected"; readonly error: string; readonly call: ModelCall }
  | { readonly status: "failed"; readonly error: string; readonly call: ModelCall };

export interface ClassifyRequest {
  readonly monitor: MonitorProfile;
  readonly post: PostForClassification;
}

export interface Classifier {
  readonly provider: AiProvider;
  readonly model: string;
  classify(request: ClassifyRequest): Promise<ClassificationOutcome>;
}

export interface ClassifierOptions {
  readonly config: AiConfig;
  /** Overrides the model the config names. A test passes a mock; nothing else does. */
  readonly model?: LanguageModel;
  readonly now?: () => number;
}

/** An abort raised by our own timeout, rather than by the provider. */
function isAbort(error: unknown): boolean {
  const name = (error as { name?: unknown })?.name;
  return name === "AbortError" || name === "TimeoutError";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createClassifier({ config, model, now = Date.now }: ClassifierOptions): Classifier {
  // Built once. Creating a provider per post would re-read the key and build a
  // fetch client for every one of them.
  const languageModel = model ?? createModel(config);

  return {
    provider: config.provider,
    model: config.model,

    async classify({ monitor, post }: ClassifyRequest): Promise<ClassificationOutcome> {
      const startedAt = now();

      const measure = (usage?: { inputTokens?: number; outputTokens?: number }): ModelCall => ({
        provider: config.provider,
        model: config.model,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        latencyMs: now() - startedAt,
        estimatedCostMicros: usage ? estimateCostMicros(config, usage) : undefined,
      });

      try {
        const result = await generateObject({
          model: languageModel,
          schema: classificationSchema,
          schemaName: "intent_classification",
          schemaDescription: "How well this post matches the monitor",
          system: buildSystemPrompt(monitor),
          prompt: buildUserPrompt(post),
          // The queue owns retries. The AI SDK retrying inside the step would
          // spend three times on one provider outage and report it as one
          // call, and the job would still be told it failed once.
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(config.timeoutMs),
        });

        return {
          status: "scored",
          classification: result.object,
          score: leadScore(result.object),
          call: measure(result.usage),
        };
      } catch (error) {
        // The model answered, and the answer was not usable: prose around the
        // JSON, a refusal, or a value the schema refused.
        if (NoObjectGeneratedError.isInstance(error)) {
          return {
            status: "rejected",
            error: `${messageOf(error)} (finish reason: ${error.finishReason ?? "unknown"})`,
            call: measure(error.usage),
          };
        }

        // No answer: the provider refused the request, the network failed, or
        // our own timeout fired. Nothing was scored and nothing was billed
        // that we can measure.
        if (APICallError.isInstance(error) || RetryError.isInstance(error) || isAbort(error)) {
          return { status: "failed", error: messageOf(error), call: measure() };
        }

        // Anything else is ours. A TypeError here is a bug in this file, and a
        // bug that returns "the model failed" is a bug nobody finds.
        throw error;
      }
    },
  };
}
