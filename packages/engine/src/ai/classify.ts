/**
 * One post, one monitor, one model call.
 *
 * Correctness-critical, and for a reason docs/testing.md spells out: a model
 * error must leave the post unclassified and retryable. The narrow catch that
 * makes that true is in `call.ts`, which US-010 lifted out when the query
 * generator became its second caller. `classify.test.ts` still drives every
 * one of its branches from here, because this is the entry point production
 * uses, and a catch tested only through its own unit is a catch nobody has
 * watched fail where it matters.
 */

import type { LanguageModel } from "ai";
import { generateStructured, type ModelCall } from "./call.js";
import { type Classification, classificationSchema, leadScore } from "./classification.js";
import type { AiConfig, AiProvider } from "./config.js";
import {
  buildSystemPrompt,
  buildUserPrompt,
  type MonitorProfile,
  type PostForClassification,
} from "./prompt.js";
import { createModel } from "./provider.js";

export type { ModelCall } from "./call.js";

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

export function createClassifier({ config, model, now = Date.now }: ClassifierOptions): Classifier {
  // Built once. Creating a provider per post would re-read the key and build a
  // fetch client for every one of them.
  const languageModel = model ?? createModel(config);

  return {
    provider: config.provider,
    model: config.model,

    async classify({ monitor, post }: ClassifyRequest): Promise<ClassificationOutcome> {
      const result = await generateStructured({
        model: languageModel,
        config,
        schema: classificationSchema,
        schemaName: "intent_classification",
        schemaDescription: "How well this post matches the monitor",
        system: buildSystemPrompt(monitor),
        prompt: buildUserPrompt(post),
        now,
      });

      if (result.status !== "ok") return result;

      return {
        status: "scored",
        classification: result.object,
        score: leadScore(result.object),
        call: result.call,
      };
    },
  };
}
