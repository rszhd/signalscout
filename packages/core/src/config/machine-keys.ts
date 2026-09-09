/**
 * Whether a signed-in account may spend the keys in this machine's `.env`.
 * US-081.
 *
 * **Closed signup: yes. Open signup: no.**
 *
 * The self-hosted instance is one person and their own machine, and `.env` is
 * how they configure it — US-067's environment half exists for exactly that.
 * An instance taking registrations is not that: a stranger who signs up would
 * poll on the owner's providers and classify on the owner's model key, and the
 * bill would arrive with nothing to say who spent it. docs/accounts.md has
 * warned about it in prose since US-067; this is the rule that stops it.
 *
 * It is one function because it is one decision, and every screen and every
 * worker seam has to answer it the same way. What each caller then does is the
 * same thing too: it hands the layers below an environment with the keys taken
 * out, so nothing downstream needs to know why they are missing.
 */
import type { AiEnvironment } from "../ai/config.js";
import type { SignupMode } from "../auth/user.js";

export function machineKeysUsable(signup: SignupMode): boolean {
  return signup === "closed";
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
