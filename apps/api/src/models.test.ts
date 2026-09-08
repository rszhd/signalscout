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
  aiSettings,
  createDatabase,
  createLogger,
  type Database,
  loadEnv,
  readAiEnvironment,
} from "@intentwatch/core";
import { createTestDatabase, type TestDatabase } from "@intentwatch/core/testing";
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
    await db.delete(aiSettings);
  });

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
      expect(classify.instance).toEqual({ provider: "anthropic", model: "claude-haiku-4-5" });
      expect(classify.provider).toBeNull();
      expect(classify.keyHint).toBeNull();
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
      const saved = await app.inject({
        method: "PUT",
        url: "/api/models/classify",
        payload: { provider: "openai", model: "gpt-5.6-terra", apiKey: "sk-1234567890abcd" },
      });

      expect(saved.statusCode).toBe(200);
      expect(saved.body).not.toContain("sk-1234567890abcd");

      const classify = saved
        .json()
        .tasks.find((task: { task: string }) => task.task === "classify");
      expect(classify.keyHint).toBe("••••abcd");
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
   * The silent one. The form posts every field on every save, so a blank key
   * box has to mean "unchanged" — erasing it would look like a poll that
   * scored nothing, days later.
   */
  it("leaves a stored key alone when a save carries no key", async () => {
    await withServer(owner, async (app) => {
      await app.inject({
        method: "PUT",
        url: "/api/models/classify",
        payload: { apiKey: "sk-1234567890abcd" },
      });

      const again = await app.inject({
        method: "PUT",
        url: "/api/models/classify",
        payload: { model: "gpt-5.6-luna" },
      });

      const classify = again
        .json()
        .tasks.find((task: { task: string }) => task.task === "classify");

      expect(classify.keyHint).toBe("••••abcd");
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
      await app.inject({
        method: "PUT",
        url: "/api/models/classify",
        payload: { provider: "openai", apiKey: "sk-1234567890abcd" },
      });

      const cleared = await app.inject({ method: "DELETE", url: "/api/models/classify" });
      const classify = cleared
        .json()
        .tasks.find((task: { task: string }) => task.task === "classify");

      expect(classify.provider).toBeNull();
      expect(classify.keyHint).toBeNull();
      expect(await db.select().from(aiSettings)).toEqual([]);
    });
  });

  it("keeps one account's model settings out of another's", async () => {
    await withServer(owner, async (app) => {
      await app.inject({
        method: "PUT",
        url: "/api/models/classify",
        payload: { provider: "openai", apiKey: "sk-1234567890abcd" },
      });
    });

    await withServer(other, async (app) => {
      const view = (await app.inject({ method: "GET", url: "/api/models" })).json();
      const classify = view.tasks.find((task: { task: string }) => task.task === "classify");

      expect(classify.provider).toBeNull();
      expect(classify.keyHint).toBeNull();
      expect(view.tasks.some((task: { keyHint: string | null }) => task.keyHint)).toBe(false);
    });
  });

  it("says why, rather than failing, on an instance that cannot store a key", async () => {
    const app = await server(owner, false);

    try {
      const view = (await app.inject({ method: "GET", url: "/api/models" })).json();
      expect(view.canStore).toBe(false);
      expect(view.storeBlocker).toContain("ENCRYPTION_KEY");

      const refused = await app.inject({
        method: "PUT",
        url: "/api/models/classify",
        payload: { apiKey: "sk-1234567890abcd" },
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
