import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { defaultPollIntervalSeconds, monitors } from "../db/schema.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { admitEveryone, type EntitlementGate } from "./entitlement.js";
import { pollQueue } from "./queues.js";
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

  it("does not poll a paused monitor, however long it has waited", async () => {
    // Overdue on every other test in this file, and still not due. Pausing is
    // enforced here because it is a promise about money: a pause that only hid
    // the monitor in the UI would keep collecting and keep billing. US-010.
    const paused = await insertMonitor(database, { pausedAt: new Date() });
    const running = await insertMonitor(database);

    await db.update(monitors).set({ lastPolledAt: minutes(120) });

    const ids = (await findDueMonitors(db)).map((monitor) => monitor.id);

    expect(ids).toEqual([running]);
    expect(ids).not.toContain(paused);
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
/**
 * Which days a monitor polls on. US-041.
 *
 * A filter on the interval rather than a replacement for it, so a person can
 * say "hourly, on weekdays" without this product growing a cron parser. The
 * reason it exists is money: a B2B monitor polled on Saturday buys the weekend
 * at full price and finds the weekend's conversation.
 */
describe("the days a monitor polls on", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("worker_due_days");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(monitors);
  });

  /** What day it is in Postgres's own clock, which is what the query reads. */
  async function todayInUtc(): Promise<number> {
    const [row] = (await db.execute(sql.raw("select extract(dow from now()) as dow"))).rows as {
      dow: string;
    }[];

    return Number(row?.dow);
  }

  it("polls every day unless somebody says otherwise", async () => {
    const id = await insertMonitor(database);

    // The default is all seven, so a monitor made before this column existed
    // behaves exactly as it did.
    expect((await findDueMonitors(db)).map((monitor) => monitor.id)).toEqual([id]);
  });

  it("does not poll on a day it was not asked to", async () => {
    const today = await todayInUtc();
    const id = await insertMonitor(database);

    // Every day except this one.
    await db
      .update(monitors)
      .set({ pollDays: [0, 1, 2, 3, 4, 5, 6].filter((day) => day !== today) })
      .where(eq(monitors.id, id));

    expect(await findDueMonitors(db)).toEqual([]);
  });

  it("polls on a day it was asked to, even if that is the only one", async () => {
    const today = await todayInUtc();
    const id = await insertMonitor(database);

    await db
      .update(monitors)
      .set({ pollDays: [today] })
      .where(eq(monitors.id, id));

    expect((await findDueMonitors(db)).map((monitor) => monitor.id)).toEqual([id]);
  });

  /**
   * The reason the timezone column exists. A person who chose weekdays meant
   * their weekdays, and in UTC a Monday in Kuala Lumpur starts at 8am on
   * Sunday.
   */
  it("counts the day in the monitor's own timezone", async () => {
    const id = await insertMonitor(database);

    // Kiritimati is UTC+14 and Niue is UTC-11: 25 hours apart, so they are
    // never on the same weekday at the same instant. Whichever day the monitor
    // is set to, exactly one of the two zones agrees.
    const [row] = (
      await db.execute(
        sql.raw(
          "select extract(dow from (now() AT TIME ZONE 'Pacific/Kiritimati')) as ahead," +
            " extract(dow from (now() AT TIME ZONE 'Pacific/Niue')) as behind",
        ),
      )
    ).rows as { ahead: string; behind: string }[];

    const ahead = Number(row?.ahead);
    const behind = Number(row?.behind);

    expect(ahead).not.toBe(behind);

    await db
      .update(monitors)
      .set({ pollDays: [ahead], pollTimezone: "Pacific/Kiritimati" })
      .where(eq(monitors.id, id));

    expect((await findDueMonitors(db)).map((monitor) => monitor.id)).toEqual([id]);

    // The same day, read in a zone where it is not that day yet.
    await db.update(monitors).set({ pollTimezone: "Pacific/Niue" }).where(eq(monitors.id, id));

    expect(await findDueMonitors(db)).toEqual([]);
  });

  /**
   * A missed window is not owed.
   *
   * The query asks whether now is inside the schedule, never how many windows
   * have passed, so a monitor whose worker was down over a weekend polls once
   * when it returns rather than three times to catch up.
   */
  it("does not owe a poll for a day it missed", async () => {
    const today = await todayInUtc();
    const id = await insertMonitor(database, { pollIntervalSeconds: 3600 });

    await db
      .update(monitors)
      .set({ pollDays: [today], lastPolledAt: new Date(Date.now() - 30 * 86_400_000) })
      .where(eq(monitors.id, id));

    // Thirty days of missed hourly polls behind it, and it is due exactly once.
    expect((await findDueMonitors(db)).map((monitor) => monitor.id)).toEqual([id]);
  });

  it("refuses a monitor that can never poll", async () => {
    const id = await insertMonitor(database);

    // An empty day list reads as broken rather than as off. A person who wants
    // a monitor to stop presses pause, and pause says so on the screen.
    await expect(
      db.update(monitors).set({ pollDays: [] }).where(eq(monitors.id, id)),
    ).rejects.toThrow();
  });
});

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

