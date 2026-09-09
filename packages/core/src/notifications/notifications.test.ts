import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import {
  matches,
  monitors,
  notificationDeliveries,
  notificationSettings,
  posts,
} from "../db/schema.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { insertMonitor } from "../worker/testing.js";
import { type NotificationTransport, processNotifications } from "./deliver.js";
import { notificationDefaults, saveNotificationSettings } from "./settings.js";

let database: TestDatabase;
let db: Database;
let close: () => Promise<void>;
let monitorId: string;
let now: Date;
let sent: { channel: string; body: string }[];
let signed: string[];
let transport: NotificationTransport;
beforeAll(async () => {
  database = await createTestDatabase("notifications");
  ({ db, close } = createDatabase(database.url));
});
afterAll(async () => {
  await close?.();
  await database?.drop();
});
beforeEach(async () => {
  await db.delete(monitors);
  monitorId = await insertMonitor(database);
  now = new Date("2026-09-05T00:00:00Z");
  sent = [];
  signed = [];
  transport = {
    email: async (_to, _subject, body) => {
      sent.push({ channel: "email", body });
    },
    // The secret is recorded, because US-096's whole claim is about *which*
    // one signed each delivery.
    webhook: async (_url, body, _id, secret) => {
      sent.push({ channel: "webhook", body });
      if (secret) signed.push(secret);
    },
  };
});
async function configure(extra = {}) {
  await saveNotificationSettings(
    db,
    monitorId,
    {
      ...notificationDefaults,
      emailEnabled: true,
      emailTo: "owner@example.com",
      ...extra,
    },
    now,
  );
}
async function match(score: number, hidden = false, forMonitor = monitorId) {
  const [post] = await db
    .insert(posts)
    .values({
      source: "reddit",
      provider: "brightdata",
      externalId: randomUUID(),
      url: "https://reddit.com/r/testing/comments/example",
      author: "tester",
      excerpt: "Our test suite breaks every release",
      postedAt: now,
    })
    .returning();
  assert(post);
  const [row] = await db
    .insert(matches)
    .values({
      monitorId: forMonitor,
      postId: post.id,
      score,
      relevance: score,
      problemFit: score,
      icpFit: score,
      intent: score,
      urgency: score,
      intentType: "problem",
      reasons: ["A team describes broken tests"],
      hidden,
      createdAt: new Date(now.getTime() + 1),
    })
    .returning();
  assert(row);
  return row.id;
}
it("defaults to a daily digest; sends only visible matches at the floor, once", async () => {
  await configure();
  await match(49);
  await match(50);
  await match(90);
  await match(95, true);
  await processNotifications(db, monitorId, transport, now);
  expect(sent).toEqual([]);
  now = new Date(now.getTime() + 86_400_000);
  await processNotifications(db, monitorId, transport, now);
  expect(sent).toHaveLength(1);
  expect(sent[0]?.body).toContain("50");
  expect(sent[0]?.body).toContain("90");
  expect(sent[0]?.body).not.toContain("49");
  expect(sent[0]?.body).not.toContain("95");
  await processNotifications(db, monitorId, transport, now);
  expect(sent).toHaveLength(1);
});
it("sends nothing for an empty period or without configured SMTP", async () => {
  await configure();
  now = new Date(now.getTime() + 86_400_000);
  await processNotifications(db, monitorId, transport, now);
  expect(sent).toEqual([]);
  await match(80);
  now = new Date(now.getTime() + 86_400_000);
  await processNotifications(db, monitorId, { ...transport, email: null }, now);
  expect(sent).toEqual([]);
  await processNotifications(db, monitorId, transport, now);
  expect(sent).toHaveLength(1);
});
it("immediate alerts use their own threshold and concurrent workers do not duplicate them", async () => {
  await configure({ immediateScore: 90 });
  await match(89);
  await match(90);
  now = new Date(now.getTime() + 1000);
  await Promise.all([
    processNotifications(db, monitorId, transport, now),
    processNotifications(db, monitorId, transport, now),
  ]);
  expect(sent).toHaveLength(1);
  expect(sent[0]?.body).toContain("90");
});
it("retries webhooks with backoff, keeps email independent and disables after five failures", async () => {
  await configure({
    immediateScore: 90,
    webhookEnabled: true,
    webhookUrl: "https://receiver.example/hook",
    webhookMode: "match",
  });
  await match(95);
  let attempts = 0;
  transport.webhook = async () => {
    attempts++;
    throw new Error("secret provider response");
  };
  now = new Date(now.getTime() + 1000);
  await processNotifications(db, monitorId, transport, now);
  expect(sent).toHaveLength(1);
  expect(attempts).toBe(1);
  await processNotifications(db, monitorId, transport, now);
  expect(attempts).toBe(1);
  for (const seconds of [30, 60, 120, 240]) {
    now = new Date(now.getTime() + seconds * 1000);
    await processNotifications(db, monitorId, transport, now);
  }
  expect(attempts).toBe(5);
  const [settings] = await db
    .select()
    .from(notificationSettings)
    .where(eq(notificationSettings.monitorId, monitorId));
  expect(settings?.webhookEnabled).toBe(false);
  expect(settings?.webhookError).toContain("disabled");
  expect(JSON.stringify(settings)).not.toContain("secret provider response");
});
it("re-checks visibility before a retry and does not notify another monitor", async () => {
  await configure({
    webhookEnabled: true,
    webhookUrl: "https://receiver.example/hook",
    webhookMode: "match",
    emailEnabled: false,
  });
  const id = await match(80);
  transport.webhook = async () => {
    throw new Error("offline");
  };
  now = new Date(now.getTime() + 1000);
  await processNotifications(db, monitorId, transport, now);
  await db.update(matches).set({ hidden: true }).where(eq(matches.id, id));
  transport.webhook = async (_url, body) => {
    sent.push({ channel: "webhook", body });
  };
  now = new Date(now.getTime() + 30_000);
  await processNotifications(db, monitorId, transport, now);
  expect(sent).toEqual([]);
  const rows = await db.select().from(notificationDeliveries);
  expect(rows[0]?.status).toBe("skipped");
  await processNotifications(db, randomUUID(), transport, now);
  expect(sent).toEqual([]);
});
it("webhook digests group matches and settings changes cancel old pending deliveries", async () => {
  await configure({
    emailEnabled: false,
    webhookEnabled: true,
    webhookUrl: "https://receiver.example/hook",
  });
  await match(70);
  await match(80);
  now = new Date(now.getTime() + 86_400_000);
  transport.webhook = async () => {
    throw new Error("offline");
  };
  await processNotifications(db, monitorId, transport, now);
  await configure({
    emailEnabled: false,
    webhookEnabled: true,
    webhookUrl: "https://new.example/hook",
  });
  transport.webhook = async (_url, body) => {
    sent.push({ channel: "webhook", body });
  };
  now = new Date(now.getTime() + 86_400_000);
  await processNotifications(db, monitorId, transport, now);
  expect(sent).toEqual([]);
  await match(85);
  await match(75);
  now = new Date(now.getTime() + 86_400_000);
  await processNotifications(db, monitorId, transport, now);
  expect(sent).toHaveLength(1);
  expect(JSON.parse(sent[0]?.body ?? "null").matches).toHaveLength(2);
});

