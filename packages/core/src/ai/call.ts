/**
 * One structured call to the model, and what it cost.
 *
 * Correctness-critical, for the reason docs/testing.md gives about broad
 * catches. A model error must leave the caller's work undone and retryable,
 * and the `catch` that makes that true is exactly where a programming error
 * would hide. If it swallowed one, nothing would ever be scored, and the empty
 * inbox would read as a quiet day rather than a broken product.
 *
 * So the catch here is narrow. Errors the AI SDK raises for the model's own
 * behaviour become an outcome; everything else is rethrown, reaches the queue,
 * and fails the job loudly.
 *
 * This lives apart from `classify.ts` because US-010 added a second caller.
 * The classifier scores a post and the query generator writes a monitor's
 * search queries, and both have to tell "the model answered badly" apart from
 * "the model was not reached". Two copies of that decision would agree on the
 * day they were written and disagree later, and the second copy would be the
 * one nobody had watched fail. `classify.test.ts` drives every branch below
 * through the classifier, which is how the second caller inherits evidence
 * rather than assurances.
 */

import type { LanguageModel } from "ai";
import { APICallError, generateObject, NoObjectGeneratedError, RetryError } from "ai";
import type { z } from "zod";
import type { AiConfig, AiProvider } from "./config.js";
import { estimateCostMicros } from "./provider.js";

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
 * Three outcomes, and only the first carries an answer.
 *
 * `rejected` and `failed` both mean "nothing usable came back"; they are
 * separate because they need different answers from a person. `rejected` is
 * the model answering badly — a refusal, prose instead of JSON, a score of
 * 150 — and points at the prompt or the model. `failed` is not reaching the
 * model at all, and points at the key, the network or the provider.
 */
export type StructuredResult<Value> =
  | { readonly status: "ok"; readonly object: Value; readonly call: ModelCall }
  | { readonly status: "rejected"; readonly error: string; readonly call: ModelCall }
  | { readonly status: "failed"; readonly error: string; readonly call: ModelCall };

export interface StructuredCallOptions<Value> {
  readonly model: LanguageModel;
  readonly config: AiConfig;
  readonly schema: z.ZodType<Value>;
  /** Names the tool the provider is asked to fill in. Some providers show it. */
  readonly schemaName: string;
  readonly schemaDescription: string;
  readonly system: string;
  readonly prompt: string;
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

export async function generateStructured<Value>({
  model,
  config,
  schema,
  schemaName,
  schemaDescription,
  system,
  prompt,
  now = Date.now,
}: StructuredCallOptions<Value>): Promise<StructuredResult<Value>> {
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
      model,
      schema,
      schemaName,
      schemaDescription,
      system,
      prompt,
      // The queue owns retries. The AI SDK retrying inside the step would
      // spend three times on one provider outage and report it as one call,
      // and the job would still be told it failed once.
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(config.timeoutMs),
    });

    return { status: "ok", object: result.object, call: measure(result.usage) };
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

    // No answer: the provider refused the request, the network failed, or our
    // own timeout fired. Nothing was produced and nothing was billed that we
    // can measure.
    if (APICallError.isInstance(error) || RetryError.isInstance(error) || isAbort(error)) {
      return { status: "failed", error: messageOf(error), call: measure() };
    }

    // Anything else is ours. A TypeError here is a bug in this file, and a bug
    // that returns "the model failed" is a bug nobody finds.
    throw error;
  }
}
