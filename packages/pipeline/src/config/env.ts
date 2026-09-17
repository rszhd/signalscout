import {
  aiEnvSchema,
  aiFields,
  blankIsUnset,
  booleanFromEnv,
  encryptionKeyIsWellFormed,
} from "@signalscout/engine";
import { z } from "zod";
import { type KeyPolicy, keyPolicies, keyPolicyOf } from "./machine-keys.js";
import { type SignupMode, signupModes } from "./signup.js";

/**
 * Every environment variable the pipeline reads is declared here, once. The
 * application's own schema — `apps/api/src/config/env.ts` — spreads
 * `pipelineFields` into its own, so each variable is still declared in one
 * place and `.env.example` still has one thing to match. US-153.
 */

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

/**
 * Signup alone, for a process that needs the rule and not the rest.
 *
 * The worker asks whether this deployment takes registrations, because that
 * decides whether the keys in `.env` are an account's to spend — US-081 — and
 * it must not have to parse a whole `DATABASE_URL` to find out. Same field,
 * same default, one definition.
 */
export const signupEnvSchema = z.object({
  AUTH_SIGNUP: blankIsUnset(z.enum(signupModes).default("closed")),
  MACHINE_KEYS: blankIsUnset(z.enum(keyPolicies).optional()),
});

export function loadSignupEnv(
  source: Record<string, string | undefined> = process.env,
): SignupMode {
  return signupEnvSchema.parse(source).AUTH_SIGNUP;
}

/**
 * Whose keys pay, for a process that needs that and not the rest. US-161.
 *
 * Resolved here rather than left to the caller, so the worker and the
 * application read one answer: `MACHINE_KEYS` when it is set, and otherwise
 * the default the signup mode implies.
 */
export function loadKeyPolicyEnv(
  source: Record<string, string | undefined> = process.env,
): KeyPolicy {
  return keyPolicyOf(signupEnvSchema.parse(source));
}

/**
 * The pipeline's own settings: the database, the log, the key that opens a
 * stored credential, the signup rule the worker reads to know whose keys
 * `.env` holds, and everything a model call or a notification needs.
 */
export const pipelineFields = {
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

  /**
   * Whether a stranger may create an account. US-066.
   *
   * `closed` is the default: the first run makes one account and the server
   * refuses every attempt after it. `open` is the cloud shape, where anybody
   * who reaches the login screen may register.
   *
   * The default is closed and not open, because every instance running today is
   * self-hosted. A version bump that silently began accepting registrations
   * would hand somebody's instance — their inbox, and provider keys that spend
   * their money — to whoever found the address first.
   */
  AUTH_SIGNUP: blankIsUnset(z.enum(signupModes).default("closed")),

  /**
   * Whose keys pay: `account` or `instance`. US-161.
   *
   * Empty means the default for the signup mode — `instance` when closed,
   * `account` when open — so nothing changes for a deployment that never
   * sets it. `instance` with signup open is the hosted shape that pays for
   * its accounts; `config/machine-keys.ts` says which rules still follow
   * signup there.
   */
  MACHINE_KEYS: blankIsUnset(z.enum(keyPolicies).optional()),

  ...aiFields,
  ...notificationFields,
};

export const pipelineEnvSchema = z.object(pipelineFields);

export type PipelineEnv = z.infer<typeof pipelineEnvSchema>;

/**
 * Parse the pipeline's settings, or say which one is wrong. The application
 * wraps this with its own fields; a script that runs the pipeline alone —
 * the live polls, the key rotation — reads this.
 */
export function loadPipelineEnv(
  source: Record<string, string | undefined> = process.env,
): PipelineEnv {
  return parseEnvironment(pipelineEnvSchema, source);
}

/** `safeParse`, with the issues laid out one per line for a person at a terminal. */
export function parseEnvironment<Schema extends z.ZodType>(
  schema: Schema,
  source: Record<string, string | undefined>,
): z.infer<Schema> {
  const result = schema.safeParse(source);

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
