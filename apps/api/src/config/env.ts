import { blankIsUnset, booleanFromEnv } from "@signalscout/engine";
import { parseEnvironment, pipelineFields } from "@signalscout/pipeline";
import { z } from "zod";
import { emailVerificationModes } from "../auth/verification.js";

/**
 * Every environment variable this application reads, once. The pipeline's
 * own settings come in through `pipelineFields`; what is declared here is
 * what makes this application this application — who may log in, whether
 * it charges, where it listens. `.env.example` is the human-readable copy of
 * this schema and must match it; `env-example.test.ts` says so.
 */
export const envSchema = z.object({
  ...pipelineFields,

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
   * Where this instance answers, for the links a notification carries. Not
   * derived from a request header: an address built from something the
   * caller controls is an address the caller chooses.
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
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parse and validate the environment. Throws with a readable list of problems
 * rather than letting a missing variable surface as `undefined` at 02:00.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return parseEnvironment(envSchema, source);
}
