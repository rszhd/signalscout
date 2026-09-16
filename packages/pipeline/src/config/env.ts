import {
  aiEnvSchema,
  aiFields,
  blankIsUnset,
  booleanFromEnv,
  encryptionKeyIsWellFormed,
} from "@signalscout/engine";
import { z } from "zod";
import { type SignupMode, signupModes } from "../auth/user.js";
import { emailVerificationModes } from "../auth/verification.js";
import { billingModes } from "../billing/entitlement.js";

/**
 * Every environment variable the application reads is declared here, once.
 * `.env.example` is the human-readable copy of this schema and must match it.
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
});

export function loadSignupEnv(
  source: Record<string, string | undefined> = process.env,
): SignupMode {
  return signupEnvSchema.parse(source).AUTH_SIGNUP;
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

  /**
   * What signs a session cookie. US-017.
   *
   * Optional here and refused at boot, which is `ENCRYPTION_KEY`'s shape and
   * for the same reason: `.env.example` is committed with blank values and
   * `pnpm dev` copies it, so a required field would make a clean checkout fail
   * to parse its own example file.
   *
   * There is no default and there will not be one. A default signing secret is
   * a default password wearing another name — anybody holding this source could
   * mint a session for any instance running it. `startApi` says how to make one
   * and stops.
   *
   * Thirty-two characters, because the check that catches a real mistake is a
   * short paste rather than a weak one.
   */
  AUTH_SECRET: blankIsUnset(
    z
      .string()
      .min(32, {
        message: "must be at least 32 characters. Generate one with `openssl rand -base64 32`.",
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
   * Whether an address is proven before an account is used. US-092.
   *
   * `off` is the default: the address is taken as given, and a session starts
   * the moment the account exists. `required` sends a link and signs nobody in
   * until it is opened.
   *
   * Off rather than required, for `AUTH_SIGNUP`'s reason and one of its own.
   * Every instance running today is self-hosted, and most of them have no SMTP
   * at all — so a version bump that quietly began requiring a link would arrive
   * as a login that refuses the owner of a machine they run for themselves.
   *
   * Setting it to `required` makes the SMTP variables required, and the process
   * refuses to boot without them. `emailVerificationRequired` is that check,
   * and it exists because the half-configured state is the silent one: a login
   * that answers every account with a message about mail nobody sent.
   */
  AUTH_EMAIL_VERIFICATION: blankIsUnset(z.enum(emailVerificationModes).default("off")),

  /**
   * Origins allowed to sign in, besides this instance's own address.
   *
   * Comma separated. Leave it empty for the normal install, where one process
   * serves the UI and the API on one origin. Set it when the UI is served from
   * somewhere else — a separate static host, or a proxy that rewrites the host
   * without rewriting the browser's `Origin`.
   *
   * `pnpm dev` is exactly that shape, and it needs no entry here: the API adds
   * the Vite dev server itself when NODE_ENV is development.
   */
  AUTH_TRUSTED_ORIGINS: blankIsUnset(z.string().min(1).optional()),

  /**
   * Where this instance answers, when a proxy rewrites the host.
   *
   * Unset means "read it from the request", which is right whenever one
   * Fastify serves the UI and the API on one origin — the common install. Set
   * it when the browser's address and the one Fastify sees are different.
   */
  AUTH_URL: blankIsUnset(z.string().min(1).optional()),

  /**
   * The addresses allowed to read the admin view. US-111.
   *
   * Comma separated. Empty means nobody is an admin, which is the safe answer
   * for a self-hosted instance where the question never comes up. The admin
   * endpoint returns every account's data, so this list is the security
   * boundary and not a convenience.
   */
  ADMIN_EMAILS: blankIsUnset(z.string().min(1).optional()),

  /**
   * Whether this deployment charges for itself. US-072.
   *
   * `off` is the default and it is the self-hosted shape: no trial, no gate,
   * no payment provider, and every screen behaves exactly as it did before
   * billing existed. `stripe` is the hosted shape.
   *
   * Off rather than on, for `AUTH_SIGNUP`'s reason. Every instance running
   * today is self-hosted, and a version bump that quietly began refusing
   * writes on somebody's own machine would arrive as a release note nobody
   * read.
   *
   * Setting it to `stripe` makes the four variables below required, and the
   * process refuses to boot without them. The failure that check exists for is
   * the quiet one: an instance that charges nobody, where every screen works.
   */
  BILLING_MODE: blankIsUnset(z.enum(billingModes).default("off")),

  /** The Stripe key, price and webhook secret. Required when BILLING_MODE is stripe. */
  STRIPE_SECRET_KEY: blankIsUnset(z.string().min(1).optional()),
  STRIPE_PRICE_ID: blankIsUnset(z.string().min(1).optional()),
  STRIPE_WEBHOOK_SECRET: blankIsUnset(z.string().min(1).optional()),

  /**
   * Where this instance answers, for the addresses Stripe sends a person back
   * to. Required when BILLING_MODE is stripe, and not derived from a request
   * header: a return address built from something the caller controls is a
   * return address the caller chooses.
   */
  APP_URL: blankIsUnset(z.string().min(1).optional()),

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
