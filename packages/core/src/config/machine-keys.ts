/**
 * Whether a signed-in account may spend the keys in this machine's `.env`.
 * US-081.
 *
 * **Closed signup: yes. Open signup: only on the plan that pays for them.**
 *
 * The self-hosted instance is one person and their own machine, and `.env` is
 * how they configure it — US-067's environment half exists for exactly that.
 * An instance taking registrations is not that: a stranger who signs up would
 * poll on the owner's providers and classify on the owner's model key, and the
 * bill would arrive with nothing to say who spent it. docs/accounts.md has
 * warned about it in prose since US-067; this is the rule that stops it.
 *
 * It is one decision, and every screen and every worker seam has to answer it
 * the same way. What each caller then does is the same thing too: it hands the
 * layers below an environment with the keys taken out, so nothing downstream
 * needs to know why they are missing.
 *
 * US-128 moved it from the instance to the account. The functions taking a
 * `plan` are the rule now; the ones taking only `signup` are what is left for
 * the questions that really are about the machine — the webhook signing secret,
 * and whether a stranger's URL may be requested from inside our network.
 */
import type { AiEnvironment } from "../ai/config.js";
import type { SignupMode } from "../auth/user.js";
import type { SubscriptionPlan } from "../db/schema.js";

export function machineKeysUsable(signup: SignupMode): boolean {
  return signup === "closed";
}

/**
 * The same question, asked about one account. US-128.
 *
 * US-081's rule was a fact about the instance, because every account on an
 * open instance answered the same way. A plan whose keys are included is an
 * account that answers differently, so the question moved down: closed signup
 * is still yes for everybody, and on an open instance it is yes for the plan
 * that pays for it and no for every other.
 *
 * **Every unknown is `own_keys` before it reaches here.** `billing/plan.ts`
 * holds that, and it is why this function needs no third answer: a missing row,
 * an unrecognised price and a webhook that has not arrived are all already the
 * plan that spends its own money.
 *
 * This does not ask whether the account is entitled. `entitlementFor` owns
 * that, it is checked on every write and in the scheduler, and a second gate
 * here would be two rules answering one question — with the usual result that
 * they disagree. One consequence is worth stating: `past_due` is entitled, so a
 * card that failed this morning keeps polling on our keys while Stripe retries.
 * That is US-072's judgement, applied to the plan rather than re-argued.
 */
export function machineKeysUsableFor(signup: SignupMode, plan: SubscriptionPlan): boolean {
  return machineKeysUsable(signup) || plan === "keys_included";
}

/**
 * The same environment with every model key removed.
 *
 * The provider, the model, the base URL and the prices stay: those describe
 * what the deployment was configured and measured for, and an account with no
 * settings of its own should keep them. It is only the key — the thing that is
 * somebody's money — that does not travel.
 */
export function withoutMachineModelKeys<E extends AiEnvironment>(env: E): E {
  return {
    ...env,
    AI_API_KEY: undefined,
    AI_TRIAGE_API_KEY: undefined,
    AI_DRAFT_API_KEY: undefined,
    AI_EMBEDDING_API_KEY: undefined,
  };
}

/**
 * The instance's webhook signing secret, where an account may use it. US-096.
 *
 * **Undefined where signup is open, and that is the whole point.** The contract
 * hands this value to the customer to verify with, so an account falling back
 * to it on a shared instance would sign with a secret every other account also
 * holds — and any of them could then forge a delivery that another's receiver
 * accepts as genuine. Stripping it means an account there has to make its own,
 * which the notification screen offers in one button.
 *
 * This is US-081's rule applied to something that is not money. The reasoning
 * transfers because the shape is identical: a value that belongs to the machine
 * is not a value a stranger's account may act with. The harm differs — this one
 * is forgeable signatures rather than somebody else's bill — and it is worse.
 *
 * With signup closed nothing changes: one person, one machine, one `.env`, and
 * every receiver they configured keeps verifying.
 */
export function webhookSecretEnvironment(
  signup: SignupMode,
  environment: Record<string, string | undefined> = process.env,
): string | undefined {
  return machineKeysUsable(signup) ? environment.WEBHOOK_SIGNING_SECRET : undefined;
}

/**
 * The environment a provider-key lookup should read.
 *
 * Empty when the machine's keys are not an account's to spend — which every
 * reader of it then answers correctly without a branch of its own: the
 * connections screen says the key is missing, the monitor form says the
 * monitor cannot start, and the worker's lookup finds nothing to fall back to.
 */
export function providerKeyEnvironment(
  signup: SignupMode,
  environment: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  return machineKeysUsable(signup) ? environment : {};
}

/**
 * The same, for one account. US-128.
 *
 * The pair below is what a composition root builds now: one function of the
 * owner, asked per request and per job, handing every layer under it an
 * environment that is already right. Nothing downstream learned why the keys
 * were missing before, and nothing downstream learns whose plan they are now.
 */
export function providerKeyEnvironmentFor(
  signup: SignupMode,
  plan: SubscriptionPlan,
  environment: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  return machineKeysUsableFor(signup, plan) ? environment : {};
}

/**
 * The environment an account's own model settings are laid over. US-128.
 *
 * The provider, the model, the base URL and the prices always stay: they
 * describe what the deployment was configured and measured for. It is only the
 * key that depends on who is asking.
 */
export function accountModelEnvironment<E extends AiEnvironment>(
  signup: SignupMode,
  plan: SubscriptionPlan,
  environment: E,
): E {
  return machineKeysUsableFor(signup, plan) ? environment : withoutMachineModelKeys(environment);
}
