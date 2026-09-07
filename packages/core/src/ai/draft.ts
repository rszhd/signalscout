/**
 * The drafter: one match in, one reply out, for a person to edit and post.
 *
 * US-040. Modelled on `classify.ts` and sharing its three outcomes, because
 * the caller needs the same three answers — the model wrote something, the
 * model answered badly, or the model was not reached — and a screen has to say
 * which.
 *
 * **Nothing here runs on a schedule.** No draft is written at poll time, at
 * classify time, or in advance. A draft costs a model call and a person's
 * reputation, and both should be spent on purpose: one button, one match, one
 * call. That is why this file exports no step and is not wired into the worker.
 */
import type { LanguageModel } from "ai";
import { generateStructured, type ModelCall } from "./call.js";
import type { AiConfig, AiProvider } from "./config.js";
import type { MonitorProfile, PostForClassification } from "./prompt.js";
import { createModel } from "./provider.js";
import {
  buildReplySystemPrompt,
  buildReplyUserPrompt,
  type Draft,
  draftSchema,
  draftSchemaDescription,
  draftSchemaName,
  type ReplyVoice,
} from "./reply.js";

export type { ModelCall } from "./call.js";

/**
 * Three outcomes, and only the first gives a person something to post.
 *
 * `rejected` and `failed` are separate for the reason `classify.ts` gives:
 * the first points at the prompt or the model and the second at the key, the
 * network or the provider. Here there is a third reading of `rejected` worth
 * keeping: **a model that declines to write a sales reply is telling the
 * person something**, and that refusal should reach the screen as itself
 * rather than as "something went wrong".
 */
export type DraftOutcome =
  | { readonly status: "ok"; readonly draft: Draft; readonly call: ModelCall }
  | { readonly status: "rejected"; readonly error: string; readonly call: ModelCall }
  | { readonly status: "failed"; readonly error: string; readonly call: ModelCall };

export interface DraftRequest {
  readonly monitor: MonitorProfile;
  readonly post: PostForClassification;
  /** The project's saved instruction, when it has one. */
  readonly voice?: ReplyVoice;
}

export interface Drafter {
  readonly provider: AiProvider;
  readonly model: string;
  draft(request: DraftRequest): Promise<DraftOutcome>;
}

export interface CreateDrafterOptions {
  readonly config: AiConfig;
  /** Injected by tests. Nothing else passes one. */
  readonly languageModel?: LanguageModel;
}

/**
 * A drafter on the classifier's own configuration.
 *
 * No separate model setting, deliberately. The classifier is a strict reader
 * and a draft is a writer, so the best model for one may not be the best for
 * the other — but adding a setting before somebody wants it is a knob nobody
 * turns and a support question everybody asks. `ai/config.ts` has the fallback
 * shape ready when that day comes.
 */
export function createDrafter({ config, languageModel }: CreateDrafterOptions): Drafter {
  const model = languageModel ?? createModel(config);

  return {
    provider: config.provider,
    model: config.model,

    async draft({ monitor, post, voice }: DraftRequest): Promise<DraftOutcome> {
      const result = await generateStructured({
        model,
        config,
        schema: draftSchema,
        schemaName: draftSchemaName,
        schemaDescription: draftSchemaDescription,
        system: buildReplySystemPrompt(monitor, voice),
        prompt: buildReplyUserPrompt(post),
      });

      if (result.status === "ok") {
        return { status: "ok", draft: result.object, call: result.call };
      }

      return result;
    },
  };
}
