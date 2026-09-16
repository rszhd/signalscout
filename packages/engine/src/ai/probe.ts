/**
 * One small call, to find out whether a key and a model work. US-080, US-087.
 *
 * A provider key is tested before it is stored — `SocialSource.validateCredentials`,
 * and docs/secrets.md says why. A model key was not, and the reason is in
 * US-068's log: no model provider here publishes a free probe, so validating
 * one on save spends somebody's money on a call they did not ask for.
 *
 * It is called from two places now, for two different questions. US-080's
 * button on a job card asks whether *this job's* key and model work. US-087
 * asks, as a key is added, whether the provider accepts it at all — the same
 * rule as a provider key, on the owner's decision, with the cost said out loud
 * on the dialog rather than avoided.
 *
 * The call is as small as the two shapes allow — one sentence in, one boolean
 * or one short vector back — and it is billed, so it is recorded in the ledger
 * like every other call.
 *
 * It answers three states rather than two, because they send a person to
 * different places:
 *
 * - `ok` — the provider accepted the key and the model answered.
 * - `answered` — the provider accepted the key and billed for it, and the
 *   answer was not the shape asked for. The key is fine; the model is the
 *   doubtful part.
 * - `failed` — nothing usable came back. The key, the model name, the network
 *   or the provider, and the provider's own sentence is carried out whole.
 */

import { z } from "zod";
import { generateStructured, type ModelCall } from "./call.js";
import type { AiConfig, EmbeddingConfig } from "./config.js";
import { createEmbedder } from "./embed.js";
import { createModel } from "./provider.js";

export type ModelProbeStatus = "ok" | "answered" | "failed";

export interface ModelProbe {
  readonly status: ModelProbeStatus;
  /** The provider's own words when something went wrong, never ours. */
  readonly error?: string;
  readonly call: ModelCall;
}

/** The smallest answer a schema can ask for. */
const readySchema = z.object({ ready: z.boolean() });

/**
 * Ask a chat model one question.
 *
 * The structured path rather than a plain completion, because that is the call
 * this product actually makes: a model that answers prose where a schema was
 * asked for will score nothing, and a test that passed on a plain completion
 * would have said the setup was fine.
 */
export async function probeChatModel(
  config: AiConfig,
  model = createModel(config),
): Promise<ModelProbe> {
  const result = await generateStructured({
    model,
    config,
    schema: readySchema,
    schemaName: "ready",
    schemaDescription: "Answer that you are ready.",
    system: "You are answering a connection test. Answer with ready: true and nothing else.",
    prompt: "Are you ready?",
  });

  if (result.status === "ok") return { status: "ok", call: result.call };
  if (result.status === "rejected") {
    return { status: "answered", error: result.error, call: result.call };
  }

  return { status: "failed", error: result.error, call: result.call };
}

/**
 * Ask an embedding model for one vector.
 *
 * There is no `answered` here for the reason `embed.ts` gives: an embedding
 * answers no schema, so either the numbers came back or the call failed.
 */
export async function probeEmbeddingModel(config: EmbeddingConfig): Promise<ModelProbe> {
  const outcome = await createEmbedder({ config }).embed(["a connection test"]);

  if (outcome.status === "embedded") return { status: "ok", call: outcome.call };

  return { status: "failed", error: outcome.error, call: outcome.call };
}
