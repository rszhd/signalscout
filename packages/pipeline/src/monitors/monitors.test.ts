/**
 * Creating, pausing and resuming a monitor, against real Postgres.
 *
 * Two of US-010's acceptance lines are claims about rows, not about functions,
 * and neither can be checked without a database. A monitor survives a pause
 * with its history, which is a claim about what the pause did *not* write. And
 * a monitor with no credentials cannot be started, which is a claim about the
 * column the scheduler reads, not about a return value a caller may ignore.
 *
 * The credential fields here are Reddit's real ones, from the connector, so
 * the variable named in the failure is the variable a self-hoster must set.
 */

import { scrapeCreatorsReddit } from "@signalscout/engine";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { matches, monitors, posts, sourceContinuations } from "../db/schema.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { findDueMonitors } from "../worker/schedule.js";
import {
  type CreateMonitorInput,
  createMonitor,
  getMonitor,
  pauseMonitor,
  resumeMonitor,
  updateMonitor,
} from "./monitors.js";

const descriptors = [scrapeCreatorsReddit];

/** A deployment that has the ScrapeCreators key Reddit needs. */
const configured = { SCRAPECREATORS_API_KEY: "sc-test-key" };
/** A deployment that does not. */
const unconfigured = {};

const answers = {
  name: "Journeys",
  product: "A test runner that records browser flows instead of coding them",
  idealCustomer: "Small SaaS teams with no dedicated QA engineer",
  problem: "End-to-end tests break whenever the UI changes",
  signals: ["recommendation_request", "problem"],
} as const;

/** The one account this instance has. Every monitor below belongs to it. */
const owner = "self-hosted";

function input(overrides: Partial<CreateMonitorInput> = {}): CreateMonitorInput {
  return {
    ...answers,
    userId: owner,
    queries: { reddit: ["flaky end to end tests", "manual qa before every release"] },
    subreddits: ["SaaS", "webdev"],
    sources: ["reddit"],
    ...overrides,
  };
}

describe("a monitor made from four answers", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("monitors");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(monitors);
    await db.delete(posts);
  });

  it("stores the answers and the generated queries in separate columns", async () => {
    const { monitor } = await createMonitor(db, input(), {
      descriptors,
      environment: configured,
    });

    // The point of the split: regenerating queries must never make somebody
    // retype what they answered.
    expect(monitor.product).toBe(answers.product);
    expect(monitor.idealCustomer).toBe(answers.idealCustomer);
    expect(monitor.problem).toBe(answers.problem);
    expect(monitor.signals).toEqual(["recommendation_request", "problem"]);
    // Keyed by platform since US-027: a query is written for somewhere, and
    // the column holds one list per platform the monitor watches.
    expect(monitor.generatedQueries).toEqual({
      reddit: ["flaky end to end tests", "manual qa before every release"],
    });
    expect(monitor.generatedSubreddits).toEqual(["SaaS", "webdev"]);
  });

  it("replaces the queries without touching the answers", async () => {
    const { monitor } = await createMonitor(db, input(), {
      descriptors,
      environment: configured,
    });

    const updated = await updateMonitor(db, monitor.id, {
      queries: { reddit: ["regression testing takes too long"] },
      subreddits: [],
    });

    expect(updated?.generatedQueries).toEqual({ reddit: ["regression testing takes too long"] });
    expect(updated?.generatedSubreddits).toEqual([]);
    expect(updated?.product).toBe(answers.product);
  });

  it("starts running when its source has credentials", async () => {
    const { monitor, missing } = await createMonitor(db, input(), {
      descriptors,
      environment: configured,
    });

    expect(missing).toEqual([]);
    expect(monitor.pausedAt).toBeNull();
    expect((await findDueMonitors(db)).map((due) => due.id)).toEqual([monitor.id]);
  });
});

/**
 * The version, which is what a verdict in `feedback` is given against.
 *
 * The rule is narrow and worth stating twice: the version counts edits to the
 * definition the classifier judges by — the product, the ideal customer, the
 * problem and the signals — and nothing else. A version that moved on a rename
 * would throw away feedback nobody has invalidated, and one that stood still
 * through a rewritten problem statement would keep feedback that is now about
 * a different question.
 */
