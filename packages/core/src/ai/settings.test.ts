/**
 * One account's model settings, against real Postgres.
 *
 * Correctness-critical: credential encryption. A model key is a key.
 *
 * The claims here are about *layering*, because that is the whole design of
 * US-068: a stored row overrides the environment and the three functions in
 * `config.ts` read the result. So these cases end by asking those functions
 * what they made of it, rather than asserting the shape of an intermediate
 * object — an override that produced the right `AiEnvironment` and the wrong
 * classifier would pass the second kind of test and fail a person.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { aiSettings } from "../db/schema.js";
import {
  generateEncryptionKey,
  readEncryptionKey,
  UndecryptableSecretError,
} from "../secrets/cipher.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import {
  type AiEnvironment,
  aiConfigFromEnvironment,
  draftConfigFromEnvironment,
  embeddingConfigFromEnvironment,
  triageConfigFromEnvironment,
} from "./config.js";
import {
  clearAiTaskSettings,
  readAiEnvironment,
  readAiSettings,
  saveAiTaskSettings,
} from "./settings.js";

const encryptionKey = generateEncryptionKey();
const key = readEncryptionKey(encryptionKey);
const encryption = { ENCRYPTION_KEY: encryptionKey };

const owner = "account-1";
const other = "account-2";

/** What the deployment itself is configured with. */
const instance: AiEnvironment = {
  AI_PROVIDER: "anthropic",
  AI_MODEL: "claude-haiku-4-5",
  AI_API_KEY: "the-instance-key",
  AI_TIMEOUT_MS: 30_000,
};

