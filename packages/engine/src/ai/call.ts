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

import type { JSONValue, LanguageModel } from "ai";
import {
  APICallError,
  experimental_evaluate,
  generateObject,
  InvalidResponseDataError,
  NoObjectGeneratedError,
  RetryError,
  TypeValidationError,
} from "ai";
import { z } from "zod";
import type { AiConfig, AiProvider } from "./config.js";
import type { EvaluationModelInstance } from "./provider.js";
import { estimateCostMicros, schemaGoesInThePrompt } from "./provider.js";

/**
 * Why a schema refused an answer, short enough to log and to show.
 *
 * Truncated because the cause can carry the model's whole reply, and an error
 * message that is a page long is one nobody reads. It is a diagnostic, not the
 * answer: the answer was refused.
 */
function schemaComplaint(cause: unknown): string | undefined {
  if (cause === undefined || cause === null) return undefined;

  // BUG-383. A validation error's message starts with the model's whole
  // answer, so the cut below kept the answer and lost the rule it broke. The
  // validator's own issues are the reason, so they are what is kept.
  const issues =
    TypeValidationError.isInstance(cause) && cause.cause instanceof z.ZodError
      ? cause.cause.issues
          .map((issue) => `${issue.path.join(".") || "answer"}: ${issue.message}`)
          .join("; ")
      : undefined;

  const message = issues ?? (cause instanceof Error ? cause.message : String(cause));
  const tidy = message.replace(/\s+/g, " ").trim();

  return tidy === "" ? undefined : tidy.slice(0, 400);
}

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

/**
 * The system prompt, with the schema added when the client cannot send it.
 *
 * Two things are added and each one is load-bearing. The **schema** is what
 * the compatible client drops, so without it the model is asked for JSON of no
 * particular shape. The **word "json"** is what DeepSeek refuses the call for
 * missing: `response_format: json_object` is rejected outright unless some
 * message contains it, which is also OpenAI's rule for that mode.
 *
 * The answer is still validated against the Zod schema afterwards, exactly as
 * it is for a provider that carries the schema natively. This makes the call
 * possible; it does not make the model obedient.
 */
