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

import type { AiEnvironment } from "../ai/config.js";
import type { SignupMode } from "../auth/user.js";
import {
  accountModelEnvironment,
  providerKeyEnvironmentFor,
  spendsInstanceMoney,
} from "../config/machine-keys.js";
import type { Database } from "../db/client.js";
import type { KeySource } from "../db/schema.js";
import { readProviderChoices } from "../sources/choices.js";
import type { ProviderChoices } from "../sources/types.js";
import type { Capacities, PlanCapacity } from "./capacity.js";
import type { BillingMode } from "./entitlement.js";
import { readKeySource } from "./key-source.js";
import { readSubscription } from "./store.js";

/**
 * **`subscriptions.plan` no longer decides anything, and US-141 is why.**
 *
 * US-128 gave the column two values and had the webhook write it from the
 * price a subscription named, so whose keys an account ran on was a property
 * of what it had bought. There is one price now, and the choice is the
 * account's to change at any moment — which a price cannot express and a
 * webhook is too slow to carry. `billing/key-source.ts` holds it instead.
 *
 * What is left here is the per-account object the composition roots build.
 */
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
  /**
   * What the plan sells, and what its trial does. US-133 and US-134.
   * `capacitiesFrom` reads both from the environment at boot. Undefined means
   * this deployment sells no capacity, which is every self-hosted instance —
   * and then `capacity()` answers null for everybody.
   */
  readonly capacities?: Capacities;
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
   * Whose keys this account runs on, for the one caller that needs the answer
   * and not the environment: the worker caches a model client per account, and
   * the cache has to be keyed by the state the client was built under.
   */
  source(userId: string): Promise<KeySource>;
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
  /**
   * What this account may hold and how often it may poll, or null where the
   * money is its own and nothing bounds it but its own budget. US-133.
   *
   * The trial's capacity while the subscription is trialing, the plan's
   * after. Null for every account spending its own keys — US-013 owns their
   * bound — and for every account on a self-hosted instance.
   */
  capacity(userId: string): Promise<PlanCapacity | null>;
}

export function accountKeys(
  db: Database,
  {
    signup,
    mode,
    environment = process.env,
    capMicros,
    lentProviders = {},
    capacities,
  }: AccountKeysOptions,
): AccountKeys {
  /**
   * Whose keys this account runs on, with the one thing the account cannot
   * choose folded in. US-141, and it keeps US-081's rule alive.
   *
   * **An instance that does not charge has nothing to lend.** With signup open
   * and `BILLING_MODE=off` there is no plan, no trial and no invoice — so an
   * account that has chosen nothing must be on its own keys rather than on the
   * owner's, which is the hole US-081 was written to close. Under US-128 the
   * plan column carried that: `off` read as `own_keys`. The state defaults the
   * other way, deliberately, so the composition is where it is said.
   *
   * A self-hosted instance is signup closed, and `machineKeysUsable` has
   * already answered yes for it before any of this is asked.
   */
  const sourceFor = async (userId: string): Promise<KeySource> => {
    if (signup === "open" && mode === "off") return "own";
    return readKeySource(db, userId);
  };

  return {
    async provider(userId) {
      return providerKeyEnvironmentFor(signup, await sourceFor(userId), environment);
    },
    async model(userId, base) {
      return accountModelEnvironment(signup, await sourceFor(userId), base);
    },
    async source(userId) {
      return sourceFor(userId);
    },
    async cap(userId) {
      if (capMicros === undefined) return null;
      return spendsInstanceMoney(signup, await sourceFor(userId)) ? capMicros : null;
    },
    /**
     * US-141: a recorded choice wins, and the deployment's is the default
     * under it — US-130's original wording, restored. An account on its own
     * keys reads only its own rows, because the deployment's answer names
     * providers it holds no key for.
     */
    async choices(userId) {
      const recorded = await readProviderChoices(db, userId);
      if (!spendsInstanceMoney(signup, await sourceFor(userId))) return recorded;
      return { ...lentProviders, ...recorded };
    },
    async spendsInstanceMoney(userId) {
      return spendsInstanceMoney(signup, await sourceFor(userId));
    },
    async capacity(userId) {
      if (capacities === undefined || mode === "off") return null;
      if (!spendsInstanceMoney(signup, await sourceFor(userId))) return null;
      const subscription = await readSubscription(db, userId);
      return subscription?.status === "trialing" ? capacities.trial : capacities.plan;
    },
  };
}

/**
 * A per-account cache whose key carries whose keys it runs on. US-128,
 * rekeyed by US-141.
 *
 * The worker builds a model client per account and keeps it for the life of the
 * process, because building one decrypts a key and constructs an SDK object and
 * a poll of fifty posts would otherwise do that fifty times. That cache was
 * keyed by the account alone, which was right while the only thing it could be
 * wrong about was whose key somebody was paying with.
 *
 * Whose keys it runs on is not that. An account that moves onto its own keys
 * must stop spending our model key on the next job, not at the next restart —
 * so the state is read on every call and it is part of the key. One
 * primary-key read per job buys it.
 *
 * The old entry is left rather than evicted. It costs one object, and an
 * account that moves back finds its client already built.
 */
export function planKeyedCache<T>(
  keys: AccountKeys,
  build: (userId: string, source: KeySource) => Promise<T>,
): (userId: string) => Promise<T> {
  const cache = new Map<string, T>();

  return async (userId) => {
    const source = await keys.source(userId);
    const cacheKey = `${source}:${userId}`;

    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const built = await build(userId, source);
    cache.set(cacheKey, built);
    return built;
  };
}