/**
 * Who may poll. US-072, and US-153 made it an argument.
 *
 * This is the half of the billing gate that costs money. A route that refuses
 * to write is what a person sees; an account that keeps polling after its trial
 * ran out is invisible from every screen and shows up on an invoice. The
 * pipeline does not know who has paid — that is the application's table — so
 * the scheduler is handed a gate and these cases are its contract: an owner the
 * gate refuses is never asked to poll, and a gate that fails enqueues nothing.
 */
describe("which owners the gate admits", () => {
  let database: TestDatabase;
  let worker: WorkerHandle;

  beforeAll(async () => {
    database = await createTestDatabase("worker_due_gate");
    worker = await startWorker({
      databaseUrl: database.url,
      logger: silentLogger,
      registry: fakeRegistry(),
      credentialsFor: () => ({ token: "test-token" }),
      retry: fastRetries,
      scheduleTicks: false,
      // No step: the jobs stay in the queue, which is where the test reads them.
      steps: { poll: () => new Promise(() => {}) },
    });
  }, 60_000);

  afterAll(async () => {
    await worker?.stop();
    await database?.drop();
  });

  afterEach(async () => {
    await worker.db.delete(monitors);
    // Every job the last case left behind, whatever state it reached.
    await worker.boss.deleteAllJobs(pollQueue);
  });

  async function queuedMonitorIds(): Promise<string[]> {
    const jobs = await worker.boss.findJobs<{ monitorId: string }>(pollQueue);
    return jobs.map((job) => job.data.monitorId).sort();
  }

  it("polls every due monitor when the gate admits everyone", async () => {
    const first = await insertMonitor(database, { userId: "paid" });
    const second = await insertMonitor(database, { userId: "also-paid", name: "Second" });

    const tick = await enqueueDuePolls(worker.db, worker.boss, silentLogger, admitEveryone);

    expect(tick).toEqual({ due: 2, refused: 0, alreadyQueued: 0 });
    expect(await queuedMonitorIds()).toEqual([first, second].sort());
  });

  it("never asks the queue to poll for an owner the gate refuses", async () => {
    const polling = await insertMonitor(database, { userId: "paid" });
    await insertMonitor(database, { userId: "lapsed", name: "Lapsed" });
    const asked: ReadonlySet<string>[] = [];

    const refuseLapsed: EntitlementGate = async (owners) => {
      asked.push(owners);
      return new Set([...owners].filter((owner) => owner !== "lapsed"));
    };

    const tick = await enqueueDuePolls(worker.db, worker.boss, silentLogger, refuseLapsed);

    expect(tick).toEqual({ due: 2, refused: 1, alreadyQueued: 0 });
    expect(await queuedMonitorIds()).toEqual([polling]);
    // Once per tick, with every due owner, so a gate that reads a table reads
    // it once and not once per monitor.
    expect(asked).toEqual([new Set(["paid", "lapsed"])]);
  });

  it("enqueues nothing when the gate throws", async () => {
    await insertMonitor(database, { userId: "paid" });
    const broken: EntitlementGate = async () => {
      throw new Error("subscriptions table unreachable");
    };

    await expect(enqueueDuePolls(worker.db, worker.boss, silentLogger, broken)).rejects.toThrow(
      "subscriptions table unreachable",
    );

    // Not "poll everybody while the gate is down": that is the failure mode
    // this whole file exists to prevent, one outage at a time.
    expect(await queuedMonitorIds()).toEqual([]);
  });

  it("is asked nothing when no monitor is due", async () => {
    const asked: ReadonlySet<string>[] = [];
    const counting: EntitlementGate = async (owners) => {
      asked.push(owners);
      return owners;
    };

    const tick = await enqueueDuePolls(worker.db, worker.boss, silentLogger, counting);

    expect(tick).toEqual({ due: 0, refused: 0, alreadyQueued: 0 });
    expect(asked).toEqual([]);
  });
});
