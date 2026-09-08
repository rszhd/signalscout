import { describe, expect, it } from "vitest";
import { generateEncryptionKey } from "../secrets/cipher.js";
import { loadEnv } from "./env.js";

const minimal = { DATABASE_URL: "postgres://user:pw@localhost:5432/signalscout" };

describe("loadEnv", () => {
  it("refuses to start without a database URL", () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });

  it("defaults to one process, port 3000, info logging", () => {
    const env = loadEnv(minimal);

    expect(env.PORT).toBe(3000);
    expect(env.WORKER_IN_PROCESS).toBe(true);
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("reads WORKER_IN_PROCESS as a boolean, not as a truthy string", () => {
    expect(loadEnv({ ...minimal, WORKER_IN_PROCESS: "false" }).WORKER_IN_PROCESS).toBe(false);
    expect(loadEnv({ ...minimal, WORKER_IN_PROCESS: "true" }).WORKER_IN_PROCESS).toBe(true);
  });

  it("rejects a WORKER_IN_PROCESS value that is neither true nor false", () => {
    // "0" and "no" read as false to a person and as true to JavaScript.
    // Failing to start is the only safe answer.
    expect(() => loadEnv({ ...minimal, WORKER_IN_PROCESS: "0" })).toThrow(/WORKER_IN_PROCESS/);
    expect(() => loadEnv({ ...minimal, WORKER_IN_PROCESS: "no" })).toThrow(/WORKER_IN_PROCESS/);
  });

  it("rejects a port that is not a port", () => {
    expect(() => loadEnv({ ...minimal, PORT: "not-a-number" })).toThrow(/PORT/);
    expect(() => loadEnv({ ...minimal, PORT: "70000" })).toThrow(/PORT/);
  });
});

describe("the AI provider", () => {
  it("defaults to a cheap hosted model with no key", () => {
    const env = loadEnv(minimal);

    expect(env.AI_PROVIDER).toBe("anthropic");
    expect(env.AI_MODEL).toBe("claude-haiku-4-5");
    expect(env.AI_API_KEY).toBeUndefined();
    expect(env.AI_TIMEOUT_MS).toBe(30_000);
  });

  it("switches to a local model without any other change", () => {
    const env = loadEnv({ ...minimal, AI_PROVIDER: "ollama", AI_MODEL: "llama3.2" });

    expect(env.AI_PROVIDER).toBe("ollama");
    expect(env.AI_MODEL).toBe("llama3.2");
  });

  it("rejects a provider we have no client for", () => {
    expect(() => loadEnv({ ...minimal, AI_PROVIDER: "some-startup" })).toThrow(/AI_PROVIDER/);
  });

  // `.env.example` ships blank values and `pnpm dev` copies it, so a present
  // but empty variable must read as absent rather than stop the process.
  it("reads a blank value as an unset one", () => {
    const env = loadEnv({ ...minimal, AI_API_KEY: "", AI_MODEL: "", AI_INPUT_PRICE_MICROS: "" });

    expect(env.AI_API_KEY).toBeUndefined();
    expect(env.AI_MODEL).toBe("claude-haiku-4-5");
    expect(env.AI_INPUT_PRICE_MICROS).toBeUndefined();
  });

  describe("ENCRYPTION_KEY", () => {
    it("accepts a generated key", () => {
      const key = generateEncryptionKey();

      expect(loadEnv({ ...minimal, ENCRYPTION_KEY: key }).ENCRYPTION_KEY).toBe(key);
    });

    it("is optional, because a key in .env needs no key to encrypt it", () => {
      expect(loadEnv(minimal).ENCRYPTION_KEY).toBeUndefined();
      expect(loadEnv({ ...minimal, ENCRYPTION_KEY: "" }).ENCRYPTION_KEY).toBeUndefined();
    });

    it("refuses a key of the wrong length at boot, and says how to make one", () => {
      // Half a paste. It must not survive to the first encrypt.
      const half = generateEncryptionKey().slice(0, 22);

      expect(() => loadEnv({ ...minimal, ENCRYPTION_KEY: half })).toThrow(/ENCRYPTION_KEY/);
      expect(() => loadEnv({ ...minimal, ENCRYPTION_KEY: half })).toThrow(
        /openssl rand -base64 32/,
      );
    });

    it("refuses a key that is not base64", () => {
      expect(() => loadEnv({ ...minimal, ENCRYPTION_KEY: "not a key at all" })).toThrow(
        /ENCRYPTION_KEY/,
      );
    });
  });
});
