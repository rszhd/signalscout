/**
 * Written before `store.ts`, against real Postgres.
 *
 * Correctness-critical: credential encryption. The failure this file exists to
 * catch is a key that reaches somewhere a person can read it, and a stored key
 * that comes back as nothing instead of coming back as an error.
 */
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { sourceCredentials } from "../db/schema.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import {
  generateEncryptionKey,
  MissingEncryptionKeyError,
  readEncryptionKey,
  UndecryptableSecretError,
} from "./cipher.js";
import {
  assertStoredCredentialsAreReadable,
  credentialRecordName,
  deleteSourceCredential,
  listCredentialHints,
  putSourceCredential,
  readSourceCredential,
  rotateEncryptionKey,
} from "./store.js";

const key = readEncryptionKey(generateEncryptionKey());
const replacementKey = readEncryptionKey(generateEncryptionKey());

describe("the credential store", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("credential_store");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(sourceCredentials);
  });

  describe("writing and reading", () => {
    it("returns the value that was stored", async () => {
      await putSourceCredential(db, key, {
        provider: "brightdata",
        field: "apiKey",
        value: "brd_1234",
      });

      expect(await readSourceCredential(db, key, "brightdata", "apiKey")).toBe("brd_1234");
    });

    it("stores no plaintext anywhere in the row", async () => {
      const secret = "brd_do_not_print_this_9999";

      await putSourceCredential(db, key, {
        provider: "brightdata",
        field: "apiKey",
        value: secret,
      });

      const [row] = await db.select().from(sourceCredentials);
      const wholeRow = JSON.stringify(row);

      expect(wholeRow).not.toContain(secret);
      expect(wholeRow).not.toContain("do_not_print_this");
    });

    it("replaces a credential rather than keeping the old one", async () => {
      // Keeping the previous ciphertext keeps the previous key working, which
      // is the opposite of what replacing a leaked key is for.
      await putSourceCredential(db, key, {
        provider: "brightdata",
        field: "apiKey",
        value: "first",
      });
      await putSourceCredential(db, key, {
        provider: "brightdata",
        field: "apiKey",
        value: "second",
      });

      expect(await db.select().from(sourceCredentials)).toHaveLength(1);
      expect(await readSourceCredential(db, key, "brightdata", "apiKey")).toBe("second");
    });

    it("keeps one field's credential apart from another's", async () => {
      await putSourceCredential(db, key, {
        provider: "brightdata",
        field: "apiKey",
        value: "the-key",
      });
      await putSourceCredential(db, key, {
        provider: "brightdata",
        field: "apiSecret",
        value: "the-secret",
      });

      expect(await readSourceCredential(db, key, "brightdata", "apiKey")).toBe("the-key");
      expect(await readSourceCredential(db, key, "brightdata", "apiSecret")).toBe("the-secret");
    });

    it("answers undefined for a credential that was never stored", async () => {
      expect(await readSourceCredential(db, key, "brightdata", "apiKey")).toBeUndefined();
    });

    it("refuses to store a blank value", async () => {
      await expect(
        putSourceCredential(db, key, { provider: "brightdata", field: "apiKey", value: "" }),
      ).rejects.toThrow(/blank/i);
    });

    it("forgets a credential that is deleted", async () => {
      await putSourceCredential(db, key, {
        provider: "brightdata",
        field: "apiKey",
        value: "brd_1234",
      });
      await deleteSourceCredential(db, "brightdata", "apiKey");

      expect(await readSourceCredential(db, key, "brightdata", "apiKey")).toBeUndefined();
    });
  });

  describe("a value that cannot be decrypted", () => {
    it("throws and names the record, rather than answering with nothing", async () => {
      await putSourceCredential(db, key, {
        provider: "brightdata",
        field: "apiKey",
        value: "brd_1234",
      });

      await expect(
        readSourceCredential(db, replacementKey, "brightdata", "apiKey"),
      ).rejects.toThrow(UndecryptableSecretError);
      await expect(
        readSourceCredential(db, replacementKey, "brightdata", "apiKey"),
      ).rejects.toThrow(/brightdata:apiKey/);
    });

    it("refuses a row whose ciphertext was swapped for another record's", async () => {
      await putSourceCredential(db, key, {
        provider: "brightdata",
        field: "apiKey",
        value: "the-key",
      });
      await putSourceCredential(db, key, {
        provider: "brightdata",
        field: "apiSecret",
        value: "the-secret",
      });

      const [apiKey] = await db.select().from(sourceCredentials).where(sql`field = 'apiKey'`);

      await db
        .update(sourceCredentials)
        .set({ ciphertext: apiKey?.ciphertext ?? "" })
        .where(sql`field = 'apiSecret'`);

      await expect(readSourceCredential(db, key, "brightdata", "apiSecret")).rejects.toThrow(
        UndecryptableSecretError,
      );
    });
  });

  describe("what the database itself refuses", () => {
    it("refuses a plaintext value written by hand", async () => {
      // The guard that survives us: somebody with psql and a hurry.
      expect(
        await violatedConstraint(
          db.execute(sql`
            INSERT INTO source_credentials (provider, field, ciphertext, record, hint)
            VALUES ('brightdata', 'apiKey', 'brd_plaintext_key', 'brightdata:apiKey', '••••_key')
          `),
        ),
      ).toBe("source_credentials_ciphertext_format");
    });

    it("refuses a hint that is longer than a mask", async () => {
      expect(
        await violatedConstraint(
          db.execute(sql`
            INSERT INTO source_credentials (provider, field, ciphertext, record, hint)
            VALUES ('brightdata', 'apiKey', 'v1.a.b.c', 'brightdata:apiKey', 'brd_plaintext_key')
          `),
        ),
      ).toBe("source_credentials_hint_masked");
    });
  });

  describe("what a person is shown", () => {
    it("lists the masked form and never the value", async () => {
      await putSourceCredential(db, key, {
        provider: "brightdata",
        field: "apiKey",
        value: "brd_abcdefgh1234",
      });

      const hints = await listCredentialHints(db);

      expect(hints).toEqual([{ provider: "brightdata", field: "apiKey", hint: "••••1234" }]);
    });

    it("lists hints without an encryption key at all", async () => {
      // Showing which key is set must not need the key that would decrypt it.
      await putSourceCredential(db, key, {
        provider: "brightdata",
        field: "apiKey",
        value: "brd_abcdefgh1234",
      });

      expect(await listCredentialHints(db)).toHaveLength(1);
    });
  });

  describe("the boot check", () => {
    it("passes when nothing is stored and no key is set", async () => {
      await expect(assertStoredCredentialsAreReadable(db, {})).resolves.toBeUndefined();
    });

    it("fails at boot when a credential is stored and no key is set", async () => {
      await putSourceCredential(db, key, {
        provider: "brightdata",
        field: "apiKey",
        value: "brd_1234",
      });

      await expect(assertStoredCredentialsAreReadable(db, {})).rejects.toThrow(
        MissingEncryptionKeyError,
      );
    });

    it("fails at boot when the key cannot read what is stored", async () => {
      // The wrong key, not a missing one. Found now, not on the first poll.
      await putSourceCredential(db, key, {
        provider: "brightdata",
        field: "apiKey",
        value: "brd_1234",
      });

      await expect(
        assertStoredCredentialsAreReadable(db, {
          ENCRYPTION_KEY: Buffer.from(replacementKey.bytes).toString("base64"),
        }),
      ).rejects.toThrow(UndecryptableSecretError);
    });

    it("passes when the key reads what is stored", async () => {
      await putSourceCredential(db, key, {
        provider: "brightdata",
        field: "apiKey",
        value: "brd_1234",
      });

      await expect(
        assertStoredCredentialsAreReadable(db, {
          ENCRYPTION_KEY: Buffer.from(key.bytes).toString("base64"),
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("rotating the key", () => {
    it("re-encrypts every credential and reports how many", async () => {
      await putSourceCredential(db, key, {
        provider: "brightdata",
        field: "apiKey",
        value: "the-key",
      });
      await putSourceCredential(db, key, {
        provider: "brightdata",
        field: "apiSecret",
        value: "the-secret",
      });

      expect(await rotateEncryptionKey(db, key, replacementKey)).toBe(2);

      expect(await readSourceCredential(db, replacementKey, "brightdata", "apiKey")).toBe(
        "the-key",
      );
      expect(await readSourceCredential(db, replacementKey, "brightdata", "apiSecret")).toBe(
        "the-secret",
      );
    });

    it("leaves nothing readable by the old key", async () => {
      await putSourceCredential(db, key, {
        provider: "brightdata",
        field: "apiKey",
        value: "the-key",
      });

      await rotateEncryptionKey(db, key, replacementKey);

      await expect(readSourceCredential(db, key, "brightdata", "apiKey")).rejects.toThrow(
        UndecryptableSecretError,
      );
    });

    it("changes nothing when one credential cannot be read with the old key", async () => {
      // Half a rotation is the worst outcome: some rows on each key and no
      // single key that opens them all. It is one transaction for that reason.
      await putSourceCredential(db, key, {
        provider: "brightdata",
        field: "apiKey",
        value: "the-key",
      });
      await putSourceCredential(db, replacementKey, {
        provider: "brightdata",
        field: "apiSecret",
        value: "the-secret",
      });

      await expect(rotateEncryptionKey(db, key, replacementKey)).rejects.toThrow(
        UndecryptableSecretError,
      );

      expect(await readSourceCredential(db, key, "brightdata", "apiKey")).toBe("the-key");
    });
  });

  describe("the record name", () => {
    it("is the source and the field, which is what an error has to name", () => {
      expect(credentialRecordName("reddit", "apiKey")).toBe("reddit:apiKey");
    });
  });
});

/**
 * The constraint Postgres refused on, by name.
 *
 * Drizzle wraps a query failure in its own error and keeps the driver's on
 * `cause`, so the constraint name is one level down. Reading it by name is the
 * point: "the insert failed" would still pass if it failed for another reason.
 */
async function violatedConstraint(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
    return undefined;
  } catch (error) {
    const cause = (error as { cause?: { constraint?: string } }).cause;
    return cause?.constraint;
  }
}
