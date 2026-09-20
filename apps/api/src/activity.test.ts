/**
 * The stage read, against a real `pg-boss`. US-265.
 *
 * The queue's table is not ours and this is the file that proves we read it
 * right, so nothing here writes a job row by hand. A hand-written row would be
 * a fixture of somebody else's schema, and it would still pass on the day
 * `pg-boss` changes the shape underneath us — which is the one failure this
 * test exists to catch. The library creates its own schema, its own partitions
 * and its own rows, exactly as the worker makes it do in production.
 */
import {
  createDatabase,
  createLogger,
  type Database,
  monitors,
  pipelineQueues,
  queueDefinitions,
} from "@signalscout/pipeline";
import { PgBoss } from "pg-boss";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { monitorStages } from "./activity.js";
import { loadEnv } from "./config/env.js";
import { buildServer } from "./server.js";
import { asOwner, createTestDatabase, type TestDatabase, testOwner } from "./testing.js";

const monitorId = "11111111-1111-4111-8111-111111111111";
const otherMonitorId = "22222222-2222-4222-8222-222222222222";

describe("what the worker is doing for a monitor", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;
  let boss: PgBoss;

  beforeAll(async () => {
    database = await createTestDatabase("api_activity");
    ({ db, close } = createDatabase(database.url));

    // The real library, against the real database. `start` runs pg-boss's own
    // migrations into the `pgboss` schema, which is how the worker creates it.
    boss = new PgBoss({ connectionString: database.url, schema: "pgboss" });
    await boss.start();

    // The queues production creates, from the definitions the package exports
    // rather than from names written here.
    for (const definition of queueDefinitions())
      await boss.createQueue(definition.name, definition);
  }, 120_000);

  afterAll(async () => {
    await boss?.stop({ graceful: false });
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    for (const queue of pipelineQueues) await boss.deleteAllJobs(queue);
  });

  /** Take the job off the queue, which is what makes a row `active`. */
  async function work(queue: string): Promise<void> {
    await boss.fetch(queue);
  }

  it("says nothing when no job is in flight", async () => {
    expect(await monitorStages(db, [monitorId])).toEqual(new Map());
  });

  it("names the queue a job is waiting in, and what it holds", async () => {
    await boss.send("classify", { monitorId, postIds: ["a", "b", "c"] });

    const stage = (await monitorStages(db, [monitorId])).get(monitorId);

    expect(stage?.queue).toBe("classify");
    expect(stage?.state).toBe("queued");
    expect(stage?.items).toBe(3);
    expect(Number.isNaN(Date.parse(stage?.since ?? ""))).toBe(false);
  });

  it("says a job a worker has taken is running", async () => {
    await boss.send("filter", { monitorId, postIds: ["a"] });
    await work("filter");

    expect((await monitorStages(db, [monitorId])).get(monitorId)?.state).toBe("active");
  });

  it("reports the running stage when another is queued behind it", async () => {
    await boss.send("classify", { monitorId, postIds: ["a", "b"] });
    await work("classify");
    await boss.send("poll", { monitorId });

    const stage = (await monitorStages(db, [monitorId])).get(monitorId);

    expect(stage?.queue).toBe("classify");
    expect(stage?.state).toBe("active");
  });

  it("carries no count for a poll, which holds no posts", async () => {
    await boss.send("poll", { monitorId });

    expect((await monitorStages(db, [monitorId])).get(monitorId)?.items).toBeNull();
  });

  it("counts the matches a notification job holds", async () => {
    await boss.send("notify", { monitorId, matchIds: ["m1", "m2"] });

    const stage = (await monitorStages(db, [monitorId])).get(monitorId);

    expect(stage?.queue).toBe("notify");
    expect(stage?.items).toBe(2);
  });

  it("keeps one monitor's work off another's row", async () => {
    await boss.send("classify", { monitorId, postIds: ["a"] });
    await boss.send("filter", { monitorId: otherMonitorId, postIds: ["b", "c"] });

    const stages = await monitorStages(db, [monitorId, otherMonitorId]);

    expect(stages.get(monitorId)?.queue).toBe("classify");
    expect(stages.get(otherMonitorId)?.queue).toBe("filter");
  });

  /**
   * The scope. The read is keyed on the ids it is handed, so a job for a
   * monitor that was not asked for is not in the answer — which is what keeps
   * another account's work off this account's screen, because the ids come
   * out of a scoped select.
   */
  it("says nothing about a monitor it was not asked about", async () => {
    await boss.send("classify", { monitorId: otherMonitorId, postIds: ["a"] });

    expect(await monitorStages(db, [monitorId])).toEqual(new Map());
  });

  it("asks nothing when it is given no monitor", async () => {
    await boss.send("classify", { monitorId, postIds: ["a"] });

    expect(await monitorStages(db, [])).toEqual(new Map());
  });

  /**
   * A finished job is history, and a completed row lives for days. Reading one
   * as a stage would leave the inbox saying "Scoring 3 posts" all week.
   */
  it("forgets a job that has finished", async () => {
    const id = await boss.send("classify", { monitorId, postIds: ["a"] });
    const [job] = (await boss.fetch("classify")) ?? [];
    await boss.complete("classify", job?.id ?? String(id));

    expect(await monitorStages(db, [monitorId])).toEqual(new Map());
  });

  /**
   * The routes, so the scope is proved where it is decided. The read above
   * takes ids; this is the proof that the ids it is handed are the account's
   * own and nobody else's — a stranger's job never reaches the owner's list,
   * whatever queue it sits in.
   */
  describe("on the monitor routes", () => {
    async function monitorRow(userId: string, name: string): Promise<string> {
      const [row] = await db
        .insert(monitors)
        .values({
          userId,
          name,
          product: "A test runner that records browser flows",
          idealCustomer: "Small SaaS teams with no dedicated QA engineer",
          problem: "End-to-end tests break whenever the UI changes",
          signals: ["problem"],
          sources: ["reddit"],
        })
        .returning({ id: monitors.id });
      if (!row) throw new Error("The monitor was not inserted.");
      return row.id;
    }

    it("carries the stage on the list and on one monitor, and only the account's own", async () => {
      const mine = await monitorRow(testOwner, "Mine");
      const theirs = await monitorRow("a-stranger", "Theirs");
      await boss.send("classify", { monitorId: mine, postIds: ["a", "b"] });
      await boss.send("filter", { monitorId: theirs, postIds: ["c"] });

      const app = await buildServer({
        session: asOwner,
        env: loadEnv({ DATABASE_URL: database.url }),
        logger: createLogger({ level: "silent", name: "test" }),
        db,
        queryGenerator: null,
      });
      try {
        const list = (await app.inject({ method: "GET", url: "/api/monitors" })).json() as {
          id: string;
          stage: { queue: string; items: number } | null;
        }[];
        expect(list.map((row) => row.id)).toEqual([mine]);
        expect(list[0]?.stage).toMatchObject({ queue: "classify", state: "queued", items: 2 });

        const one = (await app.inject({ method: "GET", url: `/api/monitors/${mine}` })).json();
        expect(one.stage).toMatchObject({ queue: "classify", items: 2 });

        // The stranger's monitor is not this account's to read, whatever it is doing.
        expect(
          (await app.inject({ method: "GET", url: `/api/monitors/${theirs}` })).statusCode,
        ).toBe(404);
      } finally {
        await app.close();
        await db.delete(monitors);
      }
    });
  });
});

/**
 * An API that boots before the worker talks to a database with no `pgboss`
 * schema in it. The monitors list must still answer.
 */
describe("a database the worker has never started against", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("api_activity_noqueue");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  it("answers with no stage rather than failing", async () => {
    expect(await monitorStages(db, [monitorId])).toEqual(new Map());
  });
});
