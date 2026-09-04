import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, loadEnv } from "@intentwatch/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";

const logger = createLogger({ level: "silent", name: "test" });

/**
 * One Fastify process serves the API and the built UI. Two claims follow from
 * that, and each needs the built UI to actually be there: an unknown /api/
 * path is a 404, and any other unknown path is the single-page app's own
 * route. With no UI on disk the fallback never installs, and both assertions
 * pass while proving nothing.
 */
describe("the API and the UI on one port", () => {
  let webDist: string;

  beforeAll(() => {
    webDist = mkdtempSync(join(tmpdir(), "intentwatch-web-"));
    writeFileSync(join(webDist, "index.html"), "<!doctype html><title>IntentWatch</title>");
    writeFileSync(join(webDist, "asset.js"), "export const built = true;\n");
  });

  afterAll(() => {
    rmSync(webDist, { recursive: true, force: true });
  });

  async function server(overrides: Record<string, string> = {}) {
    const env = loadEnv({
      DATABASE_URL: "postgres://user:pw@localhost:5432/unused",
      WEB_DIST_PATH: webDist,
      ...overrides,
    });

    return buildServer({ env, logger });
  }

  it("answers /api/health with the worker mode it is running in", async () => {
    const app = await server({ WORKER_IN_PROCESS: "false" });

    try {
      const response = await app.inject({ method: "GET", url: "/api/health" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "ok", workerInProcess: false });
    } finally {
      await app.close();
    }
  });

  it("serves the built UI at the root", async () => {
    const app = await server();

    try {
      const response = await app.inject({ method: "GET", url: "/" });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("IntentWatch");
    } finally {
      await app.close();
    }
  });

  it("serves a built asset", async () => {
    const app = await server();

    try {
      const response = await app.inject({ method: "GET", url: "/asset.js" });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("built = true");
    } finally {
      await app.close();
    }
  });

  it("hands an unknown page route to the single-page app", async () => {
    const app = await server();

    try {
      const response = await app.inject({ method: "GET", url: "/monitors/42" });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("IntentWatch");
    } finally {
      await app.close();
    }
  });

  it("answers an unknown API route with 404, not with the UI shell", async () => {
    const app = await server();

    try {
      const response = await app.inject({ method: "GET", url: "/api/nope" });

      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain("IntentWatch");
    } finally {
      await app.close();
    }
  });
});
