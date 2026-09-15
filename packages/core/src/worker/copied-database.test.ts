/**
 * Correctness-critical: a copied database whose monitors still run spends real
 * money on a real provider and a real model, in a worktree nobody is watching.
 *
 * `scripts/new-worktree.mjs` seeds a new git worktree with a `pg_dump` of the
 * main database, so an agent asked to change the inbox has an inbox. The copy
 * carries the schedules and the keys with it. The one step that makes it safe
 * is `scripts/pause-every-monitor.sql`, and the cost of skipping it is not a
 * failed test but a bill — so the statement is asserted here, against real
 * Postgres and against the query the scheduler actually runs. US-135.
 *
 * The file is read rather than copied. A statement written twice drifts, and
 * this one would drift silently.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { monitors } from "../db/schema.js";
import { type CreateMonitorInput, createMonitor, pauseMonitor } from "../monitors/index.js";
import { brightDataReddit } from "../sources/providers/brightdata/reddit.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { findDueMonitors } from "./schedule.js";

/** The statement the script pipes into the copy. Read, never restated. */
const pauseEveryMonitor = readFileSync(
  fileURLToPath(new URL("../../../../scripts/pause-every-monitor.sql", import.meta.url)),
  "utf8",
);

const descriptors = [brightDataReddit];
/** A deployment that has the key Reddit needs, so a new monitor starts running. */
const environment = { BRIGHTDATA_API_KEY: "bd-test-key" };

function input(overrides: Partial<CreateMonitorInput> = {}): CreateMonitorInput {
  return {
    name: "Journeys",
    product: "A test runner that records browser flows instead of coding them",
    idealCustomer: "Small SaaS teams with no dedicated QA engineer",
    problem: "End-to-end tests break whenever the UI changes",
    signals: ["recommendation_request", "problem"],
    userId: "self-hosted",
    queries: { reddit: ["flaky end to end tests"] },
    subreddits: ["SaaS"],
    sources: ["reddit"],
    ...overrides,
  };
}

describe("a database copied into a new worktree", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("copied_database");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(monitors);
  });

  it("has no monitor due once it is paused, so a worker started in it polls nothing", async () => {
    const first = await createMonitor(db, input(), { descriptors, environment });
    const second = await createMonitor(db, input({ name: "Second" }), { descriptors, environment });

    // Both are running before the statement, or the assertion after it proves
    // nothing about what the statement did.
    expect((await findDueMonitors(db)).map((due) => due.id).sort()).toEqual(
      [first.monitor.id, second.monitor.id].sort(),
    );

    await db.execute(sql.raw(pauseEveryMonitor));

    expect(await findDueMonitors(db)).toEqual([]);
  });

  /**
   * A worktree is seeded more than once in its life. A monitor paused on Monday
   * must still read as paused on Monday after Friday's copy, because the column
   * is what a screen says "paused 3 days ago" from.
   */
  it("does not move the timestamp of a monitor that was already paused", async () => {
    const { monitor } = await createMonitor(db, input({ name: "Third" }), {
      descriptors,
      environment,
    });
    await pauseMonitor(db, monitor.id);

    const [before] = await db.select().from(monitors).where(eq(monitors.id, monitor.id));
    await db.execute(sql.raw(pauseEveryMonitor));
    const [after] = await db.select().from(monitors).where(eq(monitors.id, monitor.id));

    expect(after?.pausedAt).toEqual(before?.pausedAt);
  });
});
