/**
 * The inbox list, against real Postgres.
 *
 * These assertions were written before `matches.ts`. Three of them are about
 * behaviour no unit test of a pure function could reach: the ordering rule is
 * an expression Postgres evaluates, the keyset boundary is a comparison
 * Postgres makes, and the hidden filter is the inbox's half of US-015.
 *
 * The worked example in the first case is the one from US-011's Context. It is
 * the reason the decay constant is 12 and not some other number, so it is
 * asserted rather than described.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { type IntentType, matches, monitors, posts } from "../db/schema.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import {
  cursorFor,
  type InboxMatch,
  listMatches,
  type MatchPage,
  rankDecayPointsPerDay,
  UnusableCursorError,
} from "./matches.js";

/** The row an insert returned. Explicit, because an empty list is a bug here. */
function inserted<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (!row) throw new Error("The row was not inserted.");
  return row;
}

/** The match at a position, named in the failure rather than "undefined". */
function at(page: MatchPage, index: number): InboxMatch {
  const match = page.matches[index];
  if (!match) throw new Error(`The page holds ${page.matches.length} matches, not ${index + 1}.`);
  return match;
}

const now = new Date("2026-09-05T12:00:00.000Z");

function minutesAgo(minutes: number): Date {
  return new Date(now.getTime() - minutes * 60_000);
}

function daysAgo(days: number): Date {
  return minutesAgo(days * 24 * 60);
}

interface Seed {
  readonly monitorId: string;
  readonly score: number;
  readonly postedAt: Date;
  readonly hidden?: boolean;
  readonly reasons?: readonly string[];
  readonly channel?: string;
  readonly intentType?: IntentType;
}