describe("one account's model settings", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("ai_settings");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(aiSettings);
  });

  it("gives an account with no settings the instance's own environment", async () => {
    expect(await readAiEnvironment(db, owner, instance, encryption)).toEqual(instance);
  });

  /**
   * The common cloud case, and the one that must not need any other field.
   *
   * A person pastes a key and nothing else. They keep the deployment's provider
   * and model — which is what the deployment has measured and priced — and pay
   * for their own calls.
   */
  it("takes only the key when only the key is given", async () => {
    await saveAiTaskSettings(db, key, owner, "classify", { apiKey: "sk-mine" });

    const config = aiConfigFromEnvironment(
      await readAiEnvironment(db, owner, instance, encryption),
    );

    expect(config).toMatchObject({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      apiKey: "sk-mine",
    });
  });

  it("takes the provider and model when those are given too", async () => {
    await saveAiTaskSettings(db, key, owner, "classify", {
      provider: "openai",
      model: "gpt-5.6-terra",
      apiKey: "sk-mine",
    });

    expect(
      aiConfigFromEnvironment(await readAiEnvironment(db, owner, instance, encryption)),
    ).toMatchObject({ provider: "openai", model: "gpt-5.6-terra", apiKey: "sk-mine" });
  });

  /**
   * The rule US-030 measured, still holding through the override.
   *
   * Triage falls back to the classifier's settings, so somebody who sets a
   * classifier key gets triage on it without a second thought — and the price
   * does *not* fall back once a triage model is named, because a cheaper model
   * priced at the classifier's rate would report a saving that did not happen.
   */
  it("keeps the triage fallbacks that were measured, not reimplemented", async () => {
    await saveAiTaskSettings(db, key, owner, "classify", {
      provider: "openai",
      model: "gpt-5.6-terra",
      apiKey: "sk-mine",
      inputPriceMicros: 2_000_000,
    });

    const mine = await readAiEnvironment(db, owner, instance, encryption);

    // Nothing set for triage: every setting is the classifier's.
    expect(triageConfigFromEnvironment(mine)).toMatchObject({
      provider: "openai",
      model: "gpt-5.6-terra",
      apiKey: "sk-mine",
      inputPriceMicros: 2_000_000,
    });

    await saveAiTaskSettings(db, key, owner, "triage", { model: "gpt-5.6-luna" });
    const withTriage = await readAiEnvironment(db, owner, instance, encryption);

    expect(triageConfigFromEnvironment(withTriage)).toMatchObject({
      provider: "openai",
      model: "gpt-5.6-luna",
      // The key still falls back, because the provider is the same.
      apiKey: "sk-mine",
    });
    // The price does not. This is the number the stage exists to prove.
    expect(triageConfigFromEnvironment(withTriage).inputPriceMicros).toBeUndefined();
  });

  /**
   * The documented reason the embedding half exists at all: our default
   * provider publishes no embedding endpoint, so a person on Anthropic has to
   * name another one, and their Anthropic key must not travel to it.
   */
  it("does not send the classifier's key to a different embedding provider", async () => {
    await saveAiTaskSettings(db, key, owner, "classify", { apiKey: "sk-anthropic" });
    await saveAiTaskSettings(db, key, owner, "embed", {
      provider: "openai",
      model: "text-embedding-3-small",
    });

    const config = embeddingConfigFromEnvironment(
      await readAiEnvironment(db, owner, instance, encryption),
    );

    expect(config).toMatchObject({ provider: "openai", model: "text-embedding-3-small" });
    expect(config?.apiKey).toBeUndefined();
  });

  /**
   * The drafting model. US-070.
   *
   * Triage's rules, for the same reasons, and asserted rather than assumed
   * because they were copied: every setting falls back to the classifier's, the
   * key only within one provider, and the price only while no model is named.
   * A draft billed at the classifier's rate would misreport what it cost, and
   * that figure is shown to the person who pressed the button.
   */
  describe("the model that writes a reply", () => {
    it("is the classifier's when nothing is set for it", async () => {
      await saveAiTaskSettings(db, key, owner, "classify", {
        provider: "openai",
        model: "gpt-5.6-terra",
        apiKey: "sk-mine",
        inputPriceMicros: 2_000_000,
      });

      expect(
        draftConfigFromEnvironment(await readAiEnvironment(db, owner, instance, encryption)),
      ).toMatchObject({
        provider: "openai",
        model: "gpt-5.6-terra",
        apiKey: "sk-mine",
        inputPriceMicros: 2_000_000,
      });
    });

    it("keeps the classifier's key when it stays on the same provider", async () => {
      await saveAiTaskSettings(db, key, owner, "classify", {
        provider: "openai",
        model: "gpt-5.6-terra",
        apiKey: "sk-mine",
        inputPriceMicros: 2_000_000,
      });
      await saveAiTaskSettings(db, key, owner, "draft", { model: "gpt-5.6-sol" });

      const config = draftConfigFromEnvironment(
        await readAiEnvironment(db, owner, instance, encryption),
      );

      expect(config).toMatchObject({
        provider: "openai",
        model: "gpt-5.6-sol",
        apiKey: "sk-mine",
      });
      // Named its own model, so it does not inherit the classifier's price.
      expect(config.inputPriceMicros).toBeUndefined();
    });

    it("does not send the classifier's key to a different drafting provider", async () => {
      await saveAiTaskSettings(db, key, owner, "classify", {
        provider: "openai",
        apiKey: "sk-openai",
      });
      await saveAiTaskSettings(db, key, owner, "draft", {
        provider: "anthropic",
        model: "claude-sonnet-5",
      });

      const config = draftConfigFromEnvironment(
        await readAiEnvironment(db, owner, instance, encryption),
      );

      expect(config.provider).toBe("anthropic");
      expect(config.apiKey).toBeUndefined();
    });

    it("takes a key of its own", async () => {
      await saveAiTaskSettings(db, key, owner, "draft", {
        provider: "anthropic",
        model: "claude-sonnet-5",
        apiKey: "sk-anthropic",
      });

      expect(
        draftConfigFromEnvironment(await readAiEnvironment(db, owner, instance, encryption)),
      ).toMatchObject({
        provider: "anthropic",
        model: "claude-sonnet-5",
        apiKey: "sk-anthropic",
      });
    });
  });

  it("keeps one account's settings out of another's", async () => {
    await saveAiTaskSettings(db, key, owner, "classify", {
      provider: "openai",
      model: "gpt-5.6-terra",
      apiKey: "sk-mine",
    });

    const theirs = await readAiEnvironment(db, other, instance, encryption);

    expect(theirs).toEqual(instance);
    expect(await readAiSettings(db, other)).toEqual([]);
  });

  it("never reads a key back out, only its mask", async () => {
    await saveAiTaskSettings(db, key, owner, "classify", { apiKey: "sk-1234567890abcd" });

    const [row] = await readAiSettings(db, owner);

    expect(row?.hint).toBe("••••abcd");
    expect(JSON.stringify(row)).not.toContain("sk-1234567890abcd");

    // And nothing in the row itself is the plaintext.
    const [stored] = await db.select().from(aiSettings);
    expect(JSON.stringify(stored)).not.toContain("sk-1234567890abcd");
  });

  /**
   * A form posts every field on every save. US-022 found that shape erasing
   * settings a person had not touched, and a key is the worst thing to erase:
   * silent, and only noticed when the next poll scores nothing.
   */
  it("leaves the stored key alone when a save does not carry one", async () => {
    await saveAiTaskSettings(db, key, owner, "classify", { apiKey: "sk-mine" });
    await saveAiTaskSettings(db, key, owner, "classify", { model: "gpt-5.6-terra" });

    const config = aiConfigFromEnvironment(
      await readAiEnvironment(db, owner, instance, encryption),
    );

    expect(config.apiKey).toBe("sk-mine");
    expect(config.model).toBe("gpt-5.6-terra");
  });

  it("removes the stored key when a save says so, and falls back to the instance's", async () => {
    await saveAiTaskSettings(db, key, owner, "classify", { apiKey: "sk-mine" });
    await saveAiTaskSettings(db, key, owner, "classify", { apiKey: null });

    const config = aiConfigFromEnvironment(
      await readAiEnvironment(db, owner, instance, encryption),
    );

    expect(config.apiKey).toBe("the-instance-key");
    expect((await readAiSettings(db, owner))[0]?.hint).toBeNull();
  });

  it("forgets a task entirely when it is cleared", async () => {
    await saveAiTaskSettings(db, key, owner, "classify", {
      provider: "openai",
      apiKey: "sk-mine",
    });
    await clearAiTaskSettings(db, owner, "classify");

    expect(await readAiSettings(db, owner)).toEqual([]);
    expect(await readAiEnvironment(db, owner, instance, encryption)).toEqual(instance);
  });

  /**
   * A stored key this process cannot open throws rather than quietly falling
   * back to the instance's. `secrets/store.ts` makes the same choice: silently
   * classifying on somebody else's key is how a rotation looks like it worked.
   */
  it("throws rather than classifying on the instance's key when it cannot open a stored one", async () => {
    await saveAiTaskSettings(db, key, owner, "classify", { apiKey: "sk-mine" });

    await expect(
      readAiEnvironment(db, owner, instance, { ENCRYPTION_KEY: generateEncryptionKey() }),
    ).rejects.toThrow(UndecryptableSecretError);
  });

  it("refuses to store a key on an instance that has no encryption key", async () => {
    await expect(
      saveAiTaskSettings(db, undefined, owner, "classify", { apiKey: "sk-mine" }),
    ).rejects.toThrow(/ENCRYPTION_KEY/);
  });
});
