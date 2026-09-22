/**
 * The notify queue against real pg-boss, with no worker reading it, so a job
 * stays queued for as long as the test needs.
 *
 * A worker takes a job within a polling interval, and the drop this guards
 * against needs a job still queued when the next is sent. A test that runs a
 * worker only meets that on a slow machine. Without one it meets it every
 * time. BUG-021.
 */
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { poolOptions } from "../db/client.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { sendNotify } from "./notify.js";
import { deadLetterQueue, notifyQueue, queueDefinitions } from "./queues.js";

let database: TestDatabase;
let boss: PgBoss;

beforeAll(async () => {
  database = await createTestDatabase("worker_notify");
  boss = new PgBoss({ connectionString: database.url, ...poolOptions() });
  await boss.start();

  // The production settings, dead letter queue first: a queue cannot name one
  // that does not exist yet.
  for (const { name, ...options } of queueDefinitions()) {
    if (name === deadLetterQueue || name === notifyQueue) await boss.createQueue(name, options);
  }
}, 60_000);

afterAll(async () => {
  await boss?.stop({ graceful: false });
  await database?.drop();
});

describe("a notify job", () => {
  it("is queued for a second monitor while the first one's still waits", async () => {
    const first = await sendNotify(boss, { monitorId: "monitor-a", matchIds: [] });
    const second = await sendNotify(boss, { monitorId: "monitor-b", matchIds: [] });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
  });

  it("is sent once per monitor while one is waiting, because a pass delivers the whole outbox", async () => {
    const first = await sendNotify(boss, { monitorId: "monitor-c", matchIds: [] });
    const again = await sendNotify(boss, { monitorId: "monitor-c", matchIds: [] });

    expect(first).not.toBeNull();
    expect(again).toBeNull();
  });

  it("is dropped without an error when it is sent with no key, which is why none is", async () => {
    // pg-boss's own behaviour, kept so a change to it is seen here first.
    const first = await boss.send(notifyQueue, { monitorId: "monitor-d", matchIds: [] });
    const second = await boss.send(notifyQueue, { monitorId: "monitor-e", matchIds: [] });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });
});
