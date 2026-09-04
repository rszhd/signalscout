import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { defaultPollIntervalSeconds, monitors } from "../db/schema.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { startWorker, type WorkerHandle } from "./runtime.js";
import { enqueueDuePolls, findDueMonitors } from "./schedule.js";
import { fakeRegistry, fastRetries, insertMonitor, silentLogger, until } from "./testing.js";

const minutes = (count: number) => sql`now() - interval '${sql.raw(String(count))} minutes'`;

describe("which monitors are due", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("worker_due");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(monitors);
  });

  it("polls a monitor that has never been polled", async () => {
    const id = await insertMonitor(database);

    expect((await findDueMonitors(db)).map((monitor) => monitor.id)).toEqual([id]);
  });

  it("leaves a monitor alone until its own interval has passed", async () => {
    // Twenty minutes ago, on a fifteen-minute interval: due.
    const due = await insertMonitor(database, { pollIntervalSeconds: 900 });
    // The same twenty minutes ago, on a one-hour interval: not due.
    //
    // This pair is the whole point of the column. A scheduler that reads a
    // constant of fifteen minutes returns both, and a scheduler that reads a
    // constant of one hour returns neither. Only one that reads the row
    // returns exactly the first.
    const notDue = await insertMonitor(database, { pollIntervalSeconds: 3600 });

    await db.update(monitors).set({ lastPolledAt: minutes(20) });

    const ids = (await findDueMonitors(db)).map((monitor) => monitor.id);

    expect(ids).toEqual([due]);
    expect(ids).not.toContain(notDue);
  });

  it("does not poll a monitor that names no source", async () => {
    await insertMonitor(database, { sources: [] });

    expect(await findDueMonitors(db)).toEqual([]);
  });

  it("gives a new monitor the default interval, not one the worker chose", async () => {
    const id = await insertMonitor(database);
    const [monitor] = await db.select().from(monitors).where(eq(monitors.id, id));

    expect(monitor?.pollIntervalSeconds).toBe(defaultPollIntervalSeconds);
  });

  it("refuses an interval below the floor", async () => {
    // A typo of 1 instead of 100 is an invoice on a metered source, so the
    // floor is a database constraint and not form validation.
    const rejection = await insertMonitor(database, { pollIntervalSeconds: 5 }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(String((rejection as { cause?: unknown })?.cause)).toMatch(
      /monitors_poll_interval_floor/,
    );
  });
});

/**
 * Two workers tick at the same time on purpose. The poll queue's policy, keyed
 * on the monitor id, is what makes the second send a no-op — not a lock this
 * repository wrote.
 */
describe("two workers ticking at once", () => {
  let database: TestDatabase;
  let firstWorker: WorkerHandle;
  let secondWorker: WorkerHandle;
  const polled: string[] = [];

  beforeAll(async () => {
    database = await createTestDatabase("worker_singleton");

    const start = () =>
      startWorker({
        databaseUrl: database.url,
        logger: silentLogger,
        registry: fakeRegistry(),
        credentialsFor: () => ({ token: "test-token" }),
        retry: fastRetries,
        scheduleTicks: false,
        steps: {
          poll: async ({ monitorId }) => {
            polled.push(monitorId);
            // Long enough that the second worker's tick lands while this one
            // is still active, which is the collision being asserted.
            await new Promise((resolve) => setTimeout(resolve, 300));
          },
        },
      });

    firstWorker = await start();
    secondWorker = await start();
  }, 60_000);

  afterAll(async () => {
    await firstWorker?.stop();
    await secondWorker?.stop();
    await database?.drop();
  });

  it("polls each monitor once, and every monitor, however many workers tick", async () => {
    // Two monitors, not one. With a single monitor "one poll per monitor" and
    // "one poll at a time, anywhere" give the same answer, and the second is a
    // scheduler where one slow monitor holds up all the others.
    const first = await insertMonitor(database);
    const second = await insertMonitor(database, { name: "Second monitor" });

    const [a, b] = await Promise.all([
      enqueueDuePolls(firstWorker.db, firstWorker.boss, silentLogger),
      enqueueDuePolls(secondWorker.db, secondWorker.boss, silentLogger),
    ]);

    expect(a.due).toBe(2);
    expect(b.due).toBe(2);
    // Four sends, two monitors, two jobs. The two that were turned away are
    // the duplicates, and the key is what makes them duplicates of each other
    // rather than of the other monitor's poll.
    expect(a.alreadyQueued + b.alreadyQueued).toBe(2);

    await until("both monitors to be polled", () => (polled.length >= 2 ? true : undefined));

    // Give a duplicate every chance to appear.
    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect([...polled].sort()).toEqual([first, second].sort());
  }, 30_000);

  it("releases the key once the poll has finished, so the monitor polls again", async () => {
    // The guard has to let go. A singleton key that never released would poll
    // each monitor exactly once and then go quiet, which looks like a working
    // scheduler for the first hour.
    const before = polled.length;
    const { db, close } = createDatabase(database.url);

    try {
      // The stub step does not move the mark, so age it by hand. The real step
      // moves it, and `collect.test.ts` asserts that separately.
      await db.update(monitors).set({ lastPolledAt: minutes(90) });

      const tick = await enqueueDuePolls(db, firstWorker.boss, silentLogger);

      expect(tick.due).toBe(2);
      expect(tick.alreadyQueued).toBe(0);
    } finally {
      await close();
    }

    await until("both monitors to be polled again", () =>
      polled.length >= before + 2 ? true : undefined,
    );
  }, 30_000);
});
