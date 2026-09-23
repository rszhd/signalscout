/**
 * The reads and writes that name one monitor, asked with the account that
 * wants them. US-336.
 *
 * Each case asks twice: as the owner, who gets the row, and as a stranger
 * holding the owner's real id, who gets what the unchecked function answers
 * for an id that does not exist — and changes nothing. The second half is the
 * one that matters. A stranger's answer that looks normal is the failure shape
 * of BUG-009 and BUG-330.
 */

import { scrapeCreatorsReddit } from "@signalscout/engine";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  checkBudget,
  checkOwnedBudget,
  clearOwnedBudget,
  getOwnedBudget,
  recordSourceUsage,
  setBudget,
  setOwnedBudget,
} from "../budget/budget.js";
import { createDatabase, type Database } from "../db/client.js";
import { apiUsage, budgets, matches, monitors, notificationSettings, posts } from "../db/schema.js";
import { ownsMatch } from "../matches/matches.js";
import {
  defaultNotificationSettings,
  readOwnedNotificationSettings,
  saveNotificationSettings,
  saveOwnedNotificationSettings,
} from "../notifications/settings.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import {
  deleteOwnedMonitor,
  getMonitor,
  getOwnedMonitor,
  pauseOwnedMonitor,
  resumeOwnedMonitor,
  updateOwnedMonitor,
} from "./monitors.js";

const owner = "owner-account";
const stranger = "stranger-account";

/** An id no row has. What a stranger is told must be what this is told. */
const nobody = "00000000-0000-4000-8000-000000000000";

const runtime = {
  descriptors: [scrapeCreatorsReddit],
  environment: { SCRAPECREATORS_API_KEY: "sc-test-key" },
};

const cap = { monthlyCapMicros: 5_000_000, onExhausted: "pause" } as const;

function inserted<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (!row) throw new Error("The row was not inserted.");
  return row;
}

