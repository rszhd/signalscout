/**
 * The Models routes, against real Postgres. US-068.
 *
 * Correctness-critical: credential encryption. `credentials.test.ts` asserts
 * structurally that no route in this build returns a key; what this file owns
 * is the rest — that a blank field leaves a stored key alone, that one account
 * cannot read another's, and that the screen is told what an empty field falls
 * back to.
 */
import {
  aiKeys,
  aiSettings,
  createDatabase,
  createLogger,
  type Database,
  loadEnv,
  modelCalls,
  readAiEnvironment,
} from "@signalscout/core";
import { createTestDatabase, type TestDatabase } from "@signalscout/core/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { asUser } from "./testing.js";

const logger = createLogger({ level: "silent", name: "test" });
const encryptionKey = "Zy8Qb3lVQe1wJc0nT7sD5aR2xK9mP4hG6uV0yB8eN1o=";
const encryption = { ENCRYPTION_KEY: encryptionKey };

const owner = "account-1";
const other = "account-2";

describe("the models routes", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("model_routes");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(modelCalls);
    await db.delete(aiSettings);
    await db.delete(aiKeys);
    probed = { status: "ok" };
  });

  /** Add a key the way the screen does, and hand back its id. */
  async function addKey(
    app: Awaited<ReturnType<typeof server>>,
    name: string,
    apiKey: string,
    provider?: string,
  ): Promise<string> {
    const added = await app.inject({
      method: "POST",
      url: "/api/models/keys",
      payload: { name, apiKey, ...(provider ? { provider } : {}) },
    });

    expect(added.statusCode).toBe(200);
    expect(added.body).not.toContain(apiKey);

    const stored = added.json().keys.find((one: { name: string }) => one.name === name);
    return stored.id;
  }

  /** What a probe would have answered, without a provider or a bill. */
  let probed: { status: "ok" | "answered" | "failed"; error?: string } = { status: "ok" };

  async function server(userId: string, store = true) {
    return buildServer({
      session: asUser(userId),
      env: loadEnv({
        DATABASE_URL: database.url,
        AI_PROVIDER: "anthropic",
        AI_MODEL: "claude-haiku-4-5",
      }),
      logger,
      db,
      encryption: store ? encryption : {},
      queryGenerator: null,
      modelProbe: async (config) => ({
        status: probed.status,
        ...(probed.error ? { error: probed.error } : {}),
        call: {
          provider: config.provider,
          model: config.model,
          inputTokens: 12,
          outputTokens: 3,
          latencyMs: 640,
          estimatedCostMicros: 41,
        },
      }),
    });
  }

  async function withServer<T>(
    userId: string,
    body: (app: Awaited<ReturnType<typeof server>>) => Promise<T>,
  ) {
    const app = await server(userId);
    try {
      return await body(app);
    } finally {
      await app.close();
    }
  }

  it("tells the screen what an empty field falls back to", async () => {
    await withServer(owner, async (app) => {
      const view = (await app.inject({ method: "GET", url: "/api/models" })).json();
      const classify = view.tasks.find((task: { task: string }) => task.task === "classify");

      // US-070 added the fourth. The order is the order the screen shows.
      expect(view.tasks.map((task: { task: string }) => task.task)).toEqual([
        "classify",
        "triage",
        "embed",
        "draft",
      ]);
      // `hasKey` false: this instance names a provider and stores no key, so
      // "the instance's key" would be no key at all.
      expect(classify.instance).toEqual({
        provider: "anthropic",
        model: "claude-haiku-4-5",
        hasKey: false,
      });
      expect(classify.provider).toBeNull();
      expect(classify.keyId).toBeNull();
    });
  });

  it("offers only the providers that can embed, for embedding", async () => {
    await withServer(owner, async (app) => {
      const view = (await app.inject({ method: "GET", url: "/api/models" })).json();
      const embed = view.tasks.find((task: { task: string }) => task.task === "embed");

      // Anthropic publishes no embedding endpoint, so offering it would be a
      // choice that fails every call.
      expect(embed.providers).not.toContain("anthropic");
      expect(embed.providers).toContain("openai");
    });
  });

  it("stores a key as a mask and never returns it", async () => {
    await withServer(owner, async (app) => {
      const keyId = await addKey(app, "My OpenAI key", "sk-1234567890abcd", "openai");

      const saved = await app.inject({
        method: "PUT",
        url: "/api/models/classify",
        payload: { provider: "openai", model: "gpt-5.6-terra", keyId },
      });

      expect(saved.statusCode).toBe(200);
      expect(saved.body).not.toContain("sk-1234567890abcd");

      const [stored] = saved.json().keys;
      expect(stored.hint).toBe("••••abcd");
      expect(stored.provider).toBe("openai");

      const classify = saved
        .json()
        .tasks.find((task: { task: string }) => task.task === "classify");
      expect(classify.keyId).toBe(keyId);
      expect(classify.model).toBe("gpt-5.6-terra");
    });

    // And it is the key the worker would use.
    const mine = await readAiEnvironment(
      db,
      owner,
      { AI_PROVIDER: "anthropic", AI_MODEL: "claude-haiku-4-5", AI_TIMEOUT_MS: 30_000 },
      encryption,
    );
    expect(mine.AI_API_KEY).toBe("sk-1234567890abcd");
  });

  /**
   * US-079: one key, added once, chosen by as many jobs as a person likes.
   */
  it("lets two jobs point at one key", async () => {
    await withServer(owner, async (app) => {
      const keyId = await addKey(app, "My OpenAI key", "sk-1234567890abcd", "openai");

      await app.inject({
        method: "PUT",
        url: "/api/models/draft",
        payload: { provider: "openai", model: "gpt-5.6-terra", keyId },
      });

      const view = await app.inject({
        method: "PUT",
        url: "/api/models/triage",
        payload: { provider: "openai", model: "gpt-5.6-luna", keyId },
      });

      const tasks = view.json().tasks as { task: string; keyId: string | null }[];

      expect(tasks.find((task) => task.task === "triage")?.keyId).toBe(keyId);
      expect(tasks.find((task) => task.task === "draft")?.keyId).toBe(keyId);
      // Scoring was never pointed at it, so it stays on the instance's key.
      expect(tasks.find((task) => task.task === "classify")?.keyId).toBeNull();
      // One key on the account, whatever the number of jobs using it.
      expect(view.json().keys).toHaveLength(1);
    });
  });

  /**
   * The owner's question: why ask which provider, when the key said so?
   *
   * It does not any more. The key's own provider is written to the job, so
   * the screen, the worker and `config.ts` read one answer rather than two
   * that can disagree.
   */
  /**
   * Whether the machine could run a job at all.
   *
   * A hosted account's instance holds no model key, so offering "this
   * instance's key" there offers a job that cannot run — and the way that
   * shows up is a poll that scores nothing.
   */
  it("says whether the instance holds a key for each job", async () => {
    const app = await buildServer({
      session: asUser(owner),
      env: loadEnv({
        DATABASE_URL: database.url,
        AI_PROVIDER: "anthropic",
        AI_MODEL: "claude-haiku-4-5",
        AI_API_KEY: "the-machine-key",
      }),
      logger,
      db,
      encryption,
      queryGenerator: null,
    });

    try {
      const view = (await app.inject({ method: "GET", url: "/api/models" })).json();
      const of = (task: string) =>
        view.tasks.find((one: { task: string }) => one.task === task).instance;

      expect(of("classify").hasKey).toBe(true);
      // Triage falls back to the classifier's key, so it has one too.
      expect(of("triage").hasKey).toBe(true);
      // Similarity does not: Anthropic publishes no embedding endpoint, so
      // there is no embedding configuration to hold a key.
      expect(of("embed").hasKey).toBe(false);
    } finally {
      await app.close();
    }
  });

  /**
   * The machine's key is the machine's, on an instance taking registrations.
   * US-081. A stranger who registers must not classify on the owner's key, and
   * the screen must not offer them one.
   */
  it("offers no instance key when this deployment takes registrations", async () => {
    const app = await buildServer({
      session: asUser(owner),
      env: loadEnv({
        DATABASE_URL: database.url,
        AI_PROVIDER: "anthropic",
        AI_MODEL: "claude-haiku-4-5",
        AI_API_KEY: "the-machine-key",
        AUTH_SIGNUP: "open",
      }),
      logger,
      db,
      encryption,
      queryGenerator: null,
    });

    try {
      const view = (await app.inject({ method: "GET", url: "/api/models" })).json();
      const classify = view.tasks.find((task: { task: string }) => task.task === "classify");

      // The provider and the model are still the deployment's. Only the key is
      // somebody's money, and it does not travel.
      expect(classify.instance.provider).toBe("anthropic");
      expect(classify.instance.model).toBe("claude-haiku-4-5");
      expect(classify.instance.hasKey).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("sends the priced models of each provider, and not one list", async () => {
    await withServer(owner, async (app) => {
      const view = (await app.inject({ method: "GET", url: "/api/models" })).json();

      expect(view.pricedModels.anthropic).toContain("claude-haiku-4-5");
      expect(view.pricedModels.anthropic).not.toContain("gpt-5.6-luna");
      expect(view.pricedModels.openai).toContain("gpt-5.6-luna");
      // Ollama runs whatever somebody pulled, so this build prices none of it.
      expect(view.pricedModels.ollama).toEqual([]);
    });
  });

  it("takes the provider from the chosen key", async () => {
    await withServer(owner, async (app) => {
      const keyId = await addKey(app, "My OpenAI key", "sk-1234567890abcd", "openai");

      // The body says nothing about a provider, and the job ends up on one.
      const saved = await app.inject({
        method: "PUT",
        url: "/api/models/classify",
        payload: { model: "gpt-5.6-terra", keyId },
      });

      const classify = saved
        .json()
        .tasks.find((task: { task: string }) => task.task === "classify");

      expect(classify.provider).toBe("openai");
    });
  });

  it("refuses a job on another provider with no model of its own", async () => {
    await withServer(owner, async (app) => {
      const keyId = await addKey(app, "My OpenAI key", "sk-1234567890abcd", "openai");

      const refused = await app.inject({
        method: "PUT",
        url: "/api/models/classify",
        payload: { keyId },
      });

      expect(refused.statusCode).toBe(400);
      // `claude-haiku-4-5` is not a name OpenAI answers to, so saving this
      // would store a setting that fails every call at whatever hour the
      // schedule picked.
      expect(refused.json().message).toContain("needs a model of its own");
      expect(await db.select().from(aiSettings)).toEqual([]);

      // With one named, it saves.
      const saved = await app.inject({
        method: "PUT",
        url: "/api/models/classify",
        payload: { keyId, model: "gpt-5.6-terra" },
      });

      expect(saved.statusCode).toBe(200);
    });
  });

  it("refuses a key whose provider this build cannot use for that job", async () => {
    await withServer(owner, async (app) => {
      // Anthropic publishes no embedding endpoint, so this pairing can only
      // fail — and it fails here rather than at 02:00 on the next poll.
      const keyId = await addKey(app, "My Anthropic key", "sk-1234567890abcd", "anthropic");

      const refused = await app.inject({
        method: "PUT",
        url: "/api/models/embed",
        payload: { keyId },
      });

      expect(refused.statusCode).toBe(400);
      // Named, because "anthropic is not a provider" would be a puzzle to
      // somebody who chose a key rather than a provider.
      expect(refused.json().message).toContain("My Anthropic key");
      expect(await db.select().from(aiSettings)).toEqual([]);
    });
  });

  /**
   * Testing a key. US-080.
   *
   * The route is the one place in this product that spends money because
   * somebody pressed a button, so what it owns is refusing before it spends
   * and writing down what it spent.
   */
  describe("testing a job's key", () => {
    it("refuses before it spends when the key is not this account's", async () => {
      let theirs = "";

      await withServer(other, async (app) => {
        theirs = await addKey(app, "Their key", "sk-theirs-000000abcd", "openai");
      });

      await withServer(owner, async (app) => {
        const refused = await app.inject({
          method: "POST",
          url: "/api/models/classify/test",
          payload: { keyId: theirs, model: "gpt-5.6-terra" },
        });

        expect(refused.statusCode).toBe(400);
        expect(refused.json().message).toContain("not on this account");
        expect(await db.select().from(modelCalls)).toEqual([]);
      });
    });

    /**
     * Test first, then keep. The route reads the body rather than the row, so
     * nothing has to be saved before it can be doubted.
     */
    it("tests what is on the screen, and saves nothing", async () => {
      await withServer(owner, async (app) => {
        const keyId = await addKey(app, "My OpenAI key", "sk-1234567890abcd", "openai");

        const tested = await app.inject({
          method: "POST",
          url: "/api/models/classify/test",
          payload: { keyId, model: "gpt-5.6-terra" },
        });

        expect(tested.statusCode).toBe(200);
        expect(tested.json()).toMatchObject({
          status: "ok",
          provider: "openai",
          model: "gpt-5.6-terra",
          costMicros: 41,
        });
        // Never the key, in the answer or anywhere near it.
        expect(tested.body).not.toContain("sk-1234567890abcd");

        // A billed call is a recorded call, and it is its own purpose so that
        // a test is never counted as work a monitor did.
        const [recorded] = await db.select().from(modelCalls);
        expect(recorded?.purpose).toBe("key_test");
        expect(recorded?.outcome).toBe("scored");
        expect(recorded?.monitorId).toBeNull();
        expect(recorded?.estimatedCostMicros).toBe(41);

        // A test is a call and not a save. The job is untouched.
        expect(await db.select().from(aiSettings)).toEqual([]);
      });
    });

    it("carries the provider's own sentence back when the call fails", async () => {
      probed = { status: "failed", error: "401 Incorrect API key provided." };

      await withServer(owner, async (app) => {
        const keyId = await addKey(app, "A wrong key", "sk-wrong-000000abcd", "openai");

        const tested = await app.inject({
          method: "POST",
          url: "/api/models/classify/test",
          payload: { keyId, model: "gpt-5.6-terra" },
        });

        expect(tested.json()).toMatchObject({
          status: "failed",
          error: "401 Incorrect API key provided.",
        });

        // A refused call is billed by some providers and is a fact either way.
        const [recorded] = await db.select().from(modelCalls);
        expect(recorded?.outcome).toBe("failed");
        expect(recorded?.error).toContain("401");
      });
    });
  });

  it("refuses a key that belongs to another account", async () => {
    let theirs = "";

    await withServer(other, async (app) => {
      theirs = await addKey(app, "Their key", "sk-theirs-000000abcd");
    });

    await withServer(owner, async (app) => {
      const refused = await app.inject({
        method: "PUT",
        url: "/api/models/classify",
        payload: { keyId: theirs },
      });

      expect(refused.statusCode).toBe(400);
      expect(await db.select().from(aiSettings)).toEqual([]);
    });
  });

  /**
   * Deleting a key is not deleting a job. Every job pointing at it goes back
   * to the instance's key, which the column's own `set null` does — a job left
   * pointing at nothing would fail every call with nothing able to say why.
   */
  it("puts a job back on the instance's key when the key is deleted", async () => {
    await withServer(owner, async (app) => {
      const keyId = await addKey(app, "Going away", "sk-1234567890abcd");

      await app.inject({
        method: "PUT",
        url: "/api/models/classify",
        payload: { model: "gpt-5.6-terra", keyId },
      });

      const after = await app.inject({ method: "DELETE", url: `/api/models/keys/${keyId}` });
      const classify = after
        .json()
        .tasks.find((task: { task: string }) => task.task === "classify");

      expect(after.json().keys).toEqual([]);
      expect(classify.keyId).toBeNull();
      // The rest of the job's settings survive it.
      expect(classify.model).toBe("gpt-5.6-terra");
    });
  });

  it("refuses a second key with the same name", async () => {
    await withServer(owner, async (app) => {
      await addKey(app, "My key", "sk-1234567890abcd");

      const again = await app.inject({
        method: "POST",
        url: "/api/models/keys",
        payload: { name: "my key", apiKey: "sk-something-else-1234" },
      });

      expect(again.statusCode).toBe(409);
    });
  });

  /**
   * The silent one. The form posts every field on every save, so a blank key
   * box has to mean "unchanged" — erasing it would look like a poll that
   * scored nothing, days later.
   */
  it("leaves the chosen key alone when a save carries no choice", async () => {
    await withServer(owner, async (app) => {
      const keyId = await addKey(app, "My key", "sk-1234567890abcd");

      await app.inject({ method: "PUT", url: "/api/models/classify", payload: { keyId } });

      const again = await app.inject({
        method: "PUT",
        url: "/api/models/classify",
        payload: { model: "gpt-5.6-luna" },
      });

      const classify = again
        .json()
        .tasks.find((task: { task: string }) => task.task === "classify");

      expect(classify.keyId).toBe(keyId);
      expect(classify.model).toBe("gpt-5.6-luna");
    });
  });

  it("refuses a provider this build cannot use for that task", async () => {
    await withServer(owner, async (app) => {
      const refused = await app.inject({
        method: "PUT",
        url: "/api/models/embed",
        payload: { provider: "anthropic" },
      });

      expect(refused.statusCode).toBe(400);
      expect(refused.json().message).toContain("anthropic");
      expect(await db.select().from(aiSettings)).toEqual([]);
    });
  });

  it("puts a task back on the instance's settings when it is cleared", async () => {
    await withServer(owner, async (app) => {
      const keyId = await addKey(app, "My key", "sk-1234567890abcd");

      await app.inject({
        method: "PUT",
        url: "/api/models/classify",
        payload: { provider: "openai", keyId },
      });

      const cleared = await app.inject({ method: "DELETE", url: "/api/models/classify" });
      const classify = cleared
        .json()
        .tasks.find((task: { task: string }) => task.task === "classify");

      expect(classify.provider).toBeNull();
      expect(classify.keyId).toBeNull();
      expect(await db.select().from(aiSettings)).toEqual([]);
      // Clearing a job is not deleting a key. It is still on the account.
      expect(cleared.json().keys).toHaveLength(1);
    });
  });

  it("keeps one account's model settings out of another's", async () => {
    await withServer(owner, async (app) => {
      const keyId = await addKey(app, "My key", "sk-1234567890abcd");

      await app.inject({
        method: "PUT",
        url: "/api/models/classify",
        payload: { provider: "openai", keyId },
      });
    });

    await withServer(other, async (app) => {
      const view = (await app.inject({ method: "GET", url: "/api/models" })).json();
      const classify = view.tasks.find((task: { task: string }) => task.task === "classify");

      expect(classify.provider).toBeNull();
      expect(classify.keyId).toBeNull();
      // Not one key, and not one job pointed anywhere.
      expect(view.keys).toEqual([]);
      expect(view.tasks.some((task: { keyId: string | null }) => task.keyId)).toBe(false);
    });
  });

  /**
   * One pasted key, and the four jobs run. US-083.
   *
   * The route half of it: the list says which key is the default, the view
   * says what each job will therefore run, and a job somebody configured says
   * its own answer instead.
   */
  describe("the default key", () => {
    it("makes the first key the default and says so in the list", async () => {
      await withServer(owner, async (app) => {
        await addKey(app, "First", "sk-first", "openai");
        await addKey(app, "Second", "sk-second", "anthropic");

        const view = (await app.inject({ method: "GET", url: "/api/models" })).json();

        // Listed by name, so the assertion is about the flag and not the order.
        expect(view.keys).toMatchObject([
          { name: "First", isDefault: true },
          { name: "Second", isDefault: false },
        ]);
      });
    });

    it("tells the screen every job now runs on that key's recommended model", async () => {
      await withServer(owner, async (app) => {
        await addKey(app, "Mine", "sk-openai", "openai");
        const view = (await app.inject({ method: "GET", url: "/api/models" })).json();
        const by = (task: string) =>
          view.tasks.find((one: { task: string }) => one.task === task).fallback;

        expect(by("classify")).toEqual({
          source: "key",
          provider: "openai",
          model: "gpt-5.6-terra",
          hasKey: true,
          keyName: "Mine",
          keyId: view.keys[0].id,
        });
        expect(by("triage").model).toBe("gpt-5.6-luna");
        expect(by("draft").model).toBe("gpt-6-astra");
        expect(by("embed").model).toBe("text-embedding-3-small");

        // And the machine's own answer is still reported beside it, unchanged.
        expect(
          view.tasks.find((one: { task: string }) => one.task === "classify").instance,
        ).toEqual({ provider: "anthropic", model: "claude-haiku-4-5", hasKey: false });
      });
    });

    it("moves every following job when the default moves", async () => {
      await withServer(owner, async (app) => {
        await addKey(app, "OpenAI", "sk-openai", "openai");
        const anthropic = await addKey(app, "Anthropic", "sk-anthropic", "anthropic");

        const moved = await app.inject({
          method: "PUT",
          url: `/api/models/keys/${anthropic}/default`,
        });

        expect(moved.statusCode).toBe(200);
        expect(moved.body).not.toContain("sk-anthropic");

        const classify = moved
          .json()
          .tasks.find((one: { task: string }) => one.task === "classify");

        expect(classify.fallback).toMatchObject({
          source: "key",
          provider: "anthropic",
          model: "claude-sonnet-5",
          keyName: "Anthropic",
        });
        // Anthropic publishes no embedding endpoint, so similarity goes back
        // to the machine rather than onto a key that cannot do the job.
        expect(
          moved.json().tasks.find((one: { task: string }) => one.task === "embed").fallback.source,
        ).toBe("instance");
      });
    });

    it("says the machine answers for a provider it can name no model on", async () => {
      await withServer(owner, async (app) => {
        await addKey(app, "Gateway", "sk-router", "openrouter");
        const view = (await app.inject({ method: "GET", url: "/api/models" })).json();

        expect(
          view.tasks.find((one: { task: string }) => one.task === "classify").fallback,
        ).toEqual({
          source: "instance",
          provider: "anthropic",
          model: "claude-haiku-4-5",
          hasKey: false,
          keyName: null,
          keyId: null,
        });
      });
    });

    it("leaves no default when the default key is removed", async () => {
      await withServer(owner, async (app) => {
        const first = await addKey(app, "First", "sk-first", "openai");
        await addKey(app, "Second", "sk-second", "openai");

        const after = await app.inject({ method: "DELETE", url: `/api/models/keys/${first}` });

        expect(after.json().keys).toMatchObject([{ name: "Second", isDefault: false }]);
        expect(
          after.json().tasks.find((one: { task: string }) => one.task === "classify").fallback
            .source,
        ).toBe("instance");
      });
    });

    it("refuses to make another account's key the default", async () => {
      const theirs = await withServer(other, async (app) =>
        addKey(app, "Theirs", "sk-theirs", "openai"),
      );

      await withServer(owner, async (app) => {
        const refused = await app.inject({
          method: "PUT",
          url: `/api/models/keys/${theirs}/default`,
        });

        expect(refused.statusCode).toBe(404);
        expect(
          (await app.inject({ method: "GET", url: "/api/models" })).json().tasks[0].fallback.source,
        ).toBe("instance");
      });
    });
  });

  it("says why, rather than failing, on an instance that cannot store a key", async () => {
    const app = await server(owner, false);

    try {
      const view = (await app.inject({ method: "GET", url: "/api/models" })).json();
      expect(view.canStore).toBe(false);
      expect(view.storeBlocker).toContain("ENCRYPTION_KEY");

      const refused = await app.inject({
        method: "POST",
        url: "/api/models/keys",
        payload: { name: "Nowhere to put it", apiKey: "sk-1234567890abcd" },
      });

      expect(refused.statusCode).toBe(400);
      expect(refused.json().message).toContain("ENCRYPTION_KEY");

      // A model with no key is still a legitimate change, so it is allowed:
      // a local Ollama needs no key at all.
      const allowed = await app.inject({
        method: "PUT",
        url: "/api/models/classify",
        payload: { provider: "ollama", model: "llama3" },
      });

      expect(allowed.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
