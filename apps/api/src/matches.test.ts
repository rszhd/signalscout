/**
 * The inbox route, against real Postgres.
 *
 * `packages/core` owns the ordering rule and asserts it. What is asserted here
 * is the other half: that the screen's own request shape reaches it. A filter
 * the query string drops, a cursor the route re-encodes, or a clock it forgets
 * to carry are all failures the core tests cannot see, and each looks like an
 * inbox that quietly leaves matches out.
 */
import {
  createDatabase,
  createLogger,
  type Database,
  loadEnv,
  matches,
  monitors,
  posts,
} from "@intentwatch/core";
import { createTestDatabase, type TestDatabase } from "@intentwatch/core/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";

const logger = createLogger({ level: "silent", name: "test" });

interface Seed {
  readonly monitorId: string;
  readonly score: number;
  readonly minutesOld: number;
  readonly hidden?: boolean;
}

/** What one card carries, as the route serialises it. */
interface Card {
  id: string;
  monitorName: string;
  score: number;
  problemFit: number;
  icpFit: number;
  intent: number;
  reasons: string[];
  source: string;
  channel: string | null;
  url: string;
}

interface Page {
  matches: Card[];
  nextCursor: string | null;
  asOf: string;
}

/** The row an insert returned. Explicit, because an empty list is a bug here. */
function inserted<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (!row) throw new Error("The row was not inserted.");
  return row;
}

describe("the inbox route", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;
  let monitorId: string;
  let otherMonitorId: string;
  let sequence = 0;

  async function createMonitorRow(name: string): Promise<string> {
    const row = inserted(
      await db
        .insert(monitors)
        .values({
          userId: "self-hosted",
          name,
          product: "A test runner that records browser flows instead of coding them",
          idealCustomer: "Small SaaS teams with no dedicated QA engineer",
          problem: "End-to-end tests break whenever the UI changes",
          signals: ["problem"],
          sources: ["reddit"],
        })
        .returning({ id: monitors.id }),
    );

    return row.id;
  }

  async function seed(match: Seed): Promise<string> {
    sequence += 1;
    const post = inserted(
      await db
        .insert(posts)
        .values({
          source: "reddit",
          externalId: `t3_${sequence}`,
          url: `https://reddit.com/r/SaaS/comments/${sequence}`,
          author: "someone",
          channel: "SaaS",
          title: "How are small teams handling regression testing?",
          excerpt: "We're manually checking our major flows before every release.",
          postedAt: new Date(Date.now() - match.minutesOld * 60_000),
        })
        .returning({ id: posts.id }),
    );

    const row = inserted(
      await db
        .insert(matches)
        .values({
          monitorId: match.monitorId,
          postId: post.id,
          score: match.score,
          relevance: 90,
          problemFit: 98,
          icpFit: 91,
          intent: 94,
          urgency: 70,
          intentType: "problem",
          reasons: ["Small SaaS team", "Explicit manual-testing pain"],
          hidden: match.hidden ?? false,
        })
        .returning({ id: matches.id }),
    );

    return row.id;
  }

  async function server() {
    const env = loadEnv({ DATABASE_URL: database.url });
    return buildServer({ env, logger, db, queryGenerator: null });
  }

  /** The scores on a page, which is what most of these cases compare. */
  function scores(page: Page): number[] {
    return page.matches.map((match) => match.score);
  }

  async function get(url: string) {
    const app = await server();
    try {
      return await app.inject({ method: "GET", url });
    } finally {
      await app.close();
    }
  }

  beforeAll(async () => {
    database = await createTestDatabase("api_matches");
    ({ db, close } = createDatabase(database.url));
    monitorId = await createMonitorRow("Teams replacing manual QA");
    otherMonitorId = await createMonitorRow("Something else entirely");
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(matches);
    await db.delete(posts);
  });

  it("returns a card with its reasons, sub-scores and link", async () => {
    await seed({ monitorId, score: 94, minutesOld: 12 });

    const response = await get("/api/matches");

    expect(response.statusCode).toBe(200);
    const match = inserted((response.json() as Page).matches);
    expect(match.monitorName).toBe("Teams replacing manual QA");
    expect(match.score).toBe(94);
    expect(match.reasons).toEqual(["Small SaaS team", "Explicit manual-testing pain"]);
    expect([match.problemFit, match.icpFit, match.intent]).toEqual([98, 91, 94]);
    expect(match.source).toBe("reddit");
    expect(match.channel).toBe("SaaS");
    expect(match.url).toContain("reddit.com");
  });

  it("shows one monitor when the query string names one", async () => {
    await seed({ monitorId, score: 60, minutesOld: 5 });
    await seed({ monitorId: otherMonitorId, score: 95, minutesOld: 5 });

    const response = await get(`/api/matches?monitorId=${monitorId}`);

    expect(scores(response.json() as Page)).toEqual([60]);
  });

  it("drops everything under the minimum score the query string asks for", async () => {
    await seed({ monitorId, score: 40, minutesOld: 5 });
    await seed({ monitorId, score: 70, minutesOld: 5 });

    const response = await get("/api/matches?minScore=70");

    expect(scores(response.json() as Page)).toEqual([70]);
  });

  it("never shows a hidden match", async () => {
    // The route is the caller US-015's rule has to reach. Asserted here as
    // well as in core, because the two are separate call sites.
    await seed({ monitorId, score: 50, minutesOld: 5 });
    await seed({ monitorId, score: 99, minutesOld: 1, hidden: true });

    const response = await get("/api/matches");

    expect(scores(response.json() as Page)).toEqual([50]);
  });

  it("carries the cursor and the clock from one page to the next", async () => {
    await seed({ monitorId, score: 90, minutesOld: 5 });
    await seed({ monitorId, score: 80, minutesOld: 5 });

    const first = (await get("/api/matches?limit=1")).json() as Page;
    expect(first.nextCursor).not.toBeNull();

    const second = (
      await get(
        `/api/matches?limit=1&cursor=${encodeURIComponent(first.nextCursor ?? "")}&asOf=${encodeURIComponent(first.asOf)}`,
      )
    ).json() as Page;

    expect(scores(second)).toEqual([80]);
    expect(second.asOf).toBe(first.asOf);
    expect(second.nextCursor).toBeNull();
  });

  it("refuses a cursor nobody issued, rather than failing on the query", async () => {
    const response = await get("/api/matches?cursor=nonsense");

    expect(response.statusCode).toBe(400);
  });
});
