import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const minimal = { DATABASE_URL: "postgres://user:pw@localhost:5432/intentwatch" };

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