export function systemForSchema<Value>(
  system: string,
  schema: z.ZodType<Value>,
  schemaDescription: string,
): string {
  return [
    system,
    "",
    `Answer with one JSON object and nothing else: no prose, no code fence. ${schemaDescription}`,
    "The object must be valid against this JSON schema:",
    JSON.stringify(z.toJSONSchema(schema)),
  ].join("\n");
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
      // BUG-018. The compatible client sends `json_object` and drops the
      // schema, so for those providers the schema goes in the prompt instead.
      system: schemaGoesInThePrompt(config.provider)
        ? systemForSchema(system, schema, schemaDescription)
        : system,
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
      // The schema's own complaint, when there is one. Without it the message
      // is "response did not match schema", which says that something was
      // wrong and never what: US-027's first capture run was refused by a
      // rule nobody could see, and the only way to find out was to add this.
      const detail = schemaComplaint(error.cause);

      return {
        status: "rejected",
        error:
          `${messageOf(error)} (finish reason: ${error.finishReason ?? "unknown"})` +
          (detail ? `: ${detail}` : ""),
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

/**
 * One evaluation question, asked of a model that answers questions rather than
 * prompts. US-230.
 *
 * `generateStructured`'s three outcomes, kept deliberately identical, because
 * `triage.ts` maps them to one decision and must not learn a fourth shape.
 * `ok` carries the chosen option, the distribution over every option and the
 * provider's own confidence. `rejected` is the model answering badly.
 * `failed` is not reaching it.
 *
 * **The near-tie is a `rejected`, not a crash.** TypeSafe rounds every
 * probability to two decimal places and the AI SDK checks that the chosen
 * option holds the highest one. Rounding can break that: an answer came back
 * `no` with `no` at 0.40 and `yes` at 0.41, and `experimental_evaluate` threw
 * `InvalidResponseDataError`. That is the model answering in a shape we cannot
 * use, which is what `rejected` means, and triage keeps the item either way.
 * Letting it escape as an unhandled throw would take the worker down on an
 * item the stage is meant to pass along.
 */
export interface EvaluationChoice {
  readonly choice: string;
  /** One entry per option, when the provider gives a distribution. */
  readonly probabilities?: Readonly<Record<string, number>>;
  /**
   * The provider's own confidence in the answer, when it reports one.
   *
   * **How concentrated the distribution is**, not the winning probability:
   * docs.typesafe.ai says a 0–1 score reflecting how tightly the probability
   * clusters on one option. So it is derived from `probabilities` rather than
   * measured separately, and a wide spread reads as low confidence however
   * high the leading option is. `triage.ts` uses it to decide whether a `no`
   * is explicit enough to drop a lead on.
   *
   * TypeSafe's own bands are above 0.9 to act unattended, below 0.5 to route
   * elsewhere, and a middle that wants a second look. Triage's floor sits in
   * that middle at 0.6, and their guidance is the same as US-229's: test the
   * threshold against your own domain rather than taking a published one.
   */
  readonly confidence?: number;
}

export type EvaluationResult =
  | { readonly status: "ok"; readonly answer: EvaluationChoice; readonly call: ModelCall }
  | { readonly status: "rejected"; readonly error: string; readonly call: ModelCall }
  | { readonly status: "failed"; readonly error: string; readonly call: ModelCall };

/**
 * What an evaluation model accepts as state or instructions.
 *
 * Narrower than `JSONValue`: the specification takes a string, an object or an
 * array, and not a bare `null`. Writing it out rather than reaching for the
 * SDK's internal type keeps this file's imports to the package's public
 * surface, which is the rule the rest of it follows.
 */
export type EvaluationInput = string | Readonly<Record<string, JSONValue>> | readonly JSONValue[];

export interface EvaluationCallOptions {
  readonly model: EvaluationModelInstance;
  readonly config: AiConfig;
  /** The shared state the question is asked about. */
  readonly state: EvaluationInput;
  /** What to decide. Objects and arrays are allowed as well as prose. */
  readonly instructions: EvaluationInput;
  /** Option name to description. The answer is one of these keys. */
  readonly criteria: Readonly<Record<string, EvaluationInput | null>>;
  readonly now?: () => number;
}

export async function evaluateChoice({
  model,
  config,
  state,
  instructions,
  criteria,
  now = Date.now,
}: EvaluationCallOptions): Promise<EvaluationResult> {
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
    const result = await experimental_evaluate({
      model,
      state,
      // The key is a literal so the SDK infers a Choice answer rather than a
      // union of all three question kinds. `verdict` is the only question this
      // file asks, and `triage.ts` is the only caller.
      questions: { verdict: { type: "choice" as const, instructions, criteria } },
      // The queue owns retries, for the reason `generateStructured` gives.
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(config.timeoutMs),
    });

    const answer = result.answers.verdict;

    // The question asked for a Choice, so anything else is the provider
    // answering a question we did not ask. It cannot happen against a
    // conforming provider and it is handled rather than asserted away: an
    // assertion here would throw, and a throw in this file takes the worker
    // down on an item triage is meant to pass along.
    if (answer === undefined || answer.type !== "choice") {
      return {
        status: "rejected",
        error: `The provider answered ${answer?.type ?? "nothing"} where a choice was asked for.`,
        call: measure(result.usage),
      };
    }

    const confidence = (
      result.providerMetadata?.typesafe as { confidence?: Record<string, number> } | undefined
    )?.confidence?.verdict;

    return {
      status: "ok",
      answer: {
        choice: answer.choice,
        probabilities: answer.probabilities,
        ...(confidence === undefined ? {} : { confidence }),
      },
      call: measure(result.usage),
    };
  } catch (error) {
    // The provider answered and the answer was not usable: a choice that is
    // not the highest-probability option after rounding, or a payload that
    // failed validation. Nothing about the author was learned either way.
    if (InvalidResponseDataError.isInstance(error) || TypeValidationError.isInstance(error)) {
      return { status: "rejected", error: messageOf(error), call: measure() };
    }

    // Nothing came back: the provider refused, the network failed, or our own
    // timeout fired.
    if (APICallError.isInstance(error) || RetryError.isInstance(error) || isAbort(error)) {
      return { status: "failed", error: messageOf(error), call: measure() };
    }

    // Anything else is ours, and `generateStructured` says why it is rethrown.
    throw error;
  }
}
