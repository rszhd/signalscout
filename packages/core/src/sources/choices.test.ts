/**
 * Where the choice of provider is written and read.
 *
 * The table is small and the rules are few, so what this file is really about
 * is the two claims US-026 makes about it: the choice outlives the process
 * that made it, and no row is a legitimate state rather than a missing one.
 *
 * Real Postgres, like every other test here. The check constraints are part of
 * the behaviour — an unknown provider is refused by the database and not by a
 * validator somebody may forget to call.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { sourceProviders } from "../db/schema.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { clearProviderChoice, readProviderChoices, setProviderChoice } from "./choices.js";

describe("the recorded provider for a platform", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("source_choices");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(sourceProviders);
  });

  it("answers with nothing when nobody has chosen", async () => {
    // The common deployment. It holds one provider's key, there is one
    // connector that can run, and no question was ever asked.
    expect(await readProviderChoices(db)).toEqual({});
  });

  it("survives a restart", async () => {
    await setProviderChoice(db, "reddit", "scrapecreators");

    // A second connection, which is what a restarted worker has. A choice kept
    // in the process that made it would be a choice the worker never sees.
    const restarted = createDatabase(database.url);

    try {
      expect(await readProviderChoices(restarted.db)).toEqual({ reddit: "scrapecreators" });
    } finally {
      await restarted.close();
    }
  });

  it("replaces the choice rather than adding a second one", async () => {
    await setProviderChoice(db, "reddit", "brightdata");
    await setProviderChoice(db, "reddit", "scrapecreators");

    expect(await readProviderChoices(db)).toEqual({ reddit: "scrapecreators" });
    expect(await db.select().from(sourceProviders)).toHaveLength(1);
  });

  it("keeps one platform's choice out of another's", async () => {
    await setProviderChoice(db, "reddit", "scrapecreators");
    await setProviderChoice(db, "x", "brightdata");

    expect(await readProviderChoices(db)).toEqual({
      reddit: "scrapecreators",
      x: "brightdata",
    });
  });

  it("forgets a choice, and says whether there was one", async () => {
    await setProviderChoice(db, "reddit", "brightdata");

    expect(await clearProviderChoice(db, "reddit")).toBe(true);
    expect(await readProviderChoices(db)).toEqual({});
    // Clearing twice is not an error, and the second answer says so: the
    // route above it tells "cleared" from "there was nothing to clear".
    expect(await clearProviderChoice(db, "reddit")).toBe(false);
  });

  it("refuses a provider the schema does not know", async () => {
    // The check constraint, not a validator. A row nothing can fetch through
    // would be a poll that fails at night rather than a write that fails now.
    await expect(
      setProviderChoice(db, "reddit", "a-provider-that-does-not-exist" as "brightdata"),
    ).rejects.toThrow();
  });
});
