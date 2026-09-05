import { randomUUID } from "node:crypto";
import {
  createDatabase,
  createLogger,
  type Database,
  loadEnv,
  notificationDefaults,
  readNotificationSettings,
} from "@intentwatch/core";
import { createTestDatabase, type TestDatabase } from "@intentwatch/core/testing";
import { afterAll, beforeAll, expect, it } from "vitest";
import { insertMonitor } from "../../../packages/core/src/worker/testing.js";
import { buildServer } from "./server.js";

let database: TestDatabase;
let db: Database;
let pool: ReturnType<typeof createDatabase>["pool"];
let close: () => Promise<void>;
beforeAll(async () => {
  database = await createTestDatabase("notification_routes");
  ({ db, close, pool } = createDatabase(database.url));
});
afterAll(async () => {
  await close?.();
  await database?.drop();
});
async function server(configured = true) {
  return buildServer({
    db,
    env: loadEnv({
      DATABASE_URL: database.url,
      ...(configured
        ? {
            SMTP_HOST: "smtp.resend.com",
            SMTP_FROM: "alerts@example.com",
            SMTP_USER: "resend",
            SMTP_PASSWORD: "private-smtp-key",
            WEBHOOK_SIGNING_SECRET: "private-webhook-key-at-least-32-characters",
          }
        : {}),
    }),
    logger: createLogger({ level: "silent", name: "test" }),
    queryGenerator: null,
  });
}
it("persists per-monitor settings without exposing SMTP credentials or signing keys", async () => {
  const app = await server();
  try {
    const id = await insertMonitor(database);
    const other = await insertMonitor(database);
    const path = `/api/monitors/${id}/notifications`;
    expect((await app.inject(path)).json().settings).toEqual(notificationDefaults);
    const values = {
      ...notificationDefaults,
      emailEnabled: true,
      emailTo: "owner@example.com",
      immediateScore: 85,
      webhookEnabled: true,
      webhookUrl: "https://receiver.example/hook",
    };
    const saved = await app.inject({ method: "PUT", url: path, payload: values });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().settings).toEqual(values);
    expect(await readNotificationSettings(db, id)).toMatchObject(values);
    expect((await app.inject(`/api/monitors/${other}/notifications`)).json().settings).toEqual(
      notificationDefaults,
    );
    await pool.query(
      "UPDATE notification_settings SET webhook_enabled = false, webhook_error = $1 WHERE monitor_id = $2",
      ["Webhook disabled after repeated delivery failures.", id],
    );
    expect((await app.inject(path)).json().webhookError).toContain("disabled");
    expect((await app.inject(`/api/monitors/${id}`)).json().notificationIssues).toEqual([
      "Webhook disabled after repeated delivery failures.",
    ]);
    const listed = (await app.inject("/api/monitors")).json();
    expect(listed.find((row: { id: string }) => row.id === id).notificationIssues).toEqual([
      "Webhook disabled after repeated delivery failures.",
    ]);
    for (const result of [saved, await app.inject(path)]) {
      expect(result.body).not.toContain("private-smtp-key");
      expect(result.body).not.toContain("private-webhook-key");
    }
    for (const payload of [
      { ...values, emailTo: "bad" },
      { ...values, webhookUrl: "http://example.com" },
      { ...values, digestHours: 0 },
      { ...values, immediateScore: 101 },
    ]) {
      expect((await app.inject({ method: "PUT", url: path, payload })).statusCode).toBe(400);
    }
    expect((await app.inject(`/api/monitors/${randomUUID()}/notifications`)).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/api/monitors/${randomUUID()}/notifications`,
          payload: notificationDefaults,
        })
      ).statusCode,
    ).toBe(404);
  } finally {
    await app.close();
  }
});
it("explains missing SMTP and signing settings without breaking the inbox", async () => {
  const app = await server(false);
  try {
    const id = await insertMonitor(database);
    const path = `/api/monitors/${id}/notifications`;
    expect((await app.inject(path)).json().smtpMissing).toEqual(["SMTP_HOST", "SMTP_FROM"]);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: path,
          payload: { emailEnabled: true, emailTo: "owner@example.com" },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: path,
          payload: { webhookEnabled: true, webhookUrl: "https://receiver.example/hook" },
        })
      ).statusCode,
    ).toBe(409);
    expect(await readNotificationSettings(db, id)).toBeNull();
    expect((await app.inject("/api/matches")).statusCode).toBe(200);
    expect(
      (await app.inject({ method: "PUT", url: path, payload: notificationDefaults })).statusCode,
    ).toBe(200);
  } finally {
    await app.close();
  }
});
