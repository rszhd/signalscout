/**
 * Verdicts, against real Postgres.
 *
 * Three of these cannot be asserted anywhere lighter. "One verdict per match
 * per user" is a partial unique index, so only a real database can be asked
 * whether superseding and inserting in one transaction respects it. The counts
 * are a grouped aggregate over the rows still in force. And the version a
 * verdict carries is read from a column another function increments, so the
 * two have to meet in one database to disagree.
 *
 * The expected values here are written as literals a person can check against
 * the story in each case, not computed from the code under test.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { unclaimedUserId } from "../auth/user.js";
import { createDatabase, type Database } from "../db/client.js";
import { feedback, matches, monitors, posts } from "../db/schema.js";
import { updateMonitor } from "../monitors/monitors.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { currentVerdicts, exportFeedback, recordVerdict, verdictCounts } from "./feedback.js";

/** The row an insert returned. Explicit, because an empty list is a bug here. */
function inserted<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (!row) throw new Error("The row was not inserted.");
  return row;
}

describe("verdicts on a match", () => {
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
          userId: unclaimedUserId,
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

  /** One match on one monitor. Returns the match id. */
  async function seedMatch(monitor: string, score = 88): Promise<string> {
    postSequence += 1;
    const post = inserted(
      await db
        .insert(posts)
        .values({
          source: "reddit",
          externalId: `t3_${postSequence}`,
          url: `https://reddit.com/r/SaaS/comments/${postSequence}`,
          author: "someone",
          channel: "SaaS",
          title: "How are small teams handling regression testing?",
          excerpt: "We're manually checking our major flows before every release.",
          postedAt: new Date("2026-09-05T09:00:00.000Z"),
        })
        .returning({ id: posts.id }),
    );

    const row = inserted(
      await db
        .insert(matches)
        .values({
          monitorId: monitor,
          postId: post.id,
          score,
          relevance: 90,
          problemFit: 98,
          icpFit: 91,
          intent: 94,
          urgency: 70,
          intentType: "problem",
          reasons: ["Small SaaS team", "Explicit manual-testing pain"],
        })
        .returning({ id: matches.id }),
    );

    return row.id;
  }

  beforeAll(async () => {
    database = await createTestDatabase("feedback");
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
    await db.update(monitors).set({ version: 1 });
  });

  it("stores the user, the match, the monitor and a timestamp", async () => {
    const matchId = await seedMatch(monitorId);

    const recorded = await recordVerdict(db, { matchId, userId: unclaimedUserId, verdict: "good" });

    expect(recorded?.verdict).toBe("good");
    expect(recorded?.monitorId).toBe(monitorId);
    expect(recorded?.userId).toBe(unclaimedUserId);
    expect(recorded?.createdAt).toBeInstanceOf(Date);
    expect(recorded?.changed).toBe(false);
  });

  it("answers with nothing when no match has that id", async () => {
    const recorded = await recordVerdict(db, {
      matchId: "00000000-0000-4000-8000-000000000000",
      userId: unclaimedUserId,
      verdict: "good",
    });

    expect(recorded).toBeUndefined();
  });

  it("records a change of mind instead of overwriting the first answer", async () => {
    const matchId = await seedMatch(monitorId);

    await recordVerdict(db, { matchId, userId: unclaimedUserId, verdict: "good" });
    const second = await recordVerdict(db, {
      matchId,
      userId: unclaimedUserId,
      verdict: "not_relevant",
    });

    const rows = await db.select().from(feedback);

    // Two rows: what they thought, and what they think. One in force.
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.supersededAt === null)).toHaveLength(1);
    expect(rows.find((row) => row.verdict === "good")?.supersededAt).toBeInstanceOf(Date);
    expect(second?.verdict).toBe("not_relevant");
    expect(second?.changed).toBe(true);
  });

  it("writes nothing when the same verdict is given twice", async () => {
    const matchId = await seedMatch(monitorId);

    const first = await recordVerdict(db, { matchId, userId: unclaimedUserId, verdict: "good" });
    const again = await recordVerdict(db, { matchId, userId: unclaimedUserId, verdict: "good" });

    // A second press of the same button is not a change of mind, and a history
    // that recorded it as one would report a double click as one.
    expect(await db.select().from(feedback)).toHaveLength(1);
    expect(again?.id).toBe(first?.id);
    expect(again?.changed).toBe(false);
  });

  it("keeps one verdict in force per person, whoever else has judged", async () => {
    const matchId = await seedMatch(monitorId);

    await recordVerdict(db, { matchId, userId: unclaimedUserId, verdict: "good" });
    await recordVerdict(db, { matchId, userId: "someone-else", verdict: "not_relevant" });

    expect(await currentVerdicts(db, [matchId], unclaimedUserId)).toEqual(
      new Map([[matchId, "good"]]),
    );
    expect(await currentVerdicts(db, [matchId], "someone-else")).toEqual(
      new Map([[matchId, "not_relevant"]]),
    );
  });

  it("leaves a match nobody judged out of the map", async () => {
    const judged = await seedMatch(monitorId);
    const unjudged = await seedMatch(monitorId);

    await recordVerdict(db, { matchId: judged, userId: unclaimedUserId, verdict: "good" });

    const verdicts = await currentVerdicts(db, [judged, unjudged], unclaimedUserId);

    expect(verdicts.get(unjudged)).toBeUndefined();
    expect(verdicts.size).toBe(1);
  });

  describe("the version a verdict was given against", () => {
    it("carries the monitor's version at the time", async () => {
      const first = await seedMatch(monitorId);

      await recordVerdict(db, { matchId: first, userId: unclaimedUserId, verdict: "good" });

      await updateMonitor(db, monitorId, {
        problem: "Nobody can tell which release broke the checkout flow",
      });
      const second = await seedMatch(monitorId);
      const later = await recordVerdict(db, {
        matchId: second,
        userId: unclaimedUserId,
        verdict: "good",
      });

      const rows = await db.select().from(feedback);

      expect(rows.map((row) => row.monitorVersion).sort()).toEqual([1, 2]);
      expect(later?.monitorVersion).toBe(2);
    });

    it("leaves the first verdict's version alone when the monitor is edited", async () => {
      const matchId = await seedMatch(monitorId);

      await recordVerdict(db, { matchId, userId: unclaimedUserId, verdict: "good" });
      await updateMonitor(db, monitorId, { product: "Something completely different" });

      const [row] = await db.select().from(feedback);

      // The verdict was an answer to the old question. Renumbering it would
      // be a claim the person never made.
      expect(row?.monitorVersion).toBe(1);
    });
  });

  describe("the counts on the monitor list", () => {
    it("counts the verdicts in force, per monitor", async () => {
      const good = await seedMatch(monitorId);
      const alsoGood = await seedMatch(monitorId);
      const bad = await seedMatch(monitorId);
      const elsewhere = await seedMatch(otherMonitorId);

      await recordVerdict(db, { matchId: good, userId: unclaimedUserId, verdict: "good" });
      await recordVerdict(db, { matchId: alsoGood, userId: unclaimedUserId, verdict: "good" });
      await recordVerdict(db, { matchId: bad, userId: unclaimedUserId, verdict: "not_relevant" });
      await recordVerdict(db, {
        matchId: elsewhere,
        userId: unclaimedUserId,
        verdict: "not_relevant",
      });

      const counts = await verdictCounts(db);

      expect(counts.get(monitorId)).toEqual({ good: 2, notRelevant: 1 });
      expect(counts.get(otherMonitorId)).toEqual({ good: 0, notRelevant: 1 });
    });

    it("does not count a verdict that was changed", async () => {
      const matchId = await seedMatch(monitorId);

      await recordVerdict(db, { matchId, userId: unclaimedUserId, verdict: "good" });
      await recordVerdict(db, { matchId, userId: unclaimedUserId, verdict: "not_relevant" });

      // One person, one match, one opinion. A count over the history would
      // report this as one good lead and one bad one.
      expect((await verdictCounts(db, [monitorId])).get(monitorId)).toEqual({
        good: 0,
        notRelevant: 1,
      });
    });

    it("leaves a monitor nobody judged out of the map", async () => {
      await seedMatch(monitorId);

      expect((await verdictCounts(db)).get(monitorId)).toBeUndefined();
    });
  });

  describe("the export", () => {
    it("carries the history and the post's own identity", async () => {
      const matchId = await seedMatch(monitorId, 91);

      await recordVerdict(db, { matchId, userId: unclaimedUserId, verdict: "good" });
      await recordVerdict(db, { matchId, userId: unclaimedUserId, verdict: "not_relevant" });

      const exported = await exportFeedback(db, unclaimedUserId);

      expect(exported).toHaveLength(2);

      const current = exported.find((row) => row.supersededAt === null);
      expect(current?.verdict).toBe("not_relevant");
      expect(current?.monitorName).toBe("Teams replacing manual QA");
      expect(current?.monitorVersion).toBe(1);
      expect(current?.score).toBe(91);
      // The stable identity of the post. The ids above mean nothing in the
      // instance this file is read back into.
      expect(current?.source).toBe("reddit");
      expect(current?.externalId).toMatch(/^t3_\d+$/);
      expect(current?.url).toContain("reddit.com");

      expect(exported.find((row) => row.verdict === "good")?.supersededAt).toBeInstanceOf(Date);
    });

    it("exports one person's verdicts and not another's", async () => {
      const matchId = await seedMatch(monitorId);

      await recordVerdict(db, { matchId, userId: unclaimedUserId, verdict: "good" });
      await recordVerdict(db, { matchId, userId: "someone-else", verdict: "not_relevant" });

      expect(await exportFeedback(db, unclaimedUserId)).toHaveLength(1);
      expect(await exportFeedback(db, "someone-else")).toHaveLength(1);
    });
  });
});
