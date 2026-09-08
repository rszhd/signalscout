/**
 * Better Auth, wired to this instance's own Postgres. US-017.
 *
 * Correctness-critical: every route that is not the login itself is behind
 * this. The failure shape is an instance on a public address whose inbox and
 * provider keys are readable by whoever finds the port, which is the reason
 * the ticket exists.
 *
 * **No external identity provider.** A self-hosted tool that needs a hosted
 * one is not self-hosted, so sessions live in the same database as the
 * monitors they let a person read. STACK.md, *The stack*.
 *
 * **This file is the only place that knows what a user is.** Everything
 * downstream knows a text id and no more — which is what made `singleUserId` a
 * value to replace rather than a shape to change.
 *
 * `packages/core` imports neither Fastify nor React, and Better Auth is
 * neither: it answers a `Request` with a `Response`, and `apps/api` is what
 * turns a Fastify request into one.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { eq, sql } from "drizzle-orm";
import { seedPresetReplyVoices } from "../ai/reply-prompts.js";
import { type BillingMode, startTrial } from "../billing/index.js";
import type { Database } from "../db/client.js";
import {
  accounts,
  feedback,
  monitors,
  projects,
  replyPrompts,
  sessions,
  users,
  verifications,
} from "../db/schema.js";
import type { Logger } from "../logger.js";
import { type SignupMode, unclaimedUserId } from "./user.js";

/** The instance `apps/api` mounts. Named so no signature carries the inferred type. */
export type Auth = ReturnType<typeof createAuth>;

/**
 * How long a session lives, and how often an active one is extended.
 *
 * Seven days rather than a month. This is a tool somebody opens to read an
 * inbox, so a week covers the way it is used, and the shorter the window the
 * less a stolen cookie is worth. An active session is rewritten once a day, so
 * daily use never meets the deadline and a laptop left in a hotel does.
 */
export const sessionMaxAgeSeconds = 60 * 60 * 24 * 7;
export const sessionRefreshAfterSeconds = 60 * 60 * 24;

/**
 * The password rule, stated once.
 *
 * Eight, and no character classes. A class rule mostly costs the person a
 * substitution they will make the same way everybody else does, and it buys
 * an attacker almost nothing. Eight rather than twelve is the owner's call:
 * this is a floor, not the advice, and the screen still says what it is.
 */
export const minimumPasswordLength = 8;

export interface CreateAuthOptions {
  readonly db: Database;
  /**
   * What signs a session cookie.
   *
   * Required, and there is deliberately no default. A shipped default secret
   * is a default password wearing another name: anybody holding the source
   * could mint a session for any instance running it.
   */
  readonly secret: string;
  /**
   * Where this instance answers, when it is behind a proxy that rewrites the
   * host. Undefined means "read it from the request", which is right for the
   * common install where one Fastify serves the UI and the API on one origin.
   */
  readonly baseUrl?: string | undefined;
  /**
   * Where the library's own messages go.
   *
   * Without this it writes to the console, so an instance's log is two formats
   * and only one of them is parseable. `redactedFields` covers ours; nothing
   * here is asked to log a secret.
   */
  readonly logger?: Logger;
  /**
   * Origins allowed to make a state-changing request, beyond this instance's
   * own address.
   *
   * Empty is right for the deployed shape, where one Fastify serves the UI and
   * the API on one origin and the browser's `Origin` already matches the host.
   * It is *not* right for `pnpm dev`: Vite serves the UI on 5173 and proxies
   * `/api` to 3000 with `changeOrigin`, so the request arrives with the host
   * rewritten to 3000 and the browser's own `Origin: http://localhost:5173`
   * intact. Better Auth compares the two, finds them different, and answers
   * `403 INVALID_ORIGIN` — a login that refuses every attempt on a developer's
   * machine while working perfectly in production.
   *
   * This is a list and not a switch. "Accept any origin" is what a cross-site
   * request forgery needs, and the check exists to stop another site posting
   * to this one with the browser's cookie attached.
   */
  readonly trustedOrigins?: readonly string[];
  /** `closed` unless this deployment says otherwise. See `signupModes`. */
  readonly signup?: SignupMode;
  /**
   * Whether this deployment charges. `off` unless it says otherwise. US-072.
   *
   * Only one thing here reads it: a new account gets its seven free days when
   * billing is on, and no row at all when it is off. A self-hosted instance
   * must not accumulate subscription rows for a gate that will never run.
   */
  readonly billing?: BillingMode;
}

/**
 * Is there an account yet?
 *
 * The whole first-run rule rests on this one question, so it is one query
 * against `users` and not a flag somebody has to remember to set. A flag can
 * disagree with the table; a count cannot.
 */
export async function accountExists(db: Database): Promise<boolean> {
  const [counted] = await db.select({ rows: sql<number>`count(*)::int` }).from(users);
  return (counted?.rows ?? 0) > 0;
}

/**
 * Is this the only account on the instance?
 *
 * Asked after a user row is written, so "the first account" means "the only one
 * there is". A count and not a flag: a flag can disagree with the table.
 */
export async function isOnlyAccount(db: Database, userId: string): Promise<boolean> {
  const rows = await db.select({ id: users.id }).from(users).limit(2);
  return rows.length === 1 && rows[0]?.id === userId;
}

