/**
 * Where an encrypted credential is written and read.
 *
 * Correctness-critical: credential encryption. docs/testing.md names the
 * failure — a key reaches a log line or an API response — and `store.test.ts`
 * was written before this file.
 *
 * Today no screen writes here: every instance still reads its keys from the
 * environment, and `worker/credentials.ts` prefers a stored credential and
 * falls back to that. This exists ahead of the screen because US-004 says the
 * decision must not be made in a hurry by whichever ticket first needs a
 * second key.
 *
 * Three rules hold the surface together.
 *
 * **A read either returns the value or throws.** It never returns `undefined`
 * for a row that exists. An empty credential is four failed provider calls and
 * a dead-letter; a thrown error is one line naming the record.
 *
 * **Showing a credential never decrypts one.** `listCredentialHints` reads the
 * `hint` column and the API reads nothing else. There is no function here that
 * returns a plaintext credential to an HTTP handler, and there is no route
 * that calls one.
 *
 * **The key is checked at boot, against what is actually stored.**
 * `assertStoredCredentialsAreReadable` runs at startup and decrypts every row.
 * A wrong or missing key is a refusal to start, not a surprise at 02:00 on the
 * first poll after somebody edited `.env`.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { type Source, sourceCredentials } from "../db/schema.js";
import {
  decryptSecret,
  type EncryptionKey,
  encryptSecret,
  maskSecret,
  optionalEncryptionKey,
  requireEncryptionKey,
} from "./cipher.js";

/**
 * How a credential is named in an error, and what the cipher authenticates.
 *
 * One function so the name in the error and the name bound into the ciphertext
 * cannot drift apart. If they did, every row would fail to decrypt after a
 * change that looked like a rename.
 */
export function credentialRecordName(source: string, field: string): string {
  return `${source}:${field}`;
}

export interface StoredCredential {
  readonly source: Source;
  readonly field: string;
  readonly value: string;
}

/** What a person is shown: which key is set, and nothing more of it. */
export interface CredentialHint {
  readonly source: Source;
  readonly field: string;
  /** `••••1234`. */
  readonly hint: string;
}

/** Write one credential, replacing whatever was there. */
export async function putSourceCredential(
  db: Database,
  key: EncryptionKey,
  { source, field, value }: StoredCredential,
): Promise<void> {
  if (!value.trim()) {
    throw new Error(
      `Refusing to store a blank credential for ${credentialRecordName(source, field)}.`,
    );
  }

  const record = credentialRecordName(source, field);
  const row = {
    source,
    field,
    ciphertext: encryptSecret(key, value, record),
    hint: maskSecret(value),
    updatedAt: new Date(),
  };

  await db
    .insert(sourceCredentials)
    .values(row)
    .onConflictDoUpdate({
      target: [sourceCredentials.source, sourceCredentials.field],
      // The old ciphertext is overwritten, never kept beside the new one. A
      // second row would keep the replaced key working.
      set: { ciphertext: row.ciphertext, hint: row.hint, updatedAt: row.updatedAt },
    });
}

/**
 * Read one credential.
 *
 * Undefined means no row. It never means a row we could not open — that
 * throws, with the record's name.
 */
export async function readSourceCredential(
  db: Database,
  key: EncryptionKey,
  source: Source,
  field: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ ciphertext: sourceCredentials.ciphertext })
    .from(sourceCredentials)
    .where(and(eq(sourceCredentials.source, source), eq(sourceCredentials.field, field)));

  return row ? decryptSecret(key, row.ciphertext, credentialRecordName(source, field)) : undefined;
}

/** Every credential this instance holds, encrypted, in one read. */
export async function readAllSourceCredentials(
  db: Database,
  key: EncryptionKey,
): Promise<StoredCredential[]> {
  const rows = await db
    .select({
      source: sourceCredentials.source,
      field: sourceCredentials.field,
      ciphertext: sourceCredentials.ciphertext,
    })
    .from(sourceCredentials);

  return rows.map((row) => ({
    source: row.source,
    field: row.field,
    value: decryptSecret(key, row.ciphertext, credentialRecordName(row.source, row.field)),
  }));
}

/** Which credentials are set, in the only form that may leave this process. */
export async function listCredentialHints(db: Database): Promise<CredentialHint[]> {
  return db
    .select({
      source: sourceCredentials.source,
      field: sourceCredentials.field,
      hint: sourceCredentials.hint,
    })
    .from(sourceCredentials);
}

export async function deleteSourceCredential(
  db: Database,
  source: Source,
  field: string,
): Promise<void> {
  await db
    .delete(sourceCredentials)
    .where(and(eq(sourceCredentials.source, source), eq(sourceCredentials.field, field)));
}

/**
 * The boot check.
 *
 * An instance that stores no credential needs no key, and demanding one would
 * make `pnpm dev` on a clean checkout fail for a feature that is switched off.
 * An instance that does store one must be able to read it before it accepts
 * any work, so this decrypts every row rather than counting them.
 */
export async function assertStoredCredentialsAreReadable(
  db: Database,
  environment: Record<string, string | undefined> = process.env,
): Promise<void> {
  const [counted] = await db.select({ rows: sql<number>`count(*)::int` }).from(sourceCredentials);

  if (!counted?.rows) return;

  // Present-but-wrong is caught by `optionalEncryptionKey`'s shape check;
  // absent is caught here, with the sentence that says how to make one.
  optionalEncryptionKey(environment);

  await readAllSourceCredentials(db, requireEncryptionKey(environment));
}

/**
 * Re-encrypt every credential under a new key, or change nothing.
 *
 * One transaction, because half a rotation is worse than none: some rows on
 * each key and no single key that opens them all. docs/secrets.md, *Rotating
 * the key*, is the procedure this function is the middle of.
 */
export async function rotateEncryptionKey(
  db: Database,
  from: EncryptionKey,
  to: EncryptionKey,
): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        source: sourceCredentials.source,
        field: sourceCredentials.field,
        ciphertext: sourceCredentials.ciphertext,
      })
      .from(sourceCredentials);

    for (const row of rows) {
      const record = credentialRecordName(row.source, row.field);
      // Decrypt every row before writing any. A row that cannot be read with
      // the old key aborts the transaction with its own name in the message.
      const value = decryptSecret(from, row.ciphertext, record);

      await tx
        .update(sourceCredentials)
        .set({ ciphertext: encryptSecret(to, value, record), updatedAt: new Date() })
        .where(
          and(eq(sourceCredentials.source, row.source), eq(sourceCredentials.field, row.field)),
        );
    }

    return rows.length;
  });
}
