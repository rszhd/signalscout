/**
 * Whose keys the machine's `.env` holds. US-081, then US-161.
 *
 * Correctness-critical: credential encryption's neighbour. The failure here is
 * not a leaked key but a spent one — a stranger who registers on an open
 * instance polling providers and classifying posts on the owner's keys, with
 * the bill arriving and nothing to say who spent it. US-161 adds the other
 * failure: an instance that chose to pay for its accounts, and in doing so
 * opened its network and its signing secret to them.
 */

import type { AiEnvironment } from "@signalscout/engine";
import { describe, expect, it } from "vitest";
import {
  defaultKeyPolicy,
  keyPolicyOf,
  machineKeysUsable,
  providerKeyEnvironment,
  sharedInstance,
  webhookSecretEnvironment,
  withoutMachineModelKeys,
} from "./machine-keys.js";

const instance: AiEnvironment = {
  AI_PROVIDER: "anthropic",
  AI_MODEL: "claude-haiku-4-5",
  AI_API_KEY: "the-machine-key",
  AI_TRIAGE_API_KEY: "the-machine-triage-key",
  AI_DRAFT_API_KEY: "the-machine-draft-key",
  AI_EMBEDDING_API_KEY: "the-machine-embedding-key",
  AI_BASE_URL: "https://gateway.example",
  AI_INPUT_PRICE_MICROS: 1_000_000,
  AI_TIMEOUT_MS: 30_000,
};

describe("whether the machine's keys are an account's to spend", () => {
  it("is what the key policy says", () => {
    expect(machineKeysUsable("instance")).toBe(true);
    expect(machineKeysUsable("account")).toBe(false);
  });

  /**
   * US-081's rule, kept as the default so that no deployment changes
   * behaviour by upgrading: a self-hosted instance keeps its keys, and one
   * taking registrations keeps them out of every account's reach.
   */
  it("defaults from the signup mode: closed is instance, open is account", () => {
    expect(defaultKeyPolicy("closed")).toBe("instance");
    expect(defaultKeyPolicy("open")).toBe("account");

    expect(keyPolicyOf({ AUTH_SIGNUP: "closed" })).toBe("instance");
    expect(keyPolicyOf({ AUTH_SIGNUP: "open" })).toBe("account");
    expect(keyPolicyOf({ AUTH_SIGNUP: "closed", MACHINE_KEYS: undefined })).toBe("instance");
  });

  it("takes an explicit policy over the default, either way", () => {
    expect(keyPolicyOf({ AUTH_SIGNUP: "open", MACHINE_KEYS: "instance" })).toBe("instance");
    expect(keyPolicyOf({ AUTH_SIGNUP: "closed", MACHINE_KEYS: "account" })).toBe("account");
  });

  /**
   * The provider, the model, the endpoint and the prices are what a deployment
   * was configured and measured for. Only the key is somebody's money.
   */
  it("removes every model key and nothing else", () => {
    const stripped = withoutMachineModelKeys(instance);

    expect(stripped.AI_API_KEY).toBeUndefined();
    expect(stripped.AI_TRIAGE_API_KEY).toBeUndefined();
    expect(stripped.AI_DRAFT_API_KEY).toBeUndefined();
    expect(stripped.AI_EMBEDDING_API_KEY).toBeUndefined();

    expect(stripped.AI_PROVIDER).toBe("anthropic");
    expect(stripped.AI_MODEL).toBe("claude-haiku-4-5");
    expect(stripped.AI_BASE_URL).toBe("https://gateway.example");
    expect(stripped.AI_INPUT_PRICE_MICROS).toBe(1_000_000);
  });

  /**
   * Every key this environment could hold, named rather than sampled.
   *
   * A key variable added later is one this function would silently pass on,
   * and the failure is invisible: a stranger's poll simply works, on somebody
   * else's account.
   */
  it("leaves no value in the result that reads like a key", () => {
    const stripped = withoutMachineModelKeys(instance) as unknown as Record<string, unknown>;
    const carried = Object.entries(stripped)
      .filter(([name]) => name.endsWith("_API_KEY"))
      .filter(([, value]) => value !== undefined);

    expect(carried).toEqual([]);
  });

  it("gives a provider-key lookup the environment, or nothing at all", () => {
    const environment = { BRIGHTDATA_API_KEY: "the-machine-key" };

    expect(providerKeyEnvironment("instance", environment)).toEqual(environment);
    expect(providerKeyEnvironment("account", environment)).toEqual({});
  });
});

/**
 * The composition US-161 exists for: strangers hold accounts, and the
 * instance pays for their polls. Paying opens the keys and nothing else.
 */
describe("a shared instance that pays for its accounts", () => {
  const signup = "open" as const;
  const keys = keyPolicyOf({ AUTH_SIGNUP: signup, MACHINE_KEYS: "instance" });
  const environment = {
    BRIGHTDATA_API_KEY: "the-machine-key",
    WEBHOOK_SIGNING_SECRET: "the-instance-secret-32-characters-long",
  };

  it("lets every account poll and classify on the machine's keys", () => {
    expect(machineKeysUsable(keys)).toBe(true);
    expect(providerKeyEnvironment(keys, environment)).toEqual(environment);
  });

  it("still guards its own network from a stranger's webhook URL", () => {
    // US-097 asks who registers, not who pays.
    expect(sharedInstance(signup)).toBe(true);
  });

  it("still hands out no shared signing secret", () => {
    // US-096: a secret every account holds is one any of them can forge with.
    expect(webhookSecretEnvironment(signup, environment)).toBeUndefined();
  });
});

describe("whether strangers hold accounts here", () => {
  it("follows the signup mode alone", () => {
    expect(sharedInstance("closed")).toBe(false);
    expect(sharedInstance("open")).toBe(true);
  });
});

describe("the webhook signing secret", () => {
  const environment = { WEBHOOK_SIGNING_SECRET: "the-instance-secret-32-characters-long" };

  it("is an account's to sign with where signup is closed", () => {
    // One person, one machine, one `.env`. Every receiver they configured
    // against it keeps verifying.
    expect(webhookSecretEnvironment("closed", environment)).toBe(
      environment.WEBHOOK_SIGNING_SECRET,
    );
  });

  it("is nobody's to sign with where signup is open", () => {
    /**
     * US-096's whole reason. The contract hands this value to the customer to
     * verify with, so an account falling back to it on a shared instance would
     * sign with a secret every other account also holds — and any of them could
     * forge a delivery another's receiver accepts as genuine.
     */
    expect(webhookSecretEnvironment("open", environment)).toBeUndefined();
  });

  it("answers undefined where the instance set none, either way", () => {
    expect(webhookSecretEnvironment("closed", {})).toBeUndefined();
    expect(webhookSecretEnvironment("open", {})).toBeUndefined();
  });
});