/**
 * Give the first account everything that existed before it.
 *
 * Without this, upgrading an instance that already polls hides every monitor,
 * project, saved voice and verdict behind an id nobody can sign in as. The
 * rows are still there and the screens are empty, which reads as data loss and
 * is the worst way to meet a new login screen.
 *
 * Only the first account claims them. A second user is a person joining an
 * instance that already has an owner, and handing them the owner's inbox is
 * the opposite of what scoping is for.
 */
export async function claimUnownedRows(db: Database, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(projects).set({ userId }).where(eq(projects.userId, unclaimedUserId));
    await tx.update(monitors).set({ userId }).where(eq(monitors.userId, unclaimedUserId));
    await tx.update(replyPrompts).set({ userId }).where(eq(replyPrompts.userId, unclaimedUserId));
    await tx.update(feedback).set({ userId }).where(eq(feedback.userId, unclaimedUserId));
  });
}

/**
 * Build the auth instance.
 *
 * Two rules live in the hooks below rather than in configuration, and both are
 * things a static setting cannot say.
 */
export function createAuth({
  db,
  secret,
  baseUrl,
  logger,
  trustedOrigins = [],
  signup = "closed",
  billing = "off",
}: CreateAuthOptions) {
  return betterAuth({
    secret,
    baseURL: baseUrl,
    basePath: "/api/auth",
    trustedOrigins: [...trustedOrigins],

    ...(logger
      ? {
          logger: {
            log: (level, message, ...rest) => {
              const line = `[better-auth] ${message}`;
              if (level === "error") logger.error({ rest }, line);
              else if (level === "warn") logger.warn({ rest }, line);
              else if (level === "debug") logger.debug({ rest }, line);
              else logger.info({ rest }, line);
            },
          },
        }
      : {}),

    database: drizzleAdapter(db, {
      provider: "pg",
      usePlural: true,
      schema: { users, sessions, accounts, verifications },
    }),

    emailAndPassword: {
      enabled: true,
      minPasswordLength: minimumPasswordLength,
      /**
       * Nothing sends mail here, so nothing may depend on mail arriving. A
       * verification requirement with no transport is an instance nobody can
       * sign in to, and US-016's SMTP settings are the *product's* mail, which
       * a person configures after they are already inside.
       */
      requireEmailVerification: false,
      autoSignIn: true,
    },

    session: {
      expiresIn: sessionMaxAgeSeconds,
      updateAge: sessionRefreshAfterSeconds,
    },

    advanced: {
      /**
       * The cross-site check is on, and it is on because we said so.
       *
       * Better Auth's own default turns it off when `NODE_ENV` is `test`, and
       * that has two consequences. The suite cannot reach the branch, so the
       * refusal is asserted nowhere. And a deployment whose `NODE_ENV` is not
       * what its owner thinks would lose the protection silently — the login
       * still works, which is the whole problem with this class of fault.
       *
       * Stating it here makes the behaviour the same everywhere, and makes
       * `auth.test.ts` able to prove it.
       */
      disableOriginCheck: false,
    },

    databaseHooks: {
      user: {
        create: {
          /**
           * **Who may create an account.**
           *
           * Here rather than in `disableSignUp`, because half the answer is not
           * a setting: with signup closed it is whether the table is empty,
           * which changes once and without a restart. And here rather than in
           * the route, because every path that creates a user — the sign-up
           * endpoint, a social provider somebody enables later, an admin plugin
           * — goes through this hook, and only this hook.
           *
           * US-066 made the other half a setting. What has not changed is what
           * happens when it is closed: an open signup form on a public address
           * gives the instance away to whoever finds it first.
           */
          before: async () => {
            if (signup === "open") return;

            if (await accountExists(db)) {
              throw new APIError("FORBIDDEN", {
                message: "This instance already has an account. Sign in with it, or ask its owner.",
              });
            }
          },
          /**
           * The first account adopts the rows that predate it. See
           * `claimUnownedRows`: the alternative is an upgrade that looks like
           * data loss.
           *
           * **The first, and only the first.** With signup closed there can be
           * no second account, so this was true by accident. With signup open
           * there can be, and a second account inheriting the first one's
           * monitors would be the worst bug a shared instance could have. The
           * count is the guard, and it is one query.
           */
          after: async (user) => {
            if (await isOnlyAccount(db, user.id)) await claimUnownedRows(db, user.id);

            /**
             * The seven free days. US-072.
             *
             * Here rather than in the sign-up route, for this hook's own
             * reason: every path that creates a user passes through it, and an
             * account created any other way must not arrive without a trial —
             * a missing row reads as entitled, which is the free-for-ever
             * shape.
             *
             * It makes no network call. With no card there is nothing for
             * Stripe to hold, and registration must not be able to fail
             * because a payment provider is slow. `startTrial` never
             * overwrites, so this cannot hand a paying account a fresh week.
             *
             * Unlike the line above it, this runs for *every* account. The
             * first-account guard belongs to claiming rows, and confusing the
             * two would give the second person to register no trial at all.
             */
            if (billing !== "off") await startTrial(db, user.id);

            /**
             * The shipped reply voices, saved rather than offered. US-065.
             *
             * For every account, like the trial and unlike claiming: the
             * presets are the product's own answer to a blank box, and the
             * second person to register meets the same blank box as the
             * first.
             *
             * It runs *after* claiming, and that order is the whole reason a
             * conflict does nothing. An instance upgrading from before the
             * login already holds voices, one of them may be called "Short
             * comment", and the person who wrote it must keep their words.
             */
            await seedPresetReplyVoices(db, user.id);
          },
        },
      },
    },
  });
}
