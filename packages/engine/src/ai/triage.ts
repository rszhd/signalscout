/**
 * One item, one monitor, one cheap model call, one word back.
 *
 * **Correctness-critical: a lead deleted before anybody sees it.** This stage
 * decides what the classifier never reads. Every other failure in this
 * pipeline is visible — a bill, an error, a noisy inbox — and this one is not.
 * A post refused here leaves no match, no reason and no trace a person would
 * look at, so a bug that refuses everything looks exactly like a quiet week.
 *
 * The rule that makes that survivable is one line long and it is the whole
 * design: **only an explicit `no` drops.** A timeout, a refusal, prose instead
 * of JSON, a rate limit, an outage, an unreachable provider — every one of
 * them passes the item to the classifier. `triage.test.ts` drives each branch,
 * and the failure it exists to catch is a `catch` that starts returning `no`.
 *
 * `call.ts` already sorts a model's three outcomes, so this file adds no error
 * handling of its own. It maps two of those three to "keep going" and never
 * looks at the reason, which is why there is no branch here for a caller to
 * get wrong later.
 *
 * **There are two paths now, and the rule is the same on both.** US-230 added
 * an evaluation provider: a model that answers a typed question against a
 * shared state instead of reading a prompt. It reaches `evaluateChoice` rather
 * than `generateStructured`, and the same three outcomes come back, so the
 * mapping above is unchanged.
 *
 * The evaluation path does one thing the other cannot. An evaluation model
 * reports how sure it is, and **a `no` it is unsure of is not an explicit
 * `no`**, so it keeps. US-229 measured the two leads a weaker rule deleted at
 * confidence 0.13 and 0.25, against 0.64 to 0.86 for the six it kept. The
 * floor is the same rule this file already lives by, one step further out.
 */

import type { LanguageModel } from "ai";
import { z } from "zod";
import { evaluateChoice, generateStructured, type ModelCall } from "./call.js";
import { type AiConfig, type AiProvider, isEvaluationProvider } from "./config.js";
import type { EvaluationModelInstance } from "./provider.js";
import { createEvaluationModel, createModel } from "./provider.js";
import {
  buildTriageEvaluationState,
  buildTriageSystemPrompt,
  buildTriageUserPrompt,
  type ItemForTriage,
  type MonitorProfile,
  type TriageVerdict,
  triageEvaluationCriteria,
  triageEvaluationInstructions,
  triageVerdicts,
} from "./triage-prompt.js";

export type { ItemForTriage, TriageVerdict } from "./triage-prompt.js";

/**
 * One field, and no reasons.
 *
 * The classifier's schema refuses a reason that only restates a score. There
 * is nothing to restate here and nothing to show a person, so the cheapest
 * honest answer is the whole answer. Adding "why" would cost about as much as
 * the rest of the call.
 */
export const triageSchema = z.object({
  verdict: z
    .enum(triageVerdicts)
    .describe("yes if this author could be a person to reach, no if plainly not, maybe if unclear"),
});

/**
 * What triage decided, and whether the item goes on.
 *
 * `kept` is a separate field from `verdict` on purpose. Every caller wants the
 * question "does this go to the classifier?" answered once, here, rather than
 * re-deriving `verdict !== "no"` at each call site — because the site that
 * gets it wrong is the one that drops silently. `verdict` is null when no
 * answer came back, and `kept` is true in every one of those cases.
 */
export interface TriageOutcome {
  readonly kept: boolean;
  readonly verdict: TriageVerdict | null;
  /** How the call ended, for the ledger. The same three words `call.ts` uses. */
  readonly status: "scored" | "rejected" | "failed";
  /** The provider's message, when there was one. Recorded, never acted on. */
  readonly error?: string;
  readonly call: ModelCall;
}

export interface TriageRequest {
  readonly monitor: MonitorProfile;
  readonly post: ItemForTriage;
}

export interface Triager {
  readonly provider: AiProvider;
  readonly model: string;
  triage(request: TriageRequest): Promise<TriageOutcome>;
}

