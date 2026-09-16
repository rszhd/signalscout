/**
 * The account's setup marker. US-105.
 *
 * The table is one column and the rules are two: a marker is written once and
 * never deleted, and it belongs to one account and reaches no other. The first
 * is what keeps the setup gate away after an account removes its last key; the
 * second is BUG-010's shape on a different column.
 *
 * Real Postgres, like every other test here.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { userOnboarding } from "../db/schema.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { hasCompletedOnboarding, markOnboardingComplete } from "./onboarding.js";

const anna = "user-anna";
const ben = "user-ben";

describe("the setup marker", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("onboarding");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(userOnboarding);
  });

  it("answers that an account nobody marked has not set up", async () => {
    expect(await hasCompletedOnboarding(db, anna)).toBe(false);
  });

  it("survives a restart", async () => {
    await markOnboardingComplete(db, anna);

    // A second connection, which is what a restarted process has. A fact kept
    // in the process that wrote it would be a fact the next load never sees.
    const restarted = createDatabase(database.url);

    try {
      expect(await hasCompletedOnboarding(restarted.db, anna)).toBe(true);
    } finally {
      await restarted.close();
    }
  });

  it("marks the account once, however many times it is asked to", async () => {
    await markOnboardingComplete(db, anna);
    await markOnboardingComplete(db, anna);

    expect(await db.select().from(userOnboarding)).toHaveLength(1);
  });

  it("keeps one account's marker out of another's", async () => {
    await markOnboardingComplete(db, anna);

    expect(await hasCompletedOnboarding(db, anna)).toBe(true);
    expect(await hasCompletedOnboarding(db, ben)).toBe(false);
  });
});
