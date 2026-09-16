import { describe, expect, it } from "vitest";
import { loadPipelineEnv } from "./env.js";

/**
 * The pipeline's own settings, parsed alone. The application's schema wraps
 * these and its test — `apps/api/src/config/env.test.ts` — covers the model
 * and encryption cases through the wrapper; this is the half a script that
 * runs the pipeline without the application gets.
 */
describe("loadPipelineEnv", () => {
  it("refuses to start without a database URL", () => {
    expect(() => loadPipelineEnv({})).toThrow(/DATABASE_URL/);
  });

  it("knows nothing about where the application listens", () => {
    const env = loadPipelineEnv({ DATABASE_URL: "postgres://x", PORT: "9" });

    expect("PORT" in env).toBe(false);
    expect("BILLING_MODE" in env).toBe(false);
  });

  it("defaults signup to closed, because every instance running today is self-hosted", () => {
    expect(loadPipelineEnv({ DATABASE_URL: "postgres://x" }).AUTH_SIGNUP).toBe("closed");
  });
});