export interface TriagerOptions {
  readonly config: AiConfig;
  /** Overrides the model the config names. A test passes a mock; nothing else does. */
  readonly model?: LanguageModel;
  /** The same, for a provider that evaluates rather than converses. US-230. */
  readonly evaluationModel?: EvaluationModelInstance;
  /**
   * How sure an evaluation model must be before its `no` drops the item.
   * US-230.
   *
   * Only an evaluation model reports this, so only that path reads it. The
   * default is 0.6: US-229 measured the leads a weaker rule deleted at 0.13
   * and 0.25, and the six it kept between 0.64 and 0.86.
   */
  readonly confidenceFloor?: number;
  readonly now?: () => number;
}

/** The default `confidenceFloor`. US-229 measured it; US-230 ships it. */
export const defaultTriageConfidenceFloor = 0.6;

export function createTriager({
  config,
  model,
  evaluationModel,
  confidenceFloor = defaultTriageConfidenceFloor,
  now = Date.now,
}: TriagerOptions): Triager {
  const evaluates = isEvaluationProvider(config.provider);

  // Built once, for the reason `classify.ts` gives: a provider per item would
  // re-read the key and build a fetch client for every one of them. Only the
  // path in use is built, so a chat provider never constructs an evaluation
  // client and a missing key is reported for the provider actually configured.
  const languageModel = evaluates ? undefined : (model ?? createModel(config));
  const evaluator = evaluates ? (evaluationModel ?? createEvaluationModel(config)) : undefined;

  /**
   * The evaluation path. US-230.
   *
   * The same rule as below, with one addition the other path cannot make: a
   * `no` the model is unsure of is not an explicit `no`, so it keeps. Every
   * other outcome — a refusal, a timeout, a rounding tie the SDK rejects, an
   * answer of the wrong kind — reaches the same `kept: true` the header
   * comment is about.
   */
  async function triageByEvaluation({ monitor, post }: TriageRequest): Promise<TriageOutcome> {
    const result = await evaluateChoice({
      model: evaluator as EvaluationModelInstance,
      config,
      state: buildTriageEvaluationState(monitor, post),
      instructions: triageEvaluationInstructions,
      criteria: triageEvaluationCriteria,
      now,
    });

    if (result.status !== "ok") {
      return {
        kept: true,
        verdict: null,
        status: result.status,
        error: result.error,
        call: result.call,
      };
    }

    const { choice, confidence } = result.answer;

    // A choice outside the three is the model answering something else. It is
    // not evidence about the author, so the item goes on.
    if (!(triageVerdicts as readonly string[]).includes(choice)) {
      return {
        kept: true,
        verdict: null,
        status: "rejected",
        error: `The model answered "${choice}", which is not one of ${triageVerdicts.join(", ")}.`,
        call: result.call,
      };
    }

    const verdict = choice as TriageVerdict;
    const sure = confidence !== undefined && confidence >= confidenceFloor;

    return { kept: verdict !== "no" || !sure, verdict, status: "scored", call: result.call };
  }

  return {
    provider: config.provider,
    model: config.model,

    async triage(request: TriageRequest): Promise<TriageOutcome> {
      if (evaluates) return triageByEvaluation(request);

      const { monitor, post } = request;
      const result = await generateStructured({
        model: languageModel as LanguageModel,
        config,
        schema: triageSchema,
        schemaName: "triage_verdict",
        schemaDescription: "Whether the careful model should read this item",
        system: buildTriageSystemPrompt(monitor),
        prompt: buildTriageUserPrompt(post),
        now,
      });

      if (result.status !== "ok") {
        // The model was not reached, or answered badly. Neither is evidence
        // about the author, so the item goes on. This is the branch the
        // header comment is about: it must never return `kept: false`.
        return {
          kept: true,
          verdict: null,
          status: result.status,
          error: result.error,
          call: result.call,
        };
      }

      const { verdict } = result.object;

      return { kept: verdict !== "no", verdict, status: "scored", call: result.call };
    },
  };
}
