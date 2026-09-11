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
} from "@signalscout/core";
import { createTestDatabase, type TestDatabase } from "@signalscout/core/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { asOwner } from "./testing.js";

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
  verdict: "good" | "not_relevant" | null;
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
    return buildServer({ session: asOwner, env, logger, db, queryGenerator: null });
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

  async function judge(matchId: string, verdict: "good" | "not_relevant") {
    const app = await server();
    try {
      return await app.inject({
        method: "PUT",
        url: `/api/matches/${matchId}/verdict`,
        payload: { verdict },
      });
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

  describe("the order the query string asks for", () => {
    it("puts the newest post first when it asks for the date", async () => {
      // 95 three days old ranks 59 and 31 two minutes old ranks 31, so the
      // default puts them the other way round.
      await seed({ monitorId, score: 95, minutesOld: 3 * 24 * 60 });
      await seed({ monitorId, score: 31, minutesOld: 2 });

      expect(scores((await get("/api/matches?order=newest")).json() as Page)).toEqual([31, 95]);
      expect(scores((await get("/api/matches")).json() as Page)).toEqual([95, 31]);
    });

    it("carries the order across a page boundary", async () => {
      await seed({ monitorId, score: 95, minutesOld: 3 * 24 * 60 });
      await seed({ monitorId, score: 31, minutesOld: 2 });

      const first = (await get("/api/matches?order=newest&limit=1")).json() as Page;
      const second = (
        await get(
          `/api/matches?order=newest&limit=1&cursor=${encodeURIComponent(first.nextCursor ?? "")}&asOf=${encodeURIComponent(first.asOf)}`,
        )
      ).json() as Page;

      expect(scores(first)).toEqual([31]);
      expect(scores(second)).toEqual([95]);
    });

    it("puts the highest score first when it asks for the score", async () => {
      // 95 thirty days old ranks below zero, so the rank puts it last and the
      // score puts it first. The third order, the date, agrees with the rank
      // here and is not what this asserts.
      await seed({ monitorId, score: 95, minutesOld: 30 * 24 * 60 });
      await seed({ monitorId, score: 60, minutesOld: 2 });

      expect(scores((await get("/api/matches?order=score")).json() as Page)).toEqual([95, 60]);
      expect(scores((await get("/api/matches")).json() as Page)).toEqual([60, 95]);
    });

    it("refuses an order it does not have", async () => {
      // Not a silent fall back to the default: a cursor issued in one order
      // and spent in another walks past rows nobody sees go missing.
      expect((await get("/api/matches?order=relevance")).statusCode).toBe(400);
    });
  });

  /**
   * US-125. The core owns what a count means; this is the other half — that
   * the screen's filters survive the query string. A filter dropped here is a
   * banner promising leads the list will not show when it is clicked.
   */
  describe("how many arrived", () => {
    /** An instant before everything a case seeds, so it counts all of it. */
    function aMinuteAgo(): string {
      return new Date(Date.now() - 60_000).toISOString();
    }

    async function count(query: string): Promise<number> {
      const response = await get(`/api/matches/count?${query}`);

      expect(response.statusCode).toBe(200);

      return (JSON.parse(response.body) as { count: number }).count;
    }

    it("answers with how many arrived after the instant", async () => {
      await seed({ monitorId, score: 94, minutesOld: 12 });
      await seed({ monitorId, score: 71, minutesOld: 30 });

      expect(await count(`since=${encodeURIComponent(aMinuteAgo())}`)).toBe(2);
    });

    it("answers zero when nothing arrived after it", async () => {
      await seed({ monitorId, score: 94, minutesOld: 12 });

      const later = new Date(Date.now() + 60_000).toISOString();

      expect(await count(`since=${encodeURIComponent(later)}`)).toBe(0);
    });

    it("carries the monitor filter from the query string", async () => {
      await seed({ monitorId, score: 94, minutesOld: 12 });
      await seed({ monitorId: otherMonitorId, score: 88, minutesOld: 12 });

      expect(await count(`since=${encodeURIComponent(aMinuteAgo())}&monitorId=${monitorId}`)).toBe(
        1,
      );
    });

    it("carries the score filter from the query string", async () => {
      await seed({ monitorId, score: 94, minutesOld: 12 });
      await seed({ monitorId, score: 40, minutesOld: 12 });

      expect(await count(`since=${encodeURIComponent(aMinuteAgo())}&minScore=70`)).toBe(1);
    });

    it("leaves out a match this person dismissed, and counts it when asked", async () => {
      const matchId = await seed({ monitorId, score: 94, minutesOld: 12 });

      expect((await judge(matchId, "not_relevant")).statusCode).toBe(200);

      const since = encodeURIComponent(aMinuteAgo());

      expect(await count(`since=${since}`)).toBe(0);
      expect(await count(`since=${since}&includeNotRelevant=true`)).toBe(1);
    });

    it("refuses a request that names no instant", async () => {
      // Without this the route would answer the most expensive question it
      // can — every match this account has ever had — to a caller that forgot
      // a parameter, and the number on the screen would be wrong as well.
      expect((await get("/api/matches/count")).statusCode).toBe(400);
    });

    it("refuses an instant that is not a date", async () => {
      expect((await get("/api/matches/count?since=yesterday")).statusCode).toBe(400);
    });
  });

  describe("the two buttons on a match", () => {
    it("stores a verdict and puts it on the card", async () => {
      const matchId = await seed({ monitorId, score: 94, minutesOld: 12 });

      const saved = await judge(matchId, "good");

      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({ matchId, verdict: "good", changed: false });
      expect(inserted((await get("/api/matches")).json<Page>().matches).verdict).toBe("good");
    });

    it("takes a not-relevant match out of the inbox, and gives it back on request", async () => {
      await seed({ monitorId, score: 50, minutesOld: 5 });
      const dismissed = await seed({ monitorId, score: 99, minutesOld: 1 });

      await judge(dismissed, "not_relevant");

      // The route is a second call site of the rule core asserts, and this is
      // the query string the screen actually sends.
      expect(scores((await get("/api/matches")).json<Page>())).toEqual([50]);
      expect(scores((await get("/api/matches?includeNotRelevant=true")).json<Page>())).toEqual([
        99, 50,
      ]);
    });

    it("says a verdict changed when it replaced a different one", async () => {
      const matchId = await seed({ monitorId, score: 94, minutesOld: 12 });

      await judge(matchId, "good");
      const changed = await judge(matchId, "not_relevant");

      expect(changed.json()).toMatchObject({ verdict: "not_relevant", changed: true });
    });

    it("answers 404 for a match that does not exist", async () => {
      const response = await judge("00000000-0000-4000-8000-000000000000", "good");

      expect(response.statusCode).toBe(404);
    });

    it("refuses a verdict that is not one of the two", async () => {
      const matchId = await seed({ monitorId, score: 94, minutesOld: 12 });
      const app = await server();

      try {
        const response = await app.inject({
          method: "PUT",
          url: `/api/matches/${matchId}/verdict`,
          payload: { verdict: "maybe" },
        });

        expect(response.statusCode).toBe(400);
      } finally {
        await app.close();
      }
    });
  });

  describe("the export", () => {
    it("hands back every verdict, history included, as a file", async () => {
      const matchId = await seed({ monitorId, score: 91, minutesOld: 12 });

      await judge(matchId, "good");
      await judge(matchId, "not_relevant");

      const response = await get("/api/feedback/export");
      const body = response.json<{
        exportedAt: string;
        verdicts: Array<{ verdict: string; supersededAt: string | null; externalId: string }>;
      }>();

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-disposition"]).toContain("signalscout-feedback.json");
      expect(body.verdicts).toHaveLength(2);
      expect(body.verdicts.filter((row) => row.supersededAt === null)).toHaveLength(1);
      expect(body.verdicts.every((row) => row.externalId.startsWith("t3_"))).toBe(true);
    });

    it("is an empty list, not an error, before anybody has judged anything", async () => {
      const response = await get("/api/feedback/export");

      expect(response.statusCode).toBe(200);
      expect(response.json<{ verdicts: unknown[] }>().verdicts).toEqual([]);
    });
  });

  /**
   * The inbox as a spreadsheet. US-064.
   *
   * The escaping is asserted in `packages/core/src/matches/csv.test.ts`. What
   * belongs here is the route's promise: the file is the list on screen, and
   * it is not one page of it.
   */
  describe("the inbox export", () => {
    it("is a CSV download named after the day", async () => {
      await seed({ monitorId, score: 91, minutesOld: 12 });

      const response = await get("/api/matches/export");

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/csv");
      expect(response.headers["content-disposition"]).toMatch(
        /attachment; filename="signalscout-inbox-\d{4}-\d{2}-\d{2}\.csv"/,
      );
    });

    it("honours the filters the screen applied", async () => {
      // A button that quietly exported everything would be worse than no
      // button, because the person would not check.
      await seed({ monitorId, score: 91, minutesOld: 12 });
      await seed({ monitorId: otherMonitorId, score: 88, minutesOld: 20 });

      const everything = await get("/api/matches/export");
      const oneMonitor = await get(`/api/matches/export?monitorId=${monitorId}`);

      expect(everything.body.trim().split("\r\n")).toHaveLength(3);
      expect(oneMonitor.body.trim().split("\r\n")).toHaveLength(2);
    });

    it("drops what a minimum score drops", async () => {
      await seed({ monitorId, score: 91, minutesOld: 12 });
      await seed({ monitorId, score: 55, minutesOld: 12 });

      const response = await get("/api/matches/export?minScore=70");

      expect(response.body.trim().split("\r\n")).toHaveLength(2);
    });

    it("exports past the first page, because a file has no pages", async () => {
      // The screen paginates because a screen should. Twelve rows with a
      // ten-row page proves the walk continues.
      for (let i = 0; i < 12; i += 1) {
        await seed({ monitorId, score: 90 - i, minutesOld: 10 + i });
      }

      const response = await get("/api/matches/export");

      expect(response.body.trim().split("\r\n")).toHaveLength(13);
    });

    it("is written in the order the screen was in", async () => {
      await seed({ monitorId, score: 95, minutesOld: 3 * 24 * 60 });
      await seed({ monitorId, score: 31, minutesOld: 2 });

      const ranked = await get("/api/matches/export");
      const dated = await get("/api/matches/export?order=newest");

      // The score is the first column. A file in a different order from the
      // screen it was exported from is a file somebody has to re-sort.
      const column = (body: string): string[] =>
        body
          .trim()
          .split("\r\n")
          .slice(1)
          .map((line) => line.split(",")[0]?.replace(/^\uFEFF/, "") ?? "");

      expect(column(ranked.body)).toEqual(["95", "31"]);
      expect(column(dated.body)).toEqual(["31", "95"]);
    });

    it("is a header and nothing else when nothing matches", async () => {
      const response = await get("/api/matches/export?minScore=100");

      expect(response.statusCode).toBe(200);
      expect(response.body.trim().split("\r\n")).toHaveLength(1);
    });
  });
});
