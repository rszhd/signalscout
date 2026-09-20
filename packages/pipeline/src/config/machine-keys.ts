/**
 * Whose keys the machine's `.env` holds, and who may spend them. US-081,
 * then US-161.
 *
 * Two questions live here and they used to be one. **Is this instance
 * shared?** — that is the signup mode, and it decides what a stranger's
 * account may do to this machine: aim a webhook at our own network, or sign
 * with a secret every other account holds. **Whose keys pay?** — that is the
 * key policy, and it decides whether a poll and a model call may fall back to
 * the keys in `.env`.
 *
 * US-081 answered both from signup alone: closed meant the keys were the one
 * owner's, open meant they were nobody's. That was right for every instance
 * that existed, and it was one rule, so every screen and every worker seam
 * answered it the same way. US-161 needed the third shape — a shared instance
 * that pays for its accounts — and there the two questions part: the keys are
 * everybody's, and the network and the secret are still not. Flipping signup
 * to closed would have opened all four doors to get two.
 *
 * So the policy is explicit now, and it defaults from signup so that no
 * deployment changes behaviour without asking for it: a self-hosted closed
 * instance keeps `instance`, an open one keeps `account`.
 *
 * What a caller does with the answer is unchanged: it hands the layers below
 * an environment with the keys taken out, so nothing downstream needs to know
 * why they are missing.
 */
import type { AiEnvironment } from "@signalscout/engine";
import type { SignupMode } from "../config/signup.js";

/**
 * `instance` — every account's polls and model calls may fall back to the
 * keys in `.env`. `account` — nothing falls back; a job with no key of its
 * own does not run.
 */
export const keyPolicies = ["account", "instance"] as const;
export type KeyPolicy = (typeof keyPolicies)[number];

/** The policy a deployment gets when it names none: US-081's rule. */
export function defaultKeyPolicy(signup: SignupMode): KeyPolicy {
  return signup === "closed" ? "instance" : "account";
}

/**
 * The policy in force, from the two environment fields that decide it.
 *
 * `MACHINE_KEYS` when set, otherwise the default for the signup mode. One
 * function so the worker and the application cannot resolve the pair two
 * ways.
 */
export function keyPolicyOf(env: {
  readonly AUTH_SIGNUP: SignupMode;
  readonly MACHINE_KEYS?: KeyPolicy | undefined;
}): KeyPolicy {
  return env.MACHINE_KEYS ?? defaultKeyPolicy(env.AUTH_SIGNUP);
}

export function machineKeysUsable(keys: KeyPolicy): boolean {
  return keys === "instance";
}

/**
 * Whether strangers hold accounts here. US-097 and US-096 ask this, not the
 * key policy: a webhook URL is a stranger's string whoever pays for the poll,
 * and a signing secret shared by every account is forgeable whoever pays.
 */
export function sharedInstance(signup: SignupMode): boolean {
  return signup === "open";
}

/**
 * The same environment with every model key removed.
 *
 * The provider, the model, the base URL and the prices stay: those describe
 * what the deployment was configured and measured for, and an account with no
 * settings of its own should keep them. It is only the key — the thing that is
 * somebody's money — that does not travel.
 */
export function withoutMachineModelKeys(env: AiEnvironment): AiEnvironment {
  return {
    ...env,
    AI_API_KEY: undefined,
    AI_TRIAGE_API_KEY: undefined,
    AI_DRAFT_API_KEY: undefined,
    AI_PLAN_API_KEY: undefined,
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
 * That is why it follows the signup mode and not the key policy (US-161): an
 * instance that pays for its accounts' polls still must not let them sign as
 * each other.
 *
 * With signup closed nothing changes: one person, one machine, one `.env`, and
 * every receiver they configured keeps verifying.
 */
export function webhookSecretEnvironment(
  signup: SignupMode,
  environment: Record<string, string | undefined> = process.env,
): string | undefined {
  return sharedInstance(signup) ? undefined : environment.WEBHOOK_SIGNING_SECRET;
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
  keys: KeyPolicy,
  environment: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  return machineKeysUsable(keys) ? environment : {};
}
