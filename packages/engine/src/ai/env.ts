import { z } from "zod";
import { aiProviders, embeddingProviders } from "./config.js";

/**
 * The model settings as environment variables, declared once.
 *
 * `config/env.ts` in `packages/pipeline` spreads `aiFields` into the whole
 * application schema, so there is still one declaration of each variable and
 * `.env.example` still has one thing to match. They are here because the
 * capture scripts parse them without a database or the rest of the settings,
 * and because "which variables configure a model" is the engine's to say.
 * Reading the environment is not: nothing here reads a process variable.
 */
export const booleanFromEnv = z.enum(["true", "false"]).transform((value) => value === "true");

/**
 * `.env.example` is committed with blank values, and `pnpm dev` copies it. A
 * variable that is present and empty means the same as an absent one, so it
 * has to read that way rather than failing a minimum length.
 */
export function blankIsUnset<Schema extends z.ZodType>(schema: Schema) {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    schema,
  );
}

/**
 * The model settings, declared apart from the rest only so that the worker can
 * read them without a DATABASE_URL. They are part of `envSchema` below, so
 * there is still one declaration of each variable.
 */
export const aiFields = {
  /**
   * The model that scores posts, and the key it is reached with.
   *
   * One provider, chosen here and nowhere else. `ollama` needs no key and
   * reaches http://localhost:11434/v1 unless AI_BASE_URL says otherwise, so
   * switching to a local model is these two variables and no code change.
   */
  AI_PROVIDER: blankIsUnset(z.enum(aiProviders).default("anthropic")),
  AI_MODEL: blankIsUnset(z.string().min(1).default("claude-haiku-4-5")),
  AI_API_KEY: blankIsUnset(z.string().min(1).optional()),
  AI_BASE_URL: blankIsUnset(z.string().min(1).optional()),

  /** How long one classification may take. A local model is slower than an API. */
  AI_TIMEOUT_MS: blankIsUnset(z.coerce.number().int().min(1_000).default(30_000)),

  /**
   * Micro-dollars per million tokens, for a model whose price we do not carry.
   * Without them an unlisted model records no cost rather than a guessed one.
   */
  AI_INPUT_PRICE_MICROS: blankIsUnset(z.coerce.number().int().min(0).optional()),
  AI_OUTPUT_PRICE_MICROS: blankIsUnset(z.coerce.number().int().min(0).optional()),

  /**
   * The model that embeds posts for US-008's pre-filter, and the key it is
   * reached with.
   *
   * Unset means the pre-filter runs its free keyword stage and sends
   * everything that survives to the classifier. That is the expensive
   * direction and the safe one: nothing is dropped by a stage that is not
   * running. Anthropic has no embedding endpoint, so a deployment on our
   * default provider has to name another one here to get the second stage.
   *
   * `AI_EMBEDDING_MODEL` must name a model of `embeddingDimensions` numbers,
   * because that is the width the column stores. A narrower one is refused
   * with a message rather than written.
   */
  AI_EMBEDDING_PROVIDER: blankIsUnset(z.enum(embeddingProviders).optional()),
  AI_EMBEDDING_MODEL: blankIsUnset(z.string().min(1).optional()),
  AI_EMBEDDING_API_KEY: blankIsUnset(z.string().min(1).optional()),
  AI_EMBEDDING_BASE_URL: blankIsUnset(z.string().min(1).optional()),

  /**
   * Micro-dollars per million tokens for the embedding model.
   *
   * There is no built-in table for these, so an embedding call records no cost
   * until this is set. Null on a bill page reads as "we cannot say", which is
   * true, and a guessed price would read as a measurement.
   */
  AI_EMBEDDING_PRICE_MICROS: blankIsUnset(z.coerce.number().int().min(0).optional()),

  /**
   * The model that triages, before the classifier is paid to read anything.
   *
   * Unset is a supported answer and it means the classifier's own model, not
   * "no triage". US-030's stage always runs, because on a comment it is the
   * only paid stage in front of the classifier and a stage that is off drops
   * nothing but saves nothing either.
   *
   * Naming a cheaper model here is where the rest of the saving is taken. Most
   * of it comes from the answer being one word instead of five scores and four
   * reasons, and that happens whatever the model.
   *
   * The prices are separate from `AI_INPUT_PRICE_MICROS` and fall back to it
   * only while no triage model is named. A cheaper model priced at the
   * classifier's rate would report a saving that did not happen.
   */
  /**
   * The model that writes a reply draft. US-070.
   *
   * Unset means the classifier's, the way triage's does. It is its own setting
   * because the two jobs are not the same: scoring reads carefully and answers
   * in numbers, and a draft carries somebody's name into another person's
   * conversation. On some providers those are different models.
   *
   * The prices are separate from `AI_INPUT_PRICE_MICROS` and fall back to it
   * only while no draft model is named. A draft billed at the classifier's rate
   * would misreport what it cost, and that figure is shown to the person who
   * pressed the button.
   */
  AI_DRAFT_TIMEOUT_MS: blankIsUnset(z.coerce.number().int().min(1_000).optional()),
  AI_DRAFT_PROVIDER: blankIsUnset(z.enum(aiProviders).optional()),
  AI_DRAFT_MODEL: blankIsUnset(z.string().min(1).optional()),
  AI_DRAFT_API_KEY: blankIsUnset(z.string().min(1).optional()),
  AI_DRAFT_BASE_URL: blankIsUnset(z.string().min(1).optional()),
  AI_DRAFT_INPUT_PRICE_MICROS: blankIsUnset(z.coerce.number().int().min(0).optional()),
  AI_DRAFT_OUTPUT_PRICE_MICROS: blankIsUnset(z.coerce.number().int().min(0).optional()),

  /**
   * The model that writes a monitor's search plan. US-269.
   *
   * Unset means the classifier's, the way the draft's does. The plan is
   * written once per monitor and decides every post it will collect, so this
   * is the one job worth a dearer model than the classifier's.
   */
  AI_PLAN_PROVIDER: blankIsUnset(z.enum(aiProviders).optional()),
  AI_PLAN_MODEL: blankIsUnset(z.string().min(1).optional()),
  AI_PLAN_API_KEY: blankIsUnset(z.string().min(1).optional()),
  AI_PLAN_BASE_URL: blankIsUnset(z.string().min(1).optional()),
  AI_PLAN_INPUT_PRICE_MICROS: blankIsUnset(z.coerce.number().int().min(0).optional()),
  AI_PLAN_OUTPUT_PRICE_MICROS: blankIsUnset(z.coerce.number().int().min(0).optional()),

  /**
   * Whether the worker triages at all. US-177.
   *
   * "on" is the default and every deployment's answer until one measures
   * otherwise. "off" sends every post the free stages kept straight to the
   * classifier, and is the right answer when triage and classification run
   * the same model: `triage-prompt.ts` measured a triage answer at 80 output
   * tokens against a classification's 95 and the same cost per call, so the
   * stage is not cheap in itself and the whole saving is the price gap between
   * two models. With no gap it costs 37% more and its mistakes are still
   * permanent.
   */
  AI_TRIAGE: blankIsUnset(z.enum(["on", "off"]).default("on")),
  AI_TRIAGE_PROVIDER: blankIsUnset(z.enum(aiProviders).optional()),
  AI_TRIAGE_MODEL: blankIsUnset(z.string().min(1).optional()),
  AI_TRIAGE_API_KEY: blankIsUnset(z.string().min(1).optional()),
  AI_TRIAGE_BASE_URL: blankIsUnset(z.string().min(1).optional()),
  AI_TRIAGE_INPUT_PRICE_MICROS: blankIsUnset(z.coerce.number().int().min(0).optional()),
  AI_TRIAGE_OUTPUT_PRICE_MICROS: blankIsUnset(z.coerce.number().int().min(0).optional()),
};

export const aiEnvSchema = z.object(aiFields);