describe("a monitor's version", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  async function create() {
    const { monitor } = await createMonitor(db, input(), {
      descriptors,
      environment: configured,
    });
    return monitor;
  }

  beforeAll(async () => {
    database = await createTestDatabase("monitor-version");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(monitors);
  });

  it("starts at one", async () => {
    expect((await create()).version).toBe(1);
  });

  it("moves when the problem it watches for changes", async () => {
    const monitor = await create();

    const updated = await updateMonitor(db, monitor.id, {
      problem: "Nobody can tell which release broke the checkout flow",
    });

    expect(updated?.version).toBe(2);
  });

  it("moves when the signals change", async () => {
    const monitor = await create();

    const updated = await updateMonitor(db, monitor.id, { signals: ["problem"] });

    expect(updated?.version).toBe(2);
  });

  it("stands still on a rename, a new interval and an edited query", async () => {
    const monitor = await create();

    const updated = await updateMonitor(db, monitor.id, {
      name: "Journeys, renamed",
      pollIntervalSeconds: 7200,
      queries: { reddit: ["regression testing takes too long"] },
      minScore: 60,
    });

    // None of these change what a good lead is, so no verdict already given
    // is about a different question than it was.
    expect(updated?.version).toBe(1);
  });

  it("stands still when the form sends back what it was given", async () => {
    const monitor = await create();

    // The monitor form sends every field it holds, edited or not. A save with
    // no edit must not invalidate the feedback collected so far.
    const updated = await updateMonitor(db, monitor.id, {
      ...answers,
      signals: ["problem", "recommendation_request"],
    });

    expect(updated?.version).toBe(1);
  });
});

/**
 * A collection stopped part way keeps its place, and an edit can take away
 * the search that place belongs to. US-407: such a place would never be read
 * or abandoned, and the deletion check skips a monitor with one in flight.
 */
describe("an edit that takes a search away", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  async function create(creditsPerHour: number | null = null) {
    const { monitor } = await createMonitor(db, input(), {
      descriptors,
      environment: configured,
    });
    if (creditsPerHour !== null) {
      await db
        .update(monitors)
        .set({ pollCreditsPerHour: String(creditsPerHour) })
        .where(eq(monitors.id, monitor.id));
    }
    return monitor;
  }

  async function remember(monitorId: string, query: string, source: "reddit" | "x" = "reddit") {
    await db.insert(sourceContinuations).values({
      monitorId,
      source,
      query,
      provider: "scrapecreators",
      cursor: "page-2",
      resumeAfter: new Date(),
    });
  }

  async function placesOf(monitorId: string) {
    const rows = await db
      .select({ source: sourceContinuations.source, query: sourceContinuations.query })
      .from(sourceContinuations)
      .where(eq(sourceContinuations.monitorId, monitorId));
    return rows.map((row) => `${row.source}:${row.query}`).sort();
  }

  beforeAll(async () => {
    database = await createTestDatabase("monitor-edit-places");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(monitors);
  });

  it("keeps a platform's place when its searches change and they do not take turns", async () => {
    const monitor = await create();
    await remember(monitor.id, "");

    await updateMonitor(db, monitor.id, { queries: { reddit: ["regression testing is slow"] } });

    expect(await placesOf(monitor.id)).toEqual(["reddit:"]);
  });

  it("forgets a platform's place when the platform is taken away", async () => {
    const monitor = await create();
    await remember(monitor.id, "");

    await updateMonitor(db, monitor.id, { sources: ["x"], queries: { x: ["flaky ci tests"] } });

    expect(await placesOf(monitor.id)).toEqual([]);
  });

  it("forgets a removed search's place and keeps the rest when searches take turns", async () => {
    const monitor = await create(2);
    await remember(monitor.id, "flaky end to end tests");
    await remember(monitor.id, "manual qa before every release");
    await remember(monitor.id, "");

    await updateMonitor(db, monitor.id, {
      queries: { reddit: ["manual qa before every release", "regression testing is slow"] },
    });

    expect(await placesOf(monitor.id)).toEqual([
      "reddit:",
      "reddit:manual qa before every release",
    ]);
  });

  it("forgets the channels' place when the subreddits are all taken away", async () => {
    const monitor = await create(2);
    await remember(monitor.id, "");

    await updateMonitor(db, monitor.id, { subreddits: [] });

    expect(await placesOf(monitor.id)).toEqual([]);
  });

  it("leaves every place alone on an edit that changes no search", async () => {
    const monitor = await create(2);
    await remember(monitor.id, "flaky end to end tests");

    await updateMonitor(db, monitor.id, { name: "Journeys, renamed", minScore: 60 });

    expect(await placesOf(monitor.id)).toEqual(["reddit:flaky end to end tests"]);
  });
});