describe("a monitor asked for by the account that owns it", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;
  let monitorId: string;
  let matchId: string;

  beforeAll(async () => {
    database = await createTestDatabase("owned");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  beforeEach(async () => {
    monitorId = inserted(
      await db
        .insert(monitors)
        .values({
          userId: owner,
          name: "Journeys",
          product: "A test runner that records browser flows instead of coding them",
          idealCustomer: "Small SaaS teams with no dedicated QA engineer",
          problem: "End-to-end tests break whenever the UI changes",
          signals: ["problem"],
          sources: ["reddit"],
        })
        .returning({ id: monitors.id }),
    ).id;

    const post = inserted(
      await db
        .insert(posts)
        .values({
          source: "reddit",
          externalId: "t3_owned",
          url: "https://reddit.com/r/SaaS/comments/owned",
          author: "someone",
          channel: "SaaS",
          title: "How are small teams handling regression testing?",
          excerpt: "We're manually checking our major flows before every release.",
          postedAt: new Date("2026-03-14T09:00:00Z"),
        })
        .returning({ id: posts.id }),
    );

    matchId = inserted(
      await db
        .insert(matches)
        .values({
          monitorId,
          postId: post.id,
          score: 88,
          relevance: 90,
          problemFit: 90,
          icpFit: 90,
          intent: 90,
          urgency: 70,
          intentType: "problem",
          reasons: ["Explicit manual-testing pain"],
        })
        .returning({ id: matches.id }),
    ).id;

    await setBudget(db, monitorId, cap);
    await saveNotificationSettings(
      db,
      monitorId,
      defaultNotificationSettings({ canSendEmail: false, emailTo: null }),
    );
    await recordSourceUsage(db, {
      userId: owner,
      monitorId,
      source: "reddit",
      provider: "scrapecreators",
      units: 10,
      pricePerUnitMicros: 1_000,
    });
  });

  afterEach(async () => {
    await db.delete(monitors);
    await db.delete(posts);
    await db.delete(apiUsage);
  });

  async function stored() {
    const [monitor] = await db.select().from(monitors).where(eq(monitors.id, monitorId));
    const [budget] = await db.select().from(budgets).where(eq(budgets.monitorId, monitorId));
    const [settings] = await db
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.monitorId, monitorId));
    return { monitor, budget, settings };
  }

  describe("the monitor itself", () => {
    it("is read by its owner and by nobody else", async () => {
      expect((await getOwnedMonitor(db, owner, monitorId))?.id).toBe(monitorId);
      expect(await getOwnedMonitor(db, stranger, monitorId)).toBeUndefined();
    });

    it("is edited by its owner and by nobody else", async () => {
      const before = await stored();

      expect(await updateOwnedMonitor(db, stranger, monitorId, { name: "Taken" })).toBeUndefined();
      expect(await stored()).toEqual(before);

      expect((await updateOwnedMonitor(db, owner, monitorId, { name: "Renamed" }))?.name).toBe(
        "Renamed",
      );
    });

    it("answers a stranger's empty edit as it answers an unknown id", async () => {
      // An edit with no fields is a read underneath. It is the easy one to
      // leave unchecked.
      expect(await updateOwnedMonitor(db, stranger, monitorId, {})).toBeUndefined();
    });

    it("is paused by its owner and by nobody else", async () => {
      expect(await pauseOwnedMonitor(db, stranger, monitorId)).toBeUndefined();
      expect((await stored()).monitor?.pausedAt).toBeNull();

      expect((await pauseOwnedMonitor(db, owner, monitorId))?.pausedAt).not.toBeNull();
    });

    it("is resumed by its owner and by nobody else", async () => {
      await db.update(monitors).set({ pausedAt: new Date() }).where(eq(monitors.id, monitorId));

      expect(await resumeOwnedMonitor(db, stranger, monitorId, runtime)).toBeUndefined();
      expect((await stored()).monitor?.pausedAt).not.toBeNull();

      const resumed = await resumeOwnedMonitor(db, owner, monitorId, runtime);
      expect(resumed?.status).toBe("resumed");
      expect((await stored()).monitor?.pausedAt).toBeNull();
    });

    it("is deleted by its owner and by nobody else", async () => {
      expect(await deleteOwnedMonitor(db, stranger, monitorId)).toBe(false);
      expect(await getMonitor(db, monitorId)).toBeDefined();

      expect(await deleteOwnedMonitor(db, owner, monitorId)).toBe(true);
      expect(await getMonitor(db, monitorId)).toBeUndefined();
    });
  });

  describe("its budget", () => {
    it("is read by its owner and by nobody else", async () => {
      expect(await getOwnedBudget(db, owner, monitorId)).toEqual(cap);
      expect(await getOwnedBudget(db, stranger, monitorId)).toBeUndefined();
    });

    it("is set by its owner and by nobody else", async () => {
      const raised = { monthlyCapMicros: 9_000_000, onExhausted: "pause" } as const;

      expect(await setOwnedBudget(db, stranger, monitorId, raised)).toBeUndefined();
      expect((await stored()).budget?.monthlyCapMicros).toBe(cap.monthlyCapMicros);

      expect(await setOwnedBudget(db, owner, monitorId, raised)).toEqual(raised);
      expect((await stored()).budget?.monthlyCapMicros).toBe(raised.monthlyCapMicros);
    });

    it("is removed by its owner and by nobody else", async () => {
      expect(await clearOwnedBudget(db, stranger, monitorId)).toBe(false);
      expect((await stored()).budget).toBeDefined();

      expect(await clearOwnedBudget(db, owner, monitorId)).toBe(true);
      expect((await stored()).budget).toBeUndefined();
    });

    it("shows its spend to its owner, and a stranger what an unknown id shows", async () => {
      const now = new Date();
      const mine = await checkOwnedBudget(db, owner, monitorId, now);

      expect(mine.spend.totalMicros).toBe(10_000);
      expect(mine.capMicros).toBe(cap.monthlyCapMicros);

      expect(await checkOwnedBudget(db, stranger, monitorId, now)).toEqual(
        await checkBudget(db, nobody, now),
      );
    });
  });

  describe("its notification settings", () => {
    it("are read by their owner and by nobody else", async () => {
      expect((await readOwnedNotificationSettings(db, owner, monitorId))?.monitorId).toBe(
        monitorId,
      );
      expect(await readOwnedNotificationSettings(db, stranger, monitorId)).toBeNull();
    });

    it("are saved by their owner and by nobody else", async () => {
      const before = await stored();
      const input = {
        ...defaultNotificationSettings({ canSendEmail: false, emailTo: null }),
        webhookEnabled: true,
        webhookUrl: "https://hooks.example.test/taken",
      };

      expect(await saveOwnedNotificationSettings(db, stranger, monitorId, input)).toBeUndefined();
      expect(await stored()).toEqual(before);

      const saved = await saveOwnedNotificationSettings(db, owner, monitorId, input);
      expect(saved?.webhookUrl).toBe("https://hooks.example.test/taken");
    });
  });

  describe("one of its matches", () => {
    it("is its owner's, and nobody else's", async () => {
      expect(await ownsMatch(db, owner, matchId)).toBe(true);
      expect(await ownsMatch(db, stranger, matchId)).toBe(false);
      expect(await ownsMatch(db, owner, nobody)).toBe(false);
    });
  });
});
