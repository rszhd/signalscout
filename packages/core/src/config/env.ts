import { z } from "zod";
import { aiProviders, embeddingProviders } from "../ai/config.js";
import { encryptionKeyIsWellFormed } from "../secrets/cipher.js";

/**
 * Every environment variable the application reads is declared here, once.
 * `.env.example` is the human-readable copy of this schema and must match it.
 */
const booleanFromEnv = z.enum(["true", "false"]).transform((value) => value === "true");

/**
 * `.env.example` is committed with blank values, and `pnpm dev` copies it. A
 * variable that is present and empty means the same as an absent one, so it
 * has to read that way rather than failing a minimum length.
 */
function blankIsUnset<Schema extends z.ZodType>(schema: Schema) {
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
const aiFields = {
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
};

export const aiEnvSchema = z.object(aiFields);

const notificationFields = {
  SMTP_HOST: blankIsUnset(z.string().min(1).optional()),
  SMTP_PORT: blankIsUnset(z.coerce.number().int().min(1).max(65535).default(587)),
  SMTP_SECURE: blankIsUnset(booleanFromEnv.default(false)),
  SMTP_USER: blankIsUnset(z.string().min(1).optional()),
  SMTP_PASSWORD: blankIsUnset(z.string().min(1).optional()),
  SMTP_FROM: blankIsUnset(z.email().optional()),
  WEBHOOK_SIGNING_SECRET: blankIsUnset(z.string().min(32).optional()),
};

export const notificationEnvSchema = z.object(notificationFields);
export type NotificationEnv = z.infer<typeof notificationEnvSchema>;
export function loadNotificationEnv(
  source: Record<string, string | undefined> = process.env,
): NotificationEnv {
  return notificationEnvSchema.parse(source);
}

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z.string().min(1),

  /**
   * The key that encrypts a stored credential, base64 of 32 bytes.
   *
   * Optional, and that is deliberate. Every instance today reads its source
   * keys from this same environment, and an environment variable needs no
   * encryption: it is already outside the database and outside git. Demanding
   * a key for a table nothing writes would only make `pnpm dev` fail on a
   * clean checkout.
   *
   * It stops being optional the moment a credential is in the database.
   * `assertStoredCredentialsAreReadable` runs at boot, decrypts every stored
   * row, and refuses to start if it cannot — so a missing or changed key is
   * found before the first poll rather than during it.
   *
   * The shape is checked here whenever a value is present, because a truncated
   * paste is the common mistake and it must not survive to the first encrypt.
   */
  ENCRYPTION_KEY: blankIsUnset(
    z
      .string()
      .refine((value) => encryptionKeyIsWellFormed(value), {
        message: "must be base64 of exactly 32 bytes. Generate one with `openssl rand -base64 32`.",
      })
      .optional(),
  ),

  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  /**
   * true  — the worker runs inside the API process. One container, ~120 MB.
   * false — the worker runs as a second container from the same image.
   */
  WORKER_IN_PROCESS: booleanFromEnv.default(true),

  /** Absolute path to the built UI. Empty means "resolve next to the API build". */
  WEB_DIST_PATH: z.string().optional(),

  ...aiFields,
  ...notificationFields,
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parse and validate the environment. Throws with a readable list of problems
 * rather than letting a missing variable surface as `undefined` at 02:00.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${problems}`);
  }

  return result.data;
}

/**
 * The model settings alone.
 *
 * The worker builds its classifier from these before it has any use for the
 * rest, and a self-hoster who has not set one of them should not be told about
 * DATABASE_URL.
 */
export function loadAiEnv(source: Record<string, string | undefined> = process.env) {
  return aiEnvSchema.parse(source);
}