describe("a monitor whose source has no credentials", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("monitors_credentials");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(monitors);
  });

  it("is created, but not started, and says which credential is missing", async () => {
    const { monitor, missing } = await createMonitor(db, input(), {
      descriptors,
      environment: unconfigured,
    });

    // Created, because four answers a person typed are not thrown away over a
    // key they can paste in a minute.
    expect(monitor.id).toBeDefined();
    // Not started, and the column the scheduler reads is what says so.
    expect(monitor.pausedAt).not.toBeNull();
    expect(await findDueMonitors(db)).toEqual([]);

    expect(missing).toEqual([
      {
        sourceId: "reddit",
        sourceName: "Reddit",
        providerId: "scrapecreators",
        providerName: "ScrapeCreators",
        field: "apiKey",
        label: "ScrapeCreators API key",
        environmentVariable: "SCRAPECREATORS_API_KEY",
      },
    ]);
  });

  it("cannot be resumed while the credential is missing", async () => {
    const { monitor } = await createMonitor(db, input(), {
      descriptors,
      environment: unconfigured,
    });

    const result = await resumeMonitor(db, monitor.id, {
      descriptors,
      environment: unconfigured,
    });

    expect(result?.status).toBe("blocked");
    if (result?.status !== "blocked") return;
    expect(result.missing[0]?.environmentVariable).toBe("SCRAPECREATORS_API_KEY");

    // The answer a caller could ignore is not the guard. The row is.
    expect((await getMonitor(db, monitor.id))?.pausedAt).not.toBeNull();
    expect(await findDueMonitors(db)).toEqual([]);
  });

  it("resumes once the credential is set", async () => {
    const { monitor } = await createMonitor(db, input(), {
      descriptors,
      environment: unconfigured,
    });

    const result = await resumeMonitor(db, monitor.id, {
      descriptors,
      environment: configured,
    });

    expect(result?.status).toBe("resumed");
    expect((await getMonitor(db, monitor.id))?.pausedAt).toBeNull();
    expect((await findDueMonitors(db)).map((due) => due.id)).toEqual([monitor.id]);
  });

  it("names every missing credential, not the first one", async () => {
    // A source with two fields, so a user who set one of them is told about
    // the other rather than being sent back to check the one that is right.
    const twoFields = {
      ...scrapeCreatorsReddit,
      provider: {
        ...scrapeCreatorsReddit.provider,
        credentialFields: [
          { name: "apiKey", label: "API key", secret: true },
          { name: "apiSecret", label: "API secret", secret: true },
        ],
      },
    };

    const { missing } = await createMonitor(db, input(), {
      descriptors: [twoFields],
      environment: { SCRAPECREATORS_API_KEY: "set" },
    });

    expect(missing.map((credential) => credential.environmentVariable)).toEqual([
      "SCRAPECREATORS_API_SECRET",
    ]);
  });
});

describe("pausing a monitor", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("monitors_pause");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(monitors);
    await db.delete(posts);
  });

  it("stops the scheduler from polling it", async () => {
    const { monitor } = await createMonitor(db, input(), {
      descriptors,
      environment: configured,
    });

    await pauseMonitor(db, monitor.id);

    // A pause that only hid the monitor in the UI would keep collecting and
    // keep billing, which is the opposite of what the button means.
    expect(await findDueMonitors(db)).toEqual([]);
  });

  it("keeps the first timestamp when it is pressed twice", async () => {
    const { monitor } = await createMonitor(db, input(), {
      descriptors,
      environment: configured,
    });

    const first = await pauseMonitor(db, monitor.id);
    const second = await pauseMonitor(db, monitor.id);

    // "Paused 3 days ago" is what the monitor list shows. A second press must
    // not reset it to today.
    expect(second?.pausedAt).toEqual(first?.pausedAt);
  });

  it("loses no history across a pause and a resume", async () => {
    const { monitor } = await createMonitor(db, input(), {
      descriptors,
      environment: configured,
    });

    const [post] = await db
      .insert(posts)
      .values({
        source: "reddit",
        externalId: "t3_paused",
        url: "https://www.reddit.com/r/SaaS/comments/t3_paused",
        excerpt: "We manually test signup and checkout before every release.",
        postedAt: new Date("2026-09-01T10:00:00.000Z"),
      })
      .returning();

    if (!post) throw new Error("The post was not inserted.");

    await db.insert(matches).values({
      monitorId: monitor.id,
      postId: post.id,
      score: 92,
      relevance: 98,
      problemFit: 96,
      icpFit: 91,
      intent: 88,
      urgency: 82,
      intentType: "recommendation_request",
      reasons: ["Four-person SaaS team with no dedicated QA"],
    });

    await pauseMonitor(db, monitor.id);
    await resumeMonitor(db, monitor.id, { descriptors, environment: configured });

    const kept = await db.select().from(matches).where(eq(matches.monitorId, monitor.id));

    expect(kept).toHaveLength(1);
    expect(kept[0]?.score).toBe(92);
    // And the monitor still holds what it was made from.
    expect((await getMonitor(db, monitor.id))?.generatedQueries).toEqual({
      reddit: ["flaky end to end tests", "manual qa before every release"],
    });
  });
});
