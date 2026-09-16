/**
 * Where the choice of provider is written and read.
 *
 * The table is small and the rules are few, so what this file is really about
 * is the three claims made of it: US-026's two — the choice outlives the
 * process that made it, and no row is a legitimate state rather than a missing
 * one — and BUG-010's, that a choice is one account's and reaches no other.
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

/** Two accounts on one instance, which is what BUG-010 is about. */
const anna = "user-anna";
const ben = "user-ben";

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
    expect(await readProviderChoices(db, anna)).toEqual({});
  });

  it("survives a restart", async () => {
    await setProviderChoice(db, anna, "reddit", "scrapecreators");

    // A second connection, which is what a restarted worker has. A choice kept
    // in the process that made it would be a choice the worker never sees.
    const restarted = createDatabase(database.url);

    try {
      expect(await readProviderChoices(restarted.db, anna)).toEqual({ reddit: "scrapecreators" });
    } finally {
      await restarted.close();
    }
  });

  it("replaces the choice rather than adding a second one", async () => {
    await setProviderChoice(db, anna, "reddit", "brightdata");
    await setProviderChoice(db, anna, "reddit", "scrapecreators");

    expect(await readProviderChoices(db, anna)).toEqual({ reddit: "scrapecreators" });
    expect(await db.select().from(sourceProviders)).toHaveLength(1);
  });

  it("keeps one platform's choice out of another's", async () => {
    await setProviderChoice(db, anna, "reddit", "scrapecreators");
    await setProviderChoice(db, anna, "x", "brightdata");

    expect(await readProviderChoices(db, anna)).toEqual({
      reddit: "scrapecreators",
      x: "brightdata",
    });
  });

  it("forgets a choice, and says whether there was one", async () => {
    await setProviderChoice(db, anna, "reddit", "brightdata");

    expect(await clearProviderChoice(db, anna, "reddit")).toBe(true);
    expect(await readProviderChoices(db, anna)).toEqual({});
    // Clearing twice is not an error, and the second answer says so: the
    // route above it tells "cleared" from "there was nothing to clear".
    expect(await clearProviderChoice(db, anna, "reddit")).toBe(false);
  });

  it("refuses a provider the schema does not know", async () => {
    // The check constraint, not a validator. A row nothing can fetch through
    // would be a poll that fails at night rather than a write that fails now.
    await expect(
      setProviderChoice(db, anna, "reddit", "a-provider-that-does-not-exist" as "brightdata"),
    ).rejects.toThrow();
  });

  describe("with two accounts on the instance", () => {
    it("keeps one account's choice out of the other's", async () => {
      // BUG-010. Both name the same platform and disagree about who fetches
      // it, which is the whole of the bug: keyed by the platform alone, the
      // second write was an edit of the first.
      await setProviderChoice(db, anna, "reddit", "brightdata");
      await setProviderChoice(db, ben, "reddit", "scrapecreators");

      expect(await readProviderChoices(db, anna)).toEqual({ reddit: "brightdata" });
      expect(await readProviderChoices(db, ben)).toEqual({ reddit: "scrapecreators" });
      expect(await db.select().from(sourceProviders)).toHaveLength(2);
    });

    it("answers nothing for an account that has chosen nothing", async () => {
      // The reading that matters most, because it is the one the poll makes.
      // A neighbour's row must not become this account's recorded choice: by
      // US-026's rule a choice that cannot run is refused rather than
      // replaced, so inheriting one is how a stranger stops these monitors.
      await setProviderChoice(db, anna, "reddit", "brightdata");

      expect(await readProviderChoices(db, ben)).toEqual({});
    });

    it("clears only the account that asked", async () => {
      await setProviderChoice(db, anna, "reddit", "brightdata");
      await setProviderChoice(db, ben, "reddit", "scrapecreators");

      expect(await clearProviderChoice(db, ben, "reddit")).toBe(true);

      expect(await readProviderChoices(db, anna)).toEqual({ reddit: "brightdata" });
      expect(await readProviderChoices(db, ben)).toEqual({});
    });

    it("says there was nothing to clear when the row is somebody else's", async () => {
      await setProviderChoice(db, anna, "reddit", "brightdata");

      // False rather than true, and Anna's row still standing. A delete
      // written without the owner would report success here and have deleted
      // hers.
      expect(await clearProviderChoice(db, ben, "reddit")).toBe(false);
      expect(await readProviderChoices(db, anna)).toEqual({ reddit: "brightdata" });
    });
  });
});