describe("the inbox list", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;
  let monitorId: string;
  let otherMonitorId: string;
  let postSequence = 0;

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

  /** One match, with the post it is about. Returns the match id. */
  async function seed(match: Seed): Promise<string> {
    postSequence += 1;
    const post = inserted(
      await db
        .insert(posts)
        .values({
          source: "reddit",
          externalId: `t3_${postSequence}`,
          url: `https://reddit.com/r/SaaS/comments/${postSequence}`,
          author: "someone",
          channel: match.channel ?? "SaaS",
          title: "How are small teams handling regression testing?",
          excerpt: "We're manually checking our major flows before every release.",
          postedAt: match.postedAt,
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
          intentType: match.intentType ?? "problem",
          reasons: [...(match.reasons ?? ["Small SaaS team", "Explicit manual-testing pain"])],
          hidden: match.hidden ?? false,
        })
        .returning({ id: matches.id }),
    );

    return row.id;
  }

  beforeAll(async () => {
    database = await createTestDatabase("matches");
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

  describe("ordering", () => {
    it("puts a fresh 88 above a three-day-old 96", async () => {
      const stale = await seed({ monitorId, score: 96, postedAt: daysAgo(3) });
      const fresh = await seed({ monitorId, score: 88, postedAt: minutesAgo(10) });

      const page = await listMatches(db, { asOf: now });

      expect(page.matches.map((match) => match.id)).toEqual([fresh, stale]);
    });

    it("charges twelve points for a day of age", async () => {
      await seed({ monitorId, score: 90, postedAt: minutesAgo(0) });
      await seed({ monitorId, score: 90, postedAt: daysAgo(1) });
      await seed({ monitorId, score: 90, postedAt: daysAgo(3) });

      const page = await listMatches(db, { asOf: now });

      // Written as numbers and not as `90 - rankDecayPointsPerDay`. An
      // expectation computed from the constant passes whatever the constant
      // becomes, which is the one thing this case exists to catch: the decay
      // is a product decision, and changing it changes which match a person
      // reads first.
      expect(page.matches.map((match) => match.rank)).toEqual([90, 78, 54]);
      expect(rankDecayPointsPerDay).toBe(12);
    });

    it("does not lift a post dated in the future above its own score", async () => {
      // A source with a clock ahead of ours. Without the clamp this outranks
      // every honest match in the inbox for as long as the difference lasts.
      await seed({ monitorId, score: 40, postedAt: new Date(now.getTime() + 86_400_000) });
      await seed({ monitorId, score: 50, postedAt: now });

      const page = await listMatches(db, { asOf: now });

      expect(page.matches.map((match) => match.score)).toEqual([50, 40]);
      expect(at(page, 1).rank).toBe(40);
    });

    it("ranks every page against the clock the first page used", async () => {
      await seed({ monitorId, score: 90, postedAt: daysAgo(1) });
      await seed({ monitorId, score: 80, postedAt: daysAgo(2) });

      const first = await listMatches(db, { asOf: now, limit: 1 });
      const second = await listMatches(db, {
        asOf: first.asOf,
        limit: 1,
        cursor: first.nextCursor,
      });

      expect(first.asOf).toEqual(now);
      expect(at(second, 0).rank).toBe(56);
    });
  });

  describe("what it refuses to show", () => {
    it("never returns a hidden match", async () => {
      // US-015 sets this column when the author removed the post. The inbox is
      // the caller that has to honour it; a screen that still shows the
      // excerpt is the failure that ticket exists to prevent.
      const visible = await seed({ monitorId, score: 50, postedAt: minutesAgo(5) });
      await seed({ monitorId, score: 99, postedAt: minutesAgo(1), hidden: true });

      const page = await listMatches(db, { asOf: now });

      expect(page.matches.map((match) => match.id)).toEqual([visible]);
    });

    it("counts a hidden match as absent when deciding there is another page", async () => {
      await seed({ monitorId, score: 50, postedAt: minutesAgo(5) });
      await seed({ monitorId, score: 99, postedAt: minutesAgo(1), hidden: true });

      const page = await listMatches(db, { asOf: now, limit: 1 });

      expect(page.nextCursor).toBeNull();
    });
  });

  describe("filtering", () => {
    it("shows one monitor when asked for one", async () => {
      const mine = await seed({ monitorId, score: 60, postedAt: minutesAgo(5) });
      await seed({ monitorId: otherMonitorId, score: 95, postedAt: minutesAgo(5) });

      const page = await listMatches(db, { asOf: now, monitorId });

      expect(page.matches.map((match) => match.id)).toEqual([mine]);
    });

    it("shows every monitor when asked for none, and names each one", async () => {
      await seed({ monitorId, score: 60, postedAt: minutesAgo(5) });
      await seed({ monitorId: otherMonitorId, score: 95, postedAt: minutesAgo(5) });

      const page = await listMatches(db, { asOf: now });

      expect(page.matches.map((match) => match.monitorName)).toEqual([
        "Something else entirely",
        "Teams replacing manual QA",
      ]);
    });

    it("drops everything below the minimum score", async () => {
      await seed({ monitorId, score: 40, postedAt: minutesAgo(5) });
      const kept = await seed({ monitorId, score: 70, postedAt: minutesAgo(5) });

      const page = await listMatches(db, { asOf: now, minScore: 70 });

      expect(page.matches.map((match) => match.id)).toEqual([kept]);
    });

    it("filters on the score the classifier wrote, not on the decayed rank", async () => {
      // Otherwise "show me everything above 70" would quietly hide a 96 that
      // is two days old, and nobody could tell the filter from the decay.
      await seed({ monitorId, score: 96, postedAt: daysAgo(2) });

      const page = await listMatches(db, { asOf: now, minScore: 90 });

      expect(page.matches).toHaveLength(1);
      expect(at(page, 0).rank).toBe(72);
    });
  });

  describe("paging", () => {
    it("walks every match once, in rank order", async () => {
      const expected: string[] = [];
      for (let index = 0; index < 25; index += 1) {
        expected.push(await seed({ monitorId, score: 100 - index, postedAt: minutesAgo(index) }));
      }

      const seen: InboxMatch[] = [];
      let cursor: string | null = null;
      let pages = 0;

      do {
        const page = await listMatches(db, { asOf: now, limit: 7, cursor });
        seen.push(...page.matches);
        cursor = page.nextCursor;
        pages += 1;
      } while (cursor);

      expect(pages).toBe(4);
      expect(seen.map((match) => match.id)).toEqual(expected);
      expect(new Set(seen.map((match) => match.id)).size).toBe(25);
    });

    it("separates two matches that share a rank, and never repeats one", async () => {
      // The tie is what the id half of the cursor is for. With rank alone the
      // boundary row comes back on the next page, or is skipped.
      const posted = minutesAgo(30);
      const ids = [
        await seed({ monitorId, score: 80, postedAt: posted }),
        await seed({ monitorId, score: 80, postedAt: posted }),
        await seed({ monitorId, score: 80, postedAt: posted }),
      ];

      const first = await listMatches(db, { asOf: now, limit: 2 });
      const second = await listMatches(db, {
        asOf: now,
        limit: 2,
        cursor: first.nextCursor,
      });

      const seen = [...first.matches, ...second.matches].map((match) => match.id);
      expect(seen).toHaveLength(3);
      expect(new Set(seen)).toEqual(new Set(ids));
    });

    it("stops with no cursor on the last page", async () => {
      await seed({ monitorId, score: 60, postedAt: minutesAgo(5) });

      const page = await listMatches(db, { asOf: now, limit: 1 });

      expect(page.nextCursor).toBeNull();
    });

    it("refuses a cursor it did not issue", async () => {
      await expect(listMatches(db, { asOf: now, cursor: "nonsense" })).rejects.toBeInstanceOf(
        UnusableCursorError,
      );
    });

    it("issues a cursor that survives being written down and read back", async () => {
      await seed({ monitorId, score: 73, postedAt: minutesAgo(97) });
      await seed({ monitorId, score: 71, postedAt: minutesAgo(13) });

      const first = await listMatches(db, { asOf: now, limit: 1 });
      const rebuilt = cursorFor(at(first, 0));

      const second = await listMatches(db, { asOf: now, limit: 1, cursor: rebuilt });

      expect(second.matches).toHaveLength(1);
      expect(at(second, 0).id).not.toBe(at(first, 0).id);
    });
  });

  describe("what a card needs", () => {
    it("returns the reasons, the three sub-scores and the link", async () => {
      await seed({
        monitorId,
        score: 94,
        postedAt: minutesAgo(12),
        reasons: ["Small SaaS team", "Explicit manual-testing pain", "Asking for solutions"],
      });

      const match = at(await listMatches(db, { asOf: now }), 0);

      expect(match.reasons).toEqual([
        "Small SaaS team",
        "Explicit manual-testing pain",
        "Asking for solutions",
      ]);
      expect([match.problemFit, match.icpFit, match.intent]).toEqual([98, 91, 94]);
      expect(match.source).toBe("reddit");
      expect(match.channel).toBe("SaaS");
      expect(match.url).toContain("reddit.com");
      expect(match.postedAt).toEqual(minutesAgo(12));
    });

    it("names the intent in the words the monitor form used", async () => {
      await seed({
        monitorId,
        score: 80,
        postedAt: minutesAgo(1),
        intentType: "alternative_search",
      });

      const match = at(await listMatches(db, { asOf: now }), 0);

      expect(match.intentLabel).toBe("Looking for alternatives");
    });

    it("says so plainly when the classifier found no intent", async () => {
      await seed({ monitorId, score: 30, postedAt: minutesAgo(1), intentType: "none" });

      const match = at(await listMatches(db, { asOf: now }), 0);

      expect(match.intentLabel).toBe("No clear intent");
    });
  });
});
