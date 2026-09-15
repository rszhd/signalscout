/**
 * Whose keys the machine's `.env` holds. US-081.
 *
 * Correctness-critical: credential encryption's neighbour. The failure here is
 * not a leaked key but a spent one — a stranger who registers on an open
 * instance polling providers and classifying posts on the owner's keys, with
 * the bill arriving and nothing to say who spent it.
 */
import { describe, expect, it } from "vitest";
import type { AiEnvironment } from "../ai/config.js";
import {
  accountModelEnvironment,
  machineKeysUsable,
  machineKeysUsableFor,
  providerKeyEnvironment,
  providerKeyEnvironmentFor,
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
  it("is yes on a self-hosted instance and no on one taking registrations", () => {
    expect(machineKeysUsable("closed")).toBe(true);
    expect(machineKeysUsable("open")).toBe(false);
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

    expect(providerKeyEnvironment("closed", environment)).toEqual(environment);
    expect(providerKeyEnvironment("open", environment)).toEqual({});
  });
});

/**
 * US-128, rekeyed by US-141. The same rule, asked about one account rather
 * than about the instance — and asked about a state the account chose rather
 * than a plan it bought, because there is one price and the choice changes on
 * the next poll rather than on the next webhook.
 */
describe("whether one account runs on the machine's keys", () => {
  it("says yes to an account on ours and no to one on its own", () => {
    expect(machineKeysUsableFor("open", "instance")).toBe(true);
    expect(machineKeysUsableFor("open", "own")).toBe(false);
  });

  /**
   * The self-hosted instance is one person and their own `.env`. It answered
   * yes before any of this existed and it has to go on answering yes whatever
   * a row somewhere says — a version bump that began refusing a self-hoster's
   * own keys is the upgrade nobody would forgive.
   */
  it("says yes on a closed instance, in either state", () => {
    expect(machineKeysUsableFor("closed", "own")).toBe(true);
    expect(machineKeysUsableFor("closed", "instance")).toBe(true);
  });

  it("hands the provider keys to an account on ours, and nothing to one on its own", () => {
    const environment = { BRIGHTDATA_API_KEY: "the-machine-key" };

    expect(providerKeyEnvironmentFor("open", "instance", environment)).toEqual(environment);
    expect(providerKeyEnvironmentFor("open", "own", environment)).toEqual({});
    expect(providerKeyEnvironmentFor("closed", "own", environment)).toEqual(environment);
  });

  /**
   * Only the key depends on the state. The provider, the model, the endpoint
   * and the prices are what the deployment was configured and measured for,
   * and an account that brings its own key still runs on them.
   */
  it("keeps the deployment's model settings in both states, and the key in one", () => {
    const included = accountModelEnvironment("open", "instance", instance);
    const own = accountModelEnvironment("open", "own", instance);

    expect(included.AI_API_KEY).toBe("the-machine-key");
    expect(own.AI_API_KEY).toBeUndefined();

    for (const environment of [included, own]) {
      expect(environment.AI_PROVIDER).toBe("anthropic");
      expect(environment.AI_MODEL).toBe("claude-haiku-4-5");
      expect(environment.AI_BASE_URL).toBe("https://gateway.example");
    }
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
