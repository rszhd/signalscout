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
import { aiKeys, aiSettings } from "../db/schema.js";
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
import { createAiKey, DuplicateAiKeyName, deleteAiKey, listAiKeys } from "./keys.js";
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
    await db.delete(aiKeys);
    stored.clear();
  });

  /**
   * A key the account holds, by its value.
   *
   * US-079 separated the two acts: a key is stored once and a job then names
   * it. These cases care about the second, so this does the first and hands
   * back the id — and it stores each distinct value once, because two rows
   * holding the same key would be a person's mistake and not a fixture's.
   */
  const stored = new Map<string, string>();

  async function keyFor(value: string, provider: string | null = null): Promise<string> {
    const already = stored.get(value);
    if (already) return already;

    const made = await createAiKey(db, key, owner, {
      name: `Key ${stored.size + 1}`,
      provider,
      apiKey: value,
    });

    stored.set(value, made.id);
    return made.id;
  }

  it("gives an account with no settings the instance's own environment", async () => {
    expect(await readAiEnvironment(db, owner, instance, encryption)).toEqual(instance);
  });

  /**
   * The common cloud case, and the one that must not need any other field.
   *
   * A person adds a key and points one job at it. They keep the deployment's
   * provider and model — which is what the deployment has measured and priced
   * — and pay for their own calls.
   */
  it("takes only the key when only the key is chosen", async () => {
    await saveAiTaskSettings(db, owner, "classify", { keyId: await keyFor("sk-mine") });

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
    await saveAiTaskSettings(db, owner, "classify", {
      provider: "openai",
      model: "gpt-5.6-terra",
      keyId: await keyFor("sk-mine"),
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
    await saveAiTaskSettings(db, owner, "classify", {
      provider: "openai",
      model: "gpt-5.6-terra",
      keyId: await keyFor("sk-mine"),
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

    await saveAiTaskSettings(db, owner, "triage", { model: "gpt-5.6-luna" });
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
    await saveAiTaskSettings(db, owner, "classify", { keyId: await keyFor("sk-anthropic") });
    await saveAiTaskSettings(db, owner, "embed", {
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
      await saveAiTaskSettings(db, owner, "classify", {
        provider: "openai",
        model: "gpt-5.6-terra",
        keyId: await keyFor("sk-mine"),
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
      await saveAiTaskSettings(db, owner, "classify", {
        provider: "openai",
        model: "gpt-5.6-terra",
        keyId: await keyFor("sk-mine"),
        inputPriceMicros: 2_000_000,
      });
      await saveAiTaskSettings(db, owner, "draft", { model: "gpt-5.6-sol" });

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
      await saveAiTaskSettings(db, owner, "classify", {
        provider: "openai",
        keyId: await keyFor("sk-openai"),
      });
      await saveAiTaskSettings(db, owner, "draft", {
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
      await saveAiTaskSettings(db, owner, "draft", {
        provider: "anthropic",
        model: "claude-sonnet-5",
        keyId: await keyFor("sk-anthropic"),
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

  /**
   * One key, several jobs. US-079.
   *
   * The thing the owner asked for: paste once, then choose. Two jobs on
   * different providers pointing at one key is a person's own choice, so
   * nothing here refuses it — a wrong key fails at the provider, which is the
   * only place that can tell.
   */
  describe("one key across several jobs", () => {
    it("gives two jobs the same key when both are pointed at it", async () => {
      const mineOnly = await keyFor("sk-openai", "openai");

      await saveAiTaskSettings(db, owner, "draft", {
        provider: "openai",
        model: "gpt-5.6-terra",
        keyId: mineOnly,
      });
      await saveAiTaskSettings(db, owner, "triage", {
        provider: "openai",
        model: "gpt-5.6-luna",
        keyId: mineOnly,
      });

      const mine = await readAiEnvironment(db, owner, instance, encryption);

      expect(triageConfigFromEnvironment(mine).apiKey).toBe("sk-openai");
      expect(draftConfigFromEnvironment(mine).apiKey).toBe("sk-openai");
      // And scoring, pointed at nothing, is still the instance's.
      expect(aiConfigFromEnvironment(mine).apiKey).toBe("the-instance-key");
    });

    it("lends nothing on its own: a job with no key uses the instance's", async () => {
      await saveAiTaskSettings(db, owner, "draft", {
        provider: "openai",
        keyId: await keyFor("sk-openai", "openai"),
      });
      await saveAiTaskSettings(db, owner, "triage", {
        provider: "openai",
        model: "gpt-5.6-luna",
      });

      // Triage picked no key. It does not quietly take drafting's, which is
      // the rule US-078 added and this ticket replaced with a choice.
      expect(
        triageConfigFromEnvironment(await readAiEnvironment(db, owner, instance, encryption))
          .apiKey,
      ).toBeUndefined();
    });

    it("puts every job back on the instance's key when the key is deleted", async () => {
      const doomed = await keyFor("sk-openai", "openai");

      await saveAiTaskSettings(db, owner, "classify", { keyId: doomed });
      await deleteAiKey(db, owner, doomed);

      expect(
        aiConfigFromEnvironment(await readAiEnvironment(db, owner, instance, encryption)).apiKey,
      ).toBe("the-instance-key");
      expect((await readAiSettings(db, owner))[0]?.keyId).toBeNull();
    });
  });

  /**
   * The hole US-068 left, found while auditing US-080.
   *
   * An account can move a job onto another provider without storing a key. The
   * instance's key stays in the environment underneath, and sending it to the
   * provider that did not issue it fails every call — while the sentence a
   * person reads blames a key they never chose.
   */
  describe("moving a job to another provider without a key", () => {
    it("does not send the instance's key to the provider it did not come from", async () => {
      await saveAiTaskSettings(db, owner, "classify", {
        provider: "openai",
        model: "gpt-5.6-terra",
      });

      const config = aiConfigFromEnvironment(
        await readAiEnvironment(db, owner, instance, encryption),
      );

      expect(config.provider).toBe("openai");
      expect(config.apiKey).toBeUndefined();
    });

    it("keeps the instance's key when the provider is the instance's own", async () => {
      await saveAiTaskSettings(db, owner, "classify", { model: "claude-sonnet-5" });

      expect(
        aiConfigFromEnvironment(await readAiEnvironment(db, owner, instance, encryption)).apiKey,
      ).toBe("the-instance-key");
    });

    it("does the same for a job with a key of its own in the environment", async () => {
      const withTriageKey: AiEnvironment = {
        ...instance,
        AI_TRIAGE_PROVIDER: "anthropic",
        AI_TRIAGE_API_KEY: "the-instance-triage-key",
      };

      await saveAiTaskSettings(db, owner, "triage", {
        provider: "openai",
        model: "gpt-5.6-luna",
      });

      const config = triageConfigFromEnvironment(
        await readAiEnvironment(db, owner, withTriageKey, encryption),
      );

      expect(config.provider).toBe("openai");
      expect(config.apiKey).toBeUndefined();
    });
  });

  it("keeps one account's settings out of another's", async () => {
    await saveAiTaskSettings(db, owner, "classify", {
      provider: "openai",
      model: "gpt-5.6-terra",
      keyId: await keyFor("sk-mine"),
    });

    const theirs = await readAiEnvironment(db, other, instance, encryption);

    expect(theirs).toEqual(instance);
    expect(await readAiSettings(db, other)).toEqual([]);
  });

  it("never reads a key back out, only its mask", async () => {
    await saveAiTaskSettings(db, owner, "classify", { keyId: await keyFor("sk-1234567890abcd") });

    const [listed] = await listAiKeys(db, owner);

    expect(listed?.hint).toBe("••••abcd");
    expect(JSON.stringify(listed)).not.toContain("sk-1234567890abcd");

    // And nothing in either row is the plaintext.
    expect(JSON.stringify(await db.select().from(aiSettings))).not.toContain("sk-1234567890abcd");
    expect(JSON.stringify(await db.select().from(aiKeys))).not.toContain("sk-1234567890abcd");
  });

  /**
   * A form posts every field on every save. US-022 found that shape erasing
   * settings a person had not touched, and the key is the worst choice to
   * erase: silent, and only noticed when the next poll scores nothing.
   */
  it("leaves the chosen key alone when a save does not carry one", async () => {
    await saveAiTaskSettings(db, owner, "classify", { keyId: await keyFor("sk-mine") });
    await saveAiTaskSettings(db, owner, "classify", { model: "gpt-5.6-terra" });

    const config = aiConfigFromEnvironment(
      await readAiEnvironment(db, owner, instance, encryption),
    );

    expect(config.apiKey).toBe("sk-mine");
    expect(config.model).toBe("gpt-5.6-terra");
  });

  it("goes back to the instance's key when a save says null", async () => {
    await saveAiTaskSettings(db, owner, "classify", { keyId: await keyFor("sk-mine") });
    await saveAiTaskSettings(db, owner, "classify", { keyId: null });

    const config = aiConfigFromEnvironment(
      await readAiEnvironment(db, owner, instance, encryption),
    );

    expect(config.apiKey).toBe("the-instance-key");
    expect((await readAiSettings(db, owner))[0]?.keyId).toBeNull();
    // The key itself is still on the account. Pointing away is not deleting.
    expect(await listAiKeys(db, owner)).toHaveLength(1);
  });

  it("forgets a task entirely when it is cleared", async () => {
    await saveAiTaskSettings(db, owner, "classify", {
      provider: "openai",
      keyId: await keyFor("sk-mine"),
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
    await saveAiTaskSettings(db, owner, "classify", { keyId: await keyFor("sk-mine") });

    await expect(
      readAiEnvironment(db, owner, instance, { ENCRYPTION_KEY: generateEncryptionKey() }),
    ).rejects.toThrow(UndecryptableSecretError);
  });

  it("refuses to store a key on an instance that has no encryption key", async () => {
    await expect(
      createAiKey(db, undefined, owner, { name: "Nowhere to put it", apiKey: "sk-mine" }),
    ).rejects.toThrow(/ENCRYPTION_KEY/);
  });

  it("refuses a second key with the same name", async () => {
    await createAiKey(db, key, owner, { name: "My key", apiKey: "sk-one" });

    await expect(createAiKey(db, key, owner, { name: "my key", apiKey: "sk-two" })).rejects.toThrow(
      DuplicateAiKeyName,
    );
  });
});
