/**
 * Which plan an account is on, and therefore whose keys it spends. US-128.
 *
 * Correctness-critical, and the failure shape is money. Too loose and a
 * stranger who registered this morning polls five providers and classifies on a
 * model key, all of it on this instance's bill, with nothing on any screen to
 * say who spent it. Too strict and somebody who paid for the plan is asked for
 * a key they were told they would not need.
 *
 * **Every unknown reads as `own_keys`.** No subscription row, a Stripe price
 * this deployment does not recognise, a webhook that has not arrived yet, a row
 * written before the column existed: all of them mean the account spends its
 * own money. That direction is the whole design. `entitlementFor` fails the
 * other way — no row means entitled — and the two are not in tension: being
 * allowed to poll and being allowed to poll *on our keys* are different
 * questions, and only one of them arrives as an invoice.
 *
 * **The plan is read, never decided here.** The webhook writes the column from
 * the price Stripe names. Nothing else writes it, so a person cannot choose the
 * expensive plan by choosing it.
 */

import { and, eq, inArray } from "drizzle-orm";
import type { AiEnvironment } from "../ai/config.js";
import type { SignupMode } from "../auth/user.js";
import {
  accountModelEnvironment,
  providerKeyEnvironmentFor,
  spendsInstanceMoney,
} from "../config/machine-keys.js";
import type { Database } from "../db/client.js";
import { type SubscriptionPlan, subscriptions } from "../db/schema.js";
import { readProviderChoices } from "../sources/choices.js";
import type { ProviderChoices } from "../sources/types.js";
import type { BillingMode, SubscriptionRecord } from "./entitlement.js";
import { readSubscription } from "./store.js";

/**
 * The plan a stored row is on.
 *
 * `off` answers `own_keys` and the answer is never used: a deployment that does
 * not charge is self-hosted, and `machineKeysUsable` has already said yes to
 * every account on it because signup is closed. Answering here rather than
 * throwing keeps a caller from having to know that.
 */
export function planOf(
  mode: BillingMode,
  subscription: SubscriptionRecord | null,
): SubscriptionPlan {
  if (mode === "off") return "own_keys";
  return subscription?.plan ?? "own_keys";
}

/**
 * Which plan a Stripe price sells.
 *
 * A deployment that has named no keys-included price sells no keys-included
 * plan, so every price answers `own_keys`. A price that is neither of the two
 * configured ones answers `own_keys` as well, and the caller logs it: a price
 * created in the dashboard that nobody told this instance about must not be
 * guessed into the expensive plan.
 */
export function planForPrice(
  priceId: string | null,
  keysIncludedPriceId: string | undefined,
): SubscriptionPlan {
  if (!priceId || !keysIncludedPriceId) return "own_keys";
  return priceId === keysIncludedPriceId ? "keys_included" : "own_keys";
}

/**
 * One account's plan, read from the database.
 *
 * A primary-key lookup on one small table. It is asked per request in the API
 * and per job in the worker rather than cached at boot, and that is the point:
 * an account that stops paying for the plan stops spending our keys on the next
 * poll, not on the next restart.
 */
export async function readPlan(
  db: Database,
  userId: string,
  mode: BillingMode,
): Promise<SubscriptionPlan> {
  if (mode === "off") return "own_keys";
  return planOf(mode, await readSubscription(db, userId));
}

export interface AccountKeysOptions {
  readonly signup: SignupMode;
  readonly mode: BillingMode;
  /** The machine's own environment. Handed out per account, or not at all. */
  readonly environment?: Record<string, string | undefined>;
  /**
   * What one account may spend of ours in a month, where its plan lends the
   * keys. US-129. Undefined means this deployment lends nothing, which is every
   * self-hosted instance.
   */
  readonly capMicros?: number;
  /**
   * Which provider fetches each platform for an account whose plan lends the
   * keys. US-130. `lentProvidersFrom` reads it from the environment at boot.
   * Undefined means the deployment named nothing, which is every self-hosted
   * instance.
   */
  readonly lentProviders?: ProviderChoices;
}

/**
 * What one account may spend, as two functions of the owner.
 *
 * This is what a composition root builds now. US-081 asked its question once
 * per process and handed every layer a stripped environment; this asks it once
 * per request and per job, and hands the same layers the same shape. Nothing
 * below either one knows why a key is missing, which is what has kept the rule
 * in one file through two changes of meaning.
 *
 * **Asked per call rather than cached.** One primary-key lookup on a table with
 * one row per account. Caching it would be the cheaper thing and the wrong one:
 * an account that moves off the plan has to stop spending our keys on the next
 * poll, and a cache with the worker's lifetime would keep it spending until a
 * restart nobody scheduled.
 */
