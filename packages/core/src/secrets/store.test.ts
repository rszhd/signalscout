/**
 * Written before `store.ts`, against real Postgres.
 *
 * Correctness-critical: credential encryption. The failure this file exists to
 * catch is a key that reaches somewhere a person can read it, and a stored key
 * that comes back as nothing instead of coming back as an error.
 */
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createAiKey } from "../ai/keys.js";
import { createDatabase, type Database } from "../db/client.js";
import { aiKeys, sourceCredentials } from "../db/schema.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import {
  decryptSecret,
  generateEncryptionKey,
  MissingEncryptionKeyError,
  readEncryptionKey,
  UndecryptableSecretError,
} from "./cipher.js";
import {
  assertStoredCredentialsAreReadable,
  credentialRecordName,
  credentialSlotName,
  deleteSourceCredential,
  listCredentialHints,
  putSourceCredential,
  readSourceCredential,
  rotateEncryptionKey,
  storedCredentialNames,
} from "./store.js";

const key = readEncryptionKey(generateEncryptionKey());
const replacementKey = readEncryptionKey(generateEncryptionKey());

/**
 * Whose keys these are. US-067.
 *
 * The cases below are about the cipher and are written for one account; the
 * block at the end of the file is the one about two.
 */
const owner = "account-1";

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
    await db.delete(aiKeys);
  });

  describe("writing and reading", () => {
    it("returns the value that was stored", async () => {
      await putSourceCredential(db, key, {
        userId: owner,
        provider: "brightdata",
        field: "apiKey",
        value: "brd_1234",
      });

      expect(await readSourceCredential(db, key, owner, "brightdata", "apiKey")).toBe("brd_1234");
    });

    it("stores no plaintext anywhere in the row", async () => {
      const secret = "brd_do_not_print_this_9999";

      await putSourceCredential(db, key, {
        userId: owner,
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
        userId: owner,
        provider: "brightdata",
        field: "apiKey",
        value: "first",
      });
      await putSourceCredential(db, key, {
        userId: owner,
        provider: "brightdata",
        field: "apiKey",
        value: "second",
      });

      expect(await db.select().from(sourceCredentials)).toHaveLength(1);
      expect(await readSourceCredential(db, key, owner, "brightdata", "apiKey")).toBe("second");
    });

    it("keeps one field's credential apart from another's", async () => {
      await putSourceCredential(db, key, {
        userId: owner,
        provider: "brightdata",
        field: "apiKey",
        value: "the-key",
      });
      await putSourceCredential(db, key, {
        userId: owner,
        provider: "brightdata",
        field: "apiSecret",
        value: "the-secret",
      });

      expect(await readSourceCredential(db, key, owner, "brightdata", "apiKey")).toBe("the-key");
      expect(await readSourceCredential(db, key, owner, "brightdata", "apiSecret")).toBe(
        "the-secret",
      );
    });

    it("answers undefined for a credential that was never stored", async () => {
      expect(await readSourceCredential(db, key, owner, "brightdata", "apiKey")).toBeUndefined();
    });

    it("refuses to store a blank value", async () => {
      await expect(
        putSourceCredential(db, key, {
          userId: owner,
          provider: "brightdata",
          field: "apiKey",
          value: "",
        }),
      ).rejects.toThrow(/blank/i);
    });

    it("forgets a credential that is deleted", async () => {
      await putSourceCredential(db, key, {
        userId: owner,
        provider: "brightdata",
        field: "apiKey",
        value: "brd_1234",
      });
      await deleteSourceCredential(db, owner, "brightdata", "apiKey");

      expect(await readSourceCredential(db, key, owner, "brightdata", "apiKey")).toBeUndefined();
    });
  });

  describe("a value that cannot be decrypted", () => {
    it("throws and names the record, rather than answering with nothing", async () => {
      await putSourceCredential(db, key, {
        userId: owner,
        provider: "brightdata",
        field: "apiKey",
        value: "brd_1234",
      });

      await expect(
        readSourceCredential(db, replacementKey, owner, "brightdata", "apiKey"),
      ).rejects.toThrow(UndecryptableSecretError);
      await expect(
        readSourceCredential(db, replacementKey, owner, "brightdata", "apiKey"),
      ).rejects.toThrow(/brightdata:apiKey/);
    });

    it("refuses a row whose ciphertext was swapped for another record's", async () => {
      await putSourceCredential(db, key, {
        userId: owner,
        provider: "brightdata",
        field: "apiKey",
        value: "the-key",
      });
      await putSourceCredential(db, key, {
        userId: owner,
        provider: "brightdata",
        field: "apiSecret",
        value: "the-secret",
      });

      const [apiKey] = await db.select().from(sourceCredentials).where(sql`field = 'apiKey'`);

      await db
        .update(sourceCredentials)
        .set({ ciphertext: apiKey?.ciphertext ?? "" })
        .where(sql`field = 'apiSecret'`);

      await expect(readSourceCredential(db, key, owner, "brightdata", "apiSecret")).rejects.toThrow(
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
            INSERT INTO source_credentials (user_id, provider, field, ciphertext, record, hint)
            VALUES ('account-1', 'brightdata', 'apiKey', 'brd_plaintext_key',
                    'account-1:brightdata:apiKey', '••••_key')
          `),
        ),
      ).toBe("source_credentials_ciphertext_format");
    });

    it("refuses a hint that is longer than a mask", async () => {
      expect(
        await violatedConstraint(
          db.execute(sql`
            INSERT INTO source_credentials (user_id, provider, field, ciphertext, record, hint)
            VALUES ('account-1', 'brightdata', 'apiKey', 'v1.a.b.c',
                    'account-1:brightdata:apiKey', 'brd_plaintext_key')
          `),
        ),
      ).toBe("source_credentials_hint_masked");
    });
  });

  describe("what a person is shown", () => {
    it("lists the masked form and never the value", async () => {
      await putSourceCredential(db, key, {
        userId: owner,
        provider: "brightdata",
        field: "apiKey",
        value: "brd_abcdefgh1234",
      });

      const hints = await listCredentialHints(db, owner);

      expect(hints).toEqual([{ provider: "brightdata", field: "apiKey", hint: "••••1234" }]);
    });

    it("lists hints without an encryption key at all", async () => {
      // Showing which key is set must not need the key that would decrypt it.
      await putSourceCredential(db, key, {
        userId: owner,
        provider: "brightdata",
        field: "apiKey",
        value: "brd_abcdefgh1234",
      });

      expect(await listCredentialHints(db, owner)).toHaveLength(1);
    });
  });

  describe("the boot check", () => {
    it("passes when nothing is stored and no key is set", async () => {
      await expect(assertStoredCredentialsAreReadable(db, {})).resolves.toBeUndefined();
    });

    it("fails at boot when a credential is stored and no key is set", async () => {
      await putSourceCredential(db, key, {
        userId: owner,
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
        userId: owner,
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
        userId: owner,
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
        userId: owner,
        provider: "brightdata",
        field: "apiKey",
        value: "the-key",
      });
      await putSourceCredential(db, key, {
        userId: owner,
        provider: "brightdata",
        field: "apiSecret",
        value: "the-secret",
      });

      expect(await rotateEncryptionKey(db, key, replacementKey)).toBe(2);

      expect(await readSourceCredential(db, replacementKey, owner, "brightdata", "apiKey")).toBe(
        "the-key",
      );
      expect(await readSourceCredential(db, replacementKey, owner, "brightdata", "apiSecret")).toBe(
        "the-secret",
      );
    });

    /**
     * The one that reports success and breaks everything. US-079.
     *
     * A rotation that skips model keys leaves them readable only by a key the
     * procedure tells you to throw away — and nothing says so until the next
     * poll, when every model call fails at once.
     */
    it("rotates model keys too, and counts them", async () => {
      await createAiKey(db, key, owner, { name: "My OpenAI key", apiKey: "sk-model" });

      expect(await rotateEncryptionKey(db, key, replacementKey)).toBe(1);

      const [row] = await db.select().from(aiKeys);
      if (!row) throw new Error("The key was not stored.");

      expect(decryptSecret(replacementKey, row.ciphertext, row.record)).toBe("sk-model");
    });

    it("leaves nothing readable by the old key", async () => {
      await putSourceCredential(db, key, {
        userId: owner,
        provider: "brightdata",
        field: "apiKey",
        value: "the-key",
      });

      await rotateEncryptionKey(db, key, replacementKey);

      await expect(readSourceCredential(db, key, owner, "brightdata", "apiKey")).rejects.toThrow(
        UndecryptableSecretError,
      );
    });

    it("changes nothing when one credential cannot be read with the old key", async () => {
      // Half a rotation is the worst outcome: some rows on each key and no
      // single key that opens them all. It is one transaction for that reason.
      await putSourceCredential(db, key, {
        userId: owner,
        provider: "brightdata",
        field: "apiKey",
        value: "the-key",
      });
      await putSourceCredential(db, replacementKey, {
        userId: owner,
        provider: "brightdata",
        field: "apiSecret",
        value: "the-secret",
      });

      await expect(rotateEncryptionKey(db, key, replacementKey)).rejects.toThrow(
        UndecryptableSecretError,
      );

      expect(await readSourceCredential(db, key, owner, "brightdata", "apiKey")).toBe("the-key");
    });
  });

  describe("the record name", () => {
    /**
     * Two names, and they answer different questions.
     *
     * The *record* is what the ciphertext is authenticated with, so it has to
     * carry the owner: without it, one account's row could be pasted into
     * another's slot by anybody with `psql` and would decrypt happily.
     *
     * The *slot* is how readiness is spoken about — "is brightdata:apiKey
     * set?" — and it must not carry the owner, because the set it keys is
     * already one person's. Putting the id in both would make every readiness
     * message name an account nobody asked about.
     */
    it("binds the ciphertext to the owner, the provider and the field", () => {
      expect(credentialRecordName("account-1", "reddit", "apiKey")).toBe("account-1:reddit:apiKey");
    });

    it("names a slot without the owner, because the set is already one person's", () => {
      expect(credentialSlotName("reddit", "apiKey")).toBe("reddit:apiKey");
    });
  });

  /**
   * What one account can do to another's keys. US-067.
   *
   * Correctness-critical, and this is the block the ticket exists for. Until
   * US-066 there could be only one account, so a shared row was invisible.
   * With signup open it is three faults at once: a stranger polls on the
   * owner's key and bill, the second person to paste silently overwrites the
   * first, and anybody signed in can delete a key and stop every monitor.
   */
  describe("one account's keys against another's", () => {
    const other = "account-2";

    it("keeps two accounts' keys for the same provider apart", async () => {
      await putSourceCredential(db, key, {
        userId: owner,
        provider: "brightdata",
        field: "apiKey",
        value: "the-owners-key",
      });
      await putSourceCredential(db, key, {
        userId: other,
        provider: "brightdata",
        field: "apiKey",
        value: "the-other-key",
      });

      expect(await readSourceCredential(db, key, owner, "brightdata", "apiKey")).toBe(
        "the-owners-key",
      );
      expect(await readSourceCredential(db, key, other, "brightdata", "apiKey")).toBe(
        "the-other-key",
      );

      // Two rows, not one overwritten. The silent overwrite is the fault.
      expect(await db.select().from(sourceCredentials)).toHaveLength(2);
    });

    it("answers nothing for a provider only somebody else has connected", async () => {
      await putSourceCredential(db, key, {
        userId: owner,
        provider: "brightdata",
        field: "apiKey",
        value: "the-owners-key",
      });

      expect(await readSourceCredential(db, key, other, "brightdata", "apiKey")).toBeUndefined();
      expect(await listCredentialHints(db, other)).toEqual([]);
      expect(await storedCredentialNames(db, other)).toEqual(new Set());
    });

    it("deletes only the asking account's key", async () => {
      await putSourceCredential(db, key, {
        userId: owner,
        provider: "brightdata",
        field: "apiKey",
        value: "the-owners-key",
      });
      await putSourceCredential(db, key, {
        userId: other,
        provider: "brightdata",
        field: "apiKey",
        value: "the-other-key",
      });

      await deleteSourceCredential(db, other, "brightdata", "apiKey");

      expect(await readSourceCredential(db, key, owner, "brightdata", "apiKey")).toBe(
        "the-owners-key",
      );
      expect(await readSourceCredential(db, key, other, "brightdata", "apiKey")).toBeUndefined();
    });

    /**
     * The reason the owner is in the record and not only in the key.
     *
     * A primary key stops one account *writing* into another's slot through
     * this code. It does nothing about somebody with database access moving a
     * ciphertext between rows, and the cipher is what refuses that.
     */
    it("refuses a ciphertext copied from another account's row", async () => {
      await putSourceCredential(db, key, {
        userId: owner,
        provider: "brightdata",
        field: "apiKey",
        value: "the-owners-key",
      });
      await putSourceCredential(db, key, {
        userId: other,
        provider: "brightdata",
        field: "apiKey",
        value: "the-other-key",
      });

      const [stolen] = await db.select().from(sourceCredentials).where(sql`user_id = 'account-1'`);

      await db
        .update(sourceCredentials)
        .set({ ciphertext: stolen?.ciphertext ?? "" })
        .where(sql`user_id = 'account-2'`);

      await expect(readSourceCredential(db, key, other, "brightdata", "apiKey")).rejects.toThrow(
        UndecryptableSecretError,
      );
    });

    it("rotates every account's keys, not only the first one's", async () => {
      await putSourceCredential(db, key, {
        userId: owner,
        provider: "brightdata",
        field: "apiKey",
        value: "the-owners-key",
      });
      await putSourceCredential(db, key, {
        userId: other,
        provider: "brightdata",
        field: "apiKey",
        value: "the-other-key",
      });

      expect(await rotateEncryptionKey(db, key, replacementKey)).toBe(2);

      expect(await readSourceCredential(db, replacementKey, owner, "brightdata", "apiKey")).toBe(
        "the-owners-key",
      );
      expect(await readSourceCredential(db, replacementKey, other, "brightdata", "apiKey")).toBe(
        "the-other-key",
      );
    });

    it("checks every account's keys at boot", async () => {
      await putSourceCredential(db, key, {
        userId: other,
        provider: "brightdata",
        field: "apiKey",
        value: "the-other-key",
      });

      // The boot check reads the whole table. A key that opens the first
      // account's rows and not the second's must stop the process, or that
      // account's monitors fail one at a time at whatever hour they run.
      await expect(
        assertStoredCredentialsAreReadable(db, {
          ENCRYPTION_KEY: generateEncryptionKey(),
        }),
      ).rejects.toThrow(UndecryptableSecretError);
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
