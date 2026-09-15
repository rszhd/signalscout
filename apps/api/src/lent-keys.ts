/**
 * The choices an account on the lent-keys plan may not make. US-132.
 *
 * Correctness-critical: plan. The failure shape is an account polling and
 * classifying on the instance's keys with choices the deployment never made —
 * pointing our model key at the dearest model the provider sells, or moving the
 * poll to the dearer of two scrapers. US-129's cap bounds the month; it does
 * not stop the choice.
 *
 * The plan is a plan, so the deployment chooses. The person on it asked not to
 * hold accounts and not to paste keys, and deciding which scraper answers and
 * which model scores is not a thing they were sold. An account spending its own
 * keys keeps every choice it has today: US-026 decided that spending somebody's
 * money is not a default, and the money there is not ours.
 *
 * **403, not 402.** The account has paid. "This is the deployment's choice" and
 * "this account has not paid" send a person to two different places, and the
 * paywall's sentence would send this one to a billing page that has nothing to
 * fix.
 *
 * Registered after the session gate and the paywall, so a signed-out request
 * and an unpaid one have already been answered. On an instance that lends no
 * keys — closed signup, or no billing — nothing is registered and no request
 * pays a read for it.
 */
import type { AccountKeys, BillingMode, SignupMode } from "@signalscout/core";
import { sessionUserId } from "./auth.js";
import { writeMethods } from "./billing.js";
import type { ApiServer } from "./server.js";

/**
 * The routes that choose a provider, a model or a key.
 *
 * Prefixes rather than a list of paths, for the reason the paywall walks every
 * route: the route somebody adds under `/api/models` next month is exactly the
 * one nobody would think to add to a list. Every write under these is a
 * choice the deployment holds on this plan — both connections writes, both
 * platform provider writes, both key tests, and every `/api/models` write.
 */
export const lentKeysGatedPrefixes: readonly string[] = [
  "/api/connections",
  "/api/platforms/",
  "/api/models",
];

/** The sentence such a write is refused with. It names the plan and the repair. */
export const lentKeysMessage =
  "Your plan includes SignalScout's providers and model, so which provider fetches each " +
  "platform and which model reads each task is set by the deployment. There is nothing to " +
  "connect or choose here on this plan.";

/** Is this request a choice the plan holds? A read never is. */
export function isGatedForLentKeys(method: string, path: string): boolean {
  if (!(writeMethods as readonly string[]).includes(method.toUpperCase())) return false;
  return lentKeysGatedPrefixes.some((prefix) => path.startsWith(prefix));
}

export interface LentKeysGateOptions {
  readonly keys: AccountKeys;
  readonly signup: SignupMode;
  readonly mode: BillingMode;
}

export function registerLentKeysGate(app: ApiServer, options: LentKeysGateOptions): void {
  // `spendsInstanceMoney` answers no for every account on such an instance,
  // so the hook would only ever cost a read. Not registered at all instead.
  if (options.signup !== "open" || options.mode === "off") return;

  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0] ?? "";

    if (!isGatedForLentKeys(request.method, path)) return;

    if (await options.keys.spendsInstanceMoney(sessionUserId(request))) {
      return reply.code(403).send({ message: lentKeysMessage });
    }
  });
}