export interface AccountKeys {
  /** The provider-key environment this account's poll may read. */
  provider(userId: string): Promise<Record<string, string | undefined>>;
  /** The model environment this account's own settings are laid over. */
  model<E extends AiEnvironment>(userId: string, base: E): Promise<E>;
  /**
   * The plan itself, for the one caller that needs the answer and not the
   * environment: the worker caches a model client per account, and the cache
   * has to be keyed by the plan the client was built under.
   */
  plan(userId: string): Promise<SubscriptionPlan>;
  /**
   * What this account may still spend of ours this month, or null where the
   * money is its own. US-129.
   *
   * Here rather than in `budget/` because it is the same question this object
   * already answers — what one account may spend — and because the cap turns on
   * the plan, which nothing in `budget/` knows about.
   */
  cap(userId: string): Promise<number | null>;
  /**
   * Which provider fetches each platform for this account. US-130.
   *
   * An account spending its own keys answers with what it recorded on the
   * connections screen, exactly as `readProviderChoices` always has. An
   * account whose plan lends the keys answers with what the deployment named,
   * **and only that**: the owner decided in US-132 that such an account does
   * not choose its provider at all, so a row it recorded before moving onto
   * the plan is left in place and not read, and reading it again is what
   * leaving the plan does. Nothing is deleted.
   */
  choices(userId: string): Promise<ProviderChoices>;
  /**
   * Whether this account is spending money that is not its own. US-132.
   *
   * `spendsInstanceMoney` asked about one account: open signup and the plan
   * that lends the keys. It is what decides that a stored key, a stored
   * provider choice and stored model rows are not read while the account is
   * on the plan, and that the writes which would store them are refused. One
   * rule, asked per account, and reused rather than copied under a second
   * name.
   */
  spendsInstanceMoney(userId: string): Promise<boolean>;
}

export function accountKeys(
  db: Database,
  { signup, mode, environment = process.env, capMicros, lentProviders = {} }: AccountKeysOptions,
): AccountKeys {
  return {
    async provider(userId) {
      return providerKeyEnvironmentFor(signup, await readPlan(db, userId, mode), environment);
    },
    async model(userId, base) {
      return accountModelEnvironment(signup, await readPlan(db, userId, mode), base);
    },
    async plan(userId) {
      return readPlan(db, userId, mode);
    },
    async cap(userId) {
      if (capMicros === undefined) return null;
      return spendsInstanceMoney(signup, await readPlan(db, userId, mode)) ? capMicros : null;
    },
    async choices(userId) {
      if (spendsInstanceMoney(signup, await readPlan(db, userId, mode))) return lentProviders;
      return readProviderChoices(db, userId);
    },
    async spendsInstanceMoney(userId) {
      return spendsInstanceMoney(signup, await readPlan(db, userId, mode));
    },
  };
}

/**
 * Which of these accounts are on the plan whose keys are the instance's. US-129.
 *
 * For the scheduler, which holds a list of owners and needs to know which of
 * them have a cap at all. Asked of the database in one read rather than once
 * per account: a tick that is about to queue forty polls must not make forty
 * round trips to find out whose money it is about to spend.
 */
export async function keysIncludedAmong(
  db: Database,
  userIds: readonly string[],
  mode: BillingMode,
): Promise<string[]> {
  if (mode === "off" || userIds.length === 0) return [];

  const rows = await db
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(
      and(inArray(subscriptions.userId, [...userIds]), eq(subscriptions.plan, "keys_included")),
    );

  return rows.map((row) => row.userId);
}

/**
 * A per-account cache whose key carries the plan. US-128.
 *
 * The worker builds a model client per account and keeps it for the life of the
 * process, because building one decrypts a key and constructs an SDK object and
 * a poll of fifty posts would otherwise do that fifty times. That cache was
 * keyed by the account alone, which was right while the only thing it could be
 * wrong about was whose key somebody was paying with.
 *
 * The plan is not that. An account that leaves the plan must stop spending our
 * model key on the next job, not at the next restart — so the plan is read on
 * every call and it is part of the key. One primary-key read per job buys it.
 *
 * The old entry is left rather than evicted. It costs one object, and an
 * account that moves back finds its client already built.
 */
export function planKeyedCache<T>(
  keys: AccountKeys,
  build: (userId: string, plan: SubscriptionPlan) => Promise<T>,
): (userId: string) => Promise<T> {
  const cache = new Map<string, T>();

  return async (userId) => {
    const plan = await keys.plan(userId);
    const cacheKey = `${plan}:${userId}`;

    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const built = await build(userId, plan);
    cache.set(cacheKey, built);
    return built;
  };
}
