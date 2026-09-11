/**
 * Which model this build suggests for a job on a given provider. US-083.
 *
 * **This exists so that one pasted key is enough.** A person adds an API key,
 * marks it default, and the four jobs have to run on something. The provider
 * comes from the key. The model cannot: `AI_MODEL` is one name on one
 * provider, and asking somebody who has just said "this is my OpenAI key" to
 * type four model names is asking four questions that all follow from the
 * first.
 *
 * **A recommendation fills a blank and never corrects an answer.** It applies
 * to a job with no settings of its own. A model somebody typed stays as they
 * typed it, including a name this build has never heard of, for
 * `provider.ts`'s reason — an unlisted name is somebody's own and we are not
 * the authority on it.
 *
 * **Triage is cheaper than scoring on every provider here, and that is the
 * rule rather than a coincidence.** US-030 measured that the triage stage
 * saves money only through the price gap: on one model for both stages it
 * costs 48% *more* than not having it. A recommendation that paired two models
 * of the same price would ship that loss to everybody who never opened the
 * screen. `recommended.test.ts` asserts the gap for every provider in the
 * table, so a future addition cannot quietly close it.
 *
 * **Four providers are absent, each for a reason somebody measured.**
 * Anthropic has no embedding endpoint, which is why `embed` is asked of
 * `defaultEmbeddingModels` rather than answered here. OpenRouter resells four
 * hundred models at the upstream provider's prices, so we hold no price for
 * one and would be recommending a name we cannot cost. Ollama runs whatever
 * the machine has pulled, and there is no name to guess. DeepSeek has two
 * models and we can price neither: `provider.ts` says why, and a recommendation
 * we cannot cost is the one thing this table refuses to make.
 */
import type { AiTask } from "../db/schema.js";
import {
  type AiProvider,
  canEmbed,
  defaultEmbeddingModels,
  type EmbeddingProvider,
} from "./config.js";

/**
 * The chat model for each job, per provider.
 *
 * Every name here is priced in `provider.ts`, from the provider's own page.
 * That is not decoration: a recommendation we cannot price would put a job on
 * a model whose calls record no cost, and the spend page would go quiet on the
 * exact deployment that never configured anything.
 */
const chatRecommendations: Readonly<Record<string, Readonly<Partial<Record<AiTask, string>>>>> = {
  openai: {
    classify: "gpt-5.6-terra",
    triage: "gpt-5.6-luna",
    draft: "gpt-5.6-sol",
  },
  anthropic: {
    classify: "claude-sonnet-5",
    triage: "claude-haiku-4-5",
    draft: "claude-fable-5-1",
  },
  google: {
    classify: "gemini-3.5-flash",
    triage: "gemini-3.5-flash-lite",
    draft: "gemini-3.1-pro-preview",
  },
};

/**
 * What to run for this job on this provider, or null when we cannot say.
 *
 * Null is a supported answer and the screen says so: the job takes the
 * provider from the key and asks for a model. It is the honest answer for
 * Ollama, for OpenRouter, and for similarity on every provider but OpenAI.
 */
export function recommendedModelFor(provider: string, task: AiTask): string | null {
  // Asked of `config.ts` rather than repeated here. That table already carries
  // the width rule — a vector of the wrong size is a billed call thrown away —
  // and a second copy of it is how the two disagree.
  if (task === "embed") return defaultEmbeddingModels[provider as EmbeddingProvider] ?? null;

  return chatRecommendations[provider]?.[task] ?? null;
}

/**
 * Whether a job with no settings of its own can follow a key on this provider.
 *
 * **One question, asked in three places**, which is why it is a function and
 * not a condition written out where it is needed: the worker builds the
 * environment from it, the Models screen says what a job will run from it, and
 * the two disagreeing is a screen that promises a call the worker never makes.
 *
 * A key that names no provider always follows: it moves the bill and nothing
 * else, keeping the deployment's own provider and model. A provider we can
 * name no model for does not, because moving a job's provider without its
 * model is the pairing that fails every call.
 */
export function followsDefault(provider: string | null, task: AiTask): boolean {
  if (!provider) return true;
  if (task === "embed" && !canEmbed(provider as AiProvider)) return false;

  return recommendedModelFor(provider, task) !== null;
}

/** Every job this build can fill in for one provider. For a screen to show. */
export function recommendationsFor(provider: string): Partial<Record<AiTask, string>> {
  const embed = recommendedModelFor(provider, "embed");

  return {
    ...chatRecommendations[provider],
    ...(embed ? { embed } : {}),
  };
}

/** The providers this build has any recommendation for. Tests walk it. */
export const recommendedProviders = Object.keys(chatRecommendations);