it("the scheduled worker catches a digest without a classify enqueue", async () => {
  now = new Date(Date.now() - 2 * 86_400_000);
  const { startWorker } = await import("../worker/runtime.js");
  const { scheduleTickQueue, notifyQueue } = await import("../worker/queues.js");
  const { fakeRegistry, silentLogger, until } = await import("../worker/testing.js");
  await configure({
    emailEnabled: false,
    webhookEnabled: true,
    webhookUrl: "https://receiver.example/hook",
  });
  await match(80);
  const worker = await startWorker({
    databaseUrl: database.url,
    logger: silentLogger,
    registry: fakeRegistry(),
    scheduleTicks: false,
    steps: { poll: async () => {} },
    notificationTransport: transport,
  });
  try {
    await worker.boss.send(scheduleTickQueue, {});
    await until("the scheduled digest", () => (sent.length === 1 ? true : undefined));
    expect(JSON.parse(sent[0]?.body ?? "null").type).toBe("matches.digest");
    now = new Date();
    await configure({
      emailEnabled: false,
      webhookEnabled: true,
      webhookUrl: "https://receiver.example/hook",
      webhookMode: "match",
    });
    await match(85);
    await worker.boss.send(notifyQueue, { monitorId, matchIds: [] });
    await until("the immediate notification", () => (sent.length === 2 ? true : undefined));
    expect(JSON.parse(sent[1]?.body ?? "null").type).toBe("match.created");
  } finally {
    await worker.stop();
  }
}, 30_000);

it("an unavailable SMTP transport does not speed up or block webhook digests", async () => {
  await configure({ webhookEnabled: true, webhookUrl: "https://receiver.example/hook" });
  await match(80);
  now = new Date(now.getTime() + 86_400_000);
  await processNotifications(db, monitorId, { ...transport, email: null }, now);
  expect(sent.map((row) => row.channel)).toEqual(["webhook"]);
  await match(90);
  now = new Date(now.getTime() + 60_000);
  await processNotifications(db, monitorId, { ...transport, email: null }, now);
  expect(sent).toHaveLength(1);
  await processNotifications(db, monitorId, transport, now);
  expect(sent.map((row) => row.channel)).toEqual(["webhook", "email"]);
  expect(sent[1]?.body).not.toContain("90");
});

it("signs a delivery with the monitor owner's secret, not with anybody else's", async () => {
  /**
   * US-096, and the case a mutation found missing. Signing every delivery with
   * one value was the state before this ticket, and it is exactly what lets one
   * customer forge a payload another's receiver accepts — so it is not enough
   * that *a* secret reaches the transport. It has to be the secret of the
   * account that owns this monitor.
   */
  const owner = `owner-${randomUUID()}`;
  const mine = await insertMonitor(database, { userId: owner });
  const asked: string[] = [];

  await saveNotificationSettings(
    db,
    mine,
    {
      ...notificationDefaults,
      emailEnabled: false,
      webhookEnabled: true,
      webhookUrl: "https://receiver.example/hook",
      webhookMode: "match",
      immediateScore: 70,
    },
    now,
  );

  await match(90, false, mine);

  await processNotifications(db, mine, transport, new Date(now.getTime() + 60_000), {
    signingSecretFor: async (userId) => {
      asked.push(userId);
      return `secret-for-${userId}`;
    },
  });

  expect(asked).toEqual([owner]);
  expect(signed).toEqual([`secret-for-${owner}`]);
});
