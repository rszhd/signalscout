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
 */

import type { LanguageModel } from "ai";
import { z } from "zod";
import { generateStructured, type ModelCall } from "./call.js";
import type { AiConfig, AiProvider } from "./config.js";
import { createModel } from "./provider.js";
import {
  buildTriageSystemPrompt,
  buildTriageUserPrompt,
  type ItemForTriage,
  type MonitorProfile,
  type TriageVerdict,
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
  readonly now?: () => number;
}

export function createTriager({ config, model, now = Date.now }: TriagerOptions): Triager {
  // Built once, for the reason `classify.ts` gives: a provider per item would
  // re-read the key and build a fetch client for every one of them.
  const languageModel = model ?? createModel(config);

  return {
    provider: config.provider,
    model: config.model,

    async triage({ monitor, post }: TriageRequest): Promise<TriageOutcome> {
      const result = await generateStructured({
        model: languageModel,
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
