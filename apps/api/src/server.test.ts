import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, createLogger, loadEnv } from "@signalscout/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer, verificationSenderFor } from "./server.js";
import { asOwner } from "./testing.js";

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
  // A pool over a URL nothing connects to. No route below runs a query, and
  // `pg` opens no connection until one does.
  const database = createDatabase("postgres://user:pw@localhost:5432/unused");

  beforeAll(() => {
    webDist = mkdtempSync(join(tmpdir(), "signalscout-web-"));
    writeFileSync(join(webDist, "index.html"), "<!doctype html><title>SignalScout</title>");
    writeFileSync(join(webDist, "asset.js"), "export const built = true;\n");
  });

  afterAll(async () => {
    rmSync(webDist, { recursive: true, force: true });
    await database.close();
  });

  async function server(overrides: Record<string, string> = {}) {
    const env = loadEnv({
      DATABASE_URL: "postgres://user:pw@localhost:5432/unused",
      WEB_DIST_PATH: webDist,
      ...overrides,
    });

    return buildServer({ session: asOwner, env, logger, db: database.db, queryGenerator: null });
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
      expect(response.body).toContain("SignalScout");
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
      expect(response.body).toContain("SignalScout");
    } finally {
      await app.close();
    }
  });

  it("answers an unknown API route with 404, not with the UI shell", async () => {
    const app = await server();

    try {
      const response = await app.inject({ method: "GET", url: "/api/nope" });

      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain("SignalScout");
    } finally {
      await app.close();
    }
  });
});

/**
 * How a verification link leaves this instance. US-092.
 *
 * The point of these three cases is the seam between two files that both
 * decide what a working mailer is: `emailVerificationRequired` refuses to boot
 * without one, and `notificationReadiness` decides whether US-016 builds one.
 * If they ever disagree, `authFor` would hand `createAuth` an undefined sender
 * and the requirement would quietly vanish.
 *
 * Nothing here connects to anything. Nodemailer opens no socket until a
 * message is sent, and no message is sent.
 */
describe("the sender a verification link leaves through", () => {
  const base = { DATABASE_URL: "postgres://unused/unused", AUTH_SECRET: "x".repeat(32) };

  it("is absent on a deployment that does not verify", () => {
    expect(verificationSenderFor(loadEnv(base))).toBeUndefined();
    // Even with SMTP configured, because US-016's digests are a different
    // question from whether a login requires a link.
    expect(
      verificationSenderFor(
        loadEnv({ ...base, SMTP_HOST: "smtp.example.test", SMTP_FROM: "a@example.test" }),
      ),
    ).toBeUndefined();
  });

  it("is present where the deployment verifies and can send", () => {
    const send = verificationSenderFor(
      loadEnv({
        ...base,
        AUTH_EMAIL_VERIFICATION: "required",
        SMTP_HOST: "smtp.example.test",
        SMTP_FROM: "a@example.test",
      }),
    );

    expect(typeof send).toBe("function");
  });

  it("refuses a deployment that verifies and cannot send", () => {
    expect(() =>
      verificationSenderFor(loadEnv({ ...base, AUTH_EMAIL_VERIFICATION: "required" })),
    ).toThrow(/SMTP_HOST/);
  });
});
