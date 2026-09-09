import { randomUUID } from "node:crypto";
import {
  createDatabase,
  createLogger,
  type Database,
  generateEncryptionKey,
  loadEnv,
  notificationDefaults,
  readNotificationSettings,
} from "@signalscout/core";
import { createTestDatabase, type TestDatabase } from "@signalscout/core/testing";
import { afterAll, beforeAll, expect, it } from "vitest";
import { insertMonitor } from "../../../packages/core/src/worker/testing.js";
import { buildServer } from "./server.js";
import { asUser } from "./testing.js";

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
const encryptionKey = generateEncryptionKey();

async function server(configured = true, userId = "user-1") {
  return buildServer({
    // The shared helper writes its monitors under this id.
    session: asUser(userId),
    db,
    encryption: { ENCRYPTION_KEY: encryptionKey },
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

it("gives an account a signing secret of its own, shown once", async () => {
  /**
   * US-096. Before this the instance had one secret and every account was told
   * to verify with it, so any of them could sign a payload another's receiver
   * accepted as genuine.
   */
  const app = await server();
  try {
    const id = await insertMonitor(database);

    const before = (await app.inject(`/api/monitors/${id}/notifications`)).json();
    expect(before.signingSecret).toMatchObject({
      hint: null,
      usingInstanceSecret: true,
      canStore: true,
    });

    const made = await app.inject({ method: "POST", url: "/api/notifications/signing-secret" });
    expect(made.statusCode).toBe(200);
    expect(made.json().secret).toMatch(/^[0-9a-f]{64}$/);
    expect(made.json().signingSecret.hint).toBe(`••••${made.json().secret.slice(-4)}`);

    // The value never comes back on a later read. That route is the only one
    // that ever carries it.
    const after = (await app.inject(`/api/monitors/${id}/notifications`)).json();
    expect(JSON.stringify(after)).not.toContain(made.json().secret);
    expect(after.signingSecret).toMatchObject({ usingInstanceSecret: false });
  } finally {
    await app.close();
  }
});

it("lets an account with its own secret enable a webhook on an instance with none", async () => {
  // The hosted shape: no WEBHOOK_SIGNING_SECRET in the environment at all.
  // Its own account, because these tests share one database and a secret made
  // by an earlier case would answer this one's first question for it.
  const owner = "webhook-secret-account";
  const app = await server(false, owner);
  try {
    const id = await insertMonitor(database, { userId: owner });
    const path = `/api/monitors/${id}/notifications`;

    expect((await app.inject(path)).json().webhookMissing).toEqual(["WEBHOOK_SIGNING_SECRET"]);

    const refused = await app.inject({
      method: "PUT",
      url: path,
      payload: {
        ...notificationDefaults,
        webhookEnabled: true,
        webhookUrl: "https://receiver.example/hook",
      },
    });
    expect(refused.statusCode).toBe(409);

    await app.inject({ method: "POST", url: "/api/notifications/signing-secret" });

    expect((await app.inject(path)).json().webhookMissing).toEqual([]);
    const accepted = await app.inject({
      method: "PUT",
      url: path,
      payload: {
        ...notificationDefaults,
        webhookEnabled: true,
        webhookUrl: "https://receiver.example/hook",
      },
    });
    expect(accepted.statusCode).toBe(200);
  } finally {
    await app.close();
  }
});

it("gives two accounts two different secrets", async () => {
  const a = await server(true, "account-a");
  const b = await server(true, "account-b");
  try {
    const first = (
      await a.inject({ method: "POST", url: "/api/notifications/signing-secret" })
    ).json().secret;
    const second = (
      await b.inject({ method: "POST", url: "/api/notifications/signing-secret" })
    ).json().secret;

    expect(first).not.toBe(second);
  } finally {
    await a.close();
    await b.close();
  }
});

it("gives up its own secret and signs with the instance's again", async () => {
  const app = await server();
  try {
    const id = await insertMonitor(database);
    await app.inject({ method: "POST", url: "/api/notifications/signing-secret" });

    const dropped = await app.inject({
      method: "DELETE",
      url: "/api/notifications/signing-secret",
    });

    expect(dropped.statusCode).toBe(200);
    expect(dropped.json().signingSecret).toMatchObject({
      hint: null,
      usingInstanceSecret: true,
    });
    expect((await app.inject(`/api/monitors/${id}/notifications`)).json().webhookMissing).toEqual(
      [],
    );
  } finally {
    await app.close();
  }
});

it("refuses to make one on an instance that cannot encrypt", async () => {
  const app = await buildServer({
    session: asUser("user-1"),
    db,
    encryption: {},
    env: loadEnv({ DATABASE_URL: database.url }),
    logger: createLogger({ level: "silent", name: "test" }),
    queryGenerator: null,
  });

  try {
    const refused = await app.inject({ method: "POST", url: "/api/notifications/signing-secret" });

    expect(refused.statusCode).toBe(409);
    expect(refused.json().message).toContain("ENCRYPTION_KEY");
  } finally {
    await app.close();
  }
});

it("does not let an open instance sign with the machine's own secret", async () => {
  /**
   * US-096, and the reason webhooks were not offered on the hosted version.
   * Where signup is open, `WEBHOOK_SIGNING_SECRET` is not an account's to sign
   * with: every account would hold the value every other account's deliveries
   * are signed with. So the screen reports it missing even though the
   * environment has one, and offers the button that makes an account its own.
   */
  const owner = "open-instance-account";
  const app = await buildServer({
    session: asUser(owner),
    db,
    encryption: { ENCRYPTION_KEY: encryptionKey },
    env: loadEnv({
      DATABASE_URL: database.url,
      AUTH_SIGNUP: "open",
      WEBHOOK_SIGNING_SECRET: "the-instance-secret-at-least-32-characters",
    }),
    logger: createLogger({ level: "silent", name: "test" }),
    queryGenerator: null,
  });

  try {
    const id = await insertMonitor(database, { userId: owner });
    const body = (await app.inject(`/api/monitors/${id}/notifications`)).json();

    expect(body.webhookMissing).toEqual(["WEBHOOK_SIGNING_SECRET"]);
    // And it does not claim the instance's is being used, because it is not.
    expect(body.signingSecret.usingInstanceSecret).toBe(false);

    // Making one of its own is what unblocks it.
    await app.inject({ method: "POST", url: "/api/notifications/signing-secret" });
    expect((await app.inject(`/api/monitors/${id}/notifications`)).json().webhookMissing).toEqual(
      [],
    );
  } finally {
    await app.close();
  }
});
