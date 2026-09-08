/**
 * Whose model the classify step asks for. US-068.
 *
 * One worker process serves every account on the instance, and each may pay
 * with its own key, so the step resolves a classifier from the *monitor's
 * owner* rather than closing over one client. These are the two claims that
 * makes: it asks for the right person, and a person with no usable model does
 * not have their posts consumed.
 *
 * `classify.test.ts` owns everything else about this step and injects a
 * classifier, which is why it could not have caught either of these.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Classifier } from "../ai/classify.js";
import { createDatabase, type Database } from "../db/client.js";
import { modelCalls, posts } from "../db/schema.js";
import { createLogger } from "../logger.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { createClassifyStep } from "./classify.js";
import { classifyQueue, notifyQueue } from "./queues.js";
import type { StepContext } from "./steps.js";
import { insertMonitor } from "./testing.js";

const silentLogger = createLogger({ level: "silent", name: "test" });

function stubBoss() {
  return { send: vi.fn(async (_queue: string, _payload: unknown) => "job-1") };
}

function contextFor(db: Database, boss: ReturnType<typeof stubBoss>): StepContext {
  return { db, boss: boss as unknown as StepContext["boss"], logger: silentLogger };
}

describe("which account's model a classification is paid for by", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("classify_owner");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  async function onePost(): Promise<string> {
    const [row] = await db
      .insert(posts)
      .values({
        source: "reddit",
        externalId: `t3_${Math.random().toString(36).slice(2)}`,
        url: "https://reddit.com/r/softwaretesting/comments/1",
        excerpt: "Our end-to-end suite fails at random.",
        postedAt: new Date(),
      })
      .returning({ id: posts.id });

    if (!row) throw new Error("The post was not inserted.");
    return row.id;
  }

  it("asks for the model belonging to the monitor's owner", async () => {
    const monitorId = await insertMonitor(database, { userId: "account-7" });
    const postId = await onePost();
    const boss = stubBoss();

    const classifierFor = vi.fn(async (_userId: string) => undefined as Classifier | undefined);
    const step = createClassifyStep({ classifierFor });

    await step({ monitorId, postIds: [postId] }, contextFor(db, boss));

    expect(classifierFor).toHaveBeenCalledWith("account-7");
  });

  /**
   * The failing-safe half.
   *
   * A monitor whose owner has no model must not have its posts consumed and
   * nothing written. They keep their place, the notify step is told there are
   * no matches, and the next poll asks again — which is exactly what an
   * instance with no key has always done.
   */
  it("writes nothing and swallows nothing when the owner has no model", async () => {
    const monitorId = await insertMonitor(database, { userId: "account-8" });
    const postId = await onePost();
    const boss = stubBoss();

    const step = createClassifyStep({ classifierFor: async () => undefined });

    await step({ monitorId, postIds: [postId] }, contextFor(db, boss));

    // No call was recorded, so nothing was billed and nothing pretends to be
    // an answer.
    expect(await db.select().from(modelCalls)).toEqual([]);

    // And the pipeline still moves: notify is told, rather than the job
    // throwing and being retried four times over a missing key.
    const sent = boss.send.mock.calls.map(([queue]) => queue);
    expect(sent).toContain(notifyQueue);
    expect(sent).not.toContain(classifyQueue);
  });
});
