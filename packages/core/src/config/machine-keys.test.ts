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
  machineKeysUsable,
  providerKeyEnvironment,
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
