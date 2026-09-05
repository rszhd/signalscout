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
import { type Provider, sourceCredentials } from "../db/schema.js";
import {
  decryptSecret,
  type EncryptionKey,
  encryptSecret,
  maskSecret,
  optionalEncryptionKey,
  requireEncryptionKey,
} from "./cipher.js";

/**
 * How a credential is named in an error, and what a new ciphertext is
 * authenticated with.
 *
 * One function so the name in the error and the name bound into the ciphertext
 * cannot drift apart. If they did, every row would fail to decrypt after a
 * change that looked like a rename.
 *
 * That is exactly what US-024 would have done. It re-keyed this table from the
 * platform to the provider, and a row sealed as "reddit:apiKey" cannot be
 * opened as "brightdata:apiKey". So a row carries the name it was sealed with
 * in its own `record` column, and this function names only what is written
 * from now on. A rewrite normalises the row.
 */
export function credentialRecordName(provider: string, field: string): string {
  return `${provider}:${field}`;
}

export interface StoredCredential {
  readonly provider: Provider;
  readonly field: string;
  readonly value: string;
}

/** What a person is shown: which key is set, and nothing more of it. */
export interface CredentialHint {
  readonly provider: Provider;
  readonly field: string;
  /** `••••1234`. */
  readonly hint: string;
}

/** Write one credential, replacing whatever was there. */
export async function putSourceCredential(
  db: Database,
  key: EncryptionKey,
  { provider, field, value }: StoredCredential,
): Promise<void> {
  if (!value.trim()) {
    throw new Error(
      `Refusing to store a blank credential for ${credentialRecordName(provider, field)}.`,
    );
  }

  const record = credentialRecordName(provider, field);
  const row = {
    provider,
    field,
    record,
    ciphertext: encryptSecret(key, value, record),
    hint: maskSecret(value),
    updatedAt: new Date(),
  };

  await db
    .insert(sourceCredentials)
    .values(row)
    .onConflictDoUpdate({
      target: [sourceCredentials.provider, sourceCredentials.field],
      // The old ciphertext is overwritten, never kept beside the new one. A
      // second row would keep the replaced key working. `record` moves with
      // it, so a row written under an older name stops carrying one.
      set: {
        ciphertext: row.ciphertext,
        record: row.record,
        hint: row.hint,
        updatedAt: row.updatedAt,
      },
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
  provider: Provider,
  field: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ ciphertext: sourceCredentials.ciphertext, record: sourceCredentials.record })
    .from(sourceCredentials)
    .where(and(eq(sourceCredentials.provider, provider), eq(sourceCredentials.field, field)));

  // The row's own record name, not one derived here. US-024 renamed what this
  // is keyed by, and a derived name would refuse to open a key that works.
  return row ? decryptSecret(key, row.ciphertext, row.record) : undefined;
}

/** Every credential this instance holds, encrypted, in one read. */
export async function readAllSourceCredentials(
  db: Database,
  key: EncryptionKey,
): Promise<StoredCredential[]> {
  const rows = await db
    .select({
      provider: sourceCredentials.provider,
      field: sourceCredentials.field,
      ciphertext: sourceCredentials.ciphertext,
      record: sourceCredentials.record,
    })
    .from(sourceCredentials);

  return rows.map((row) => ({
    provider: row.provider,
    field: row.field,
    value: decryptSecret(key, row.ciphertext, row.record),
  }));
}

/** Which credentials are set, in the only form that may leave this process. */
export async function listCredentialHints(db: Database): Promise<CredentialHint[]> {
  return db
    .select({
      provider: sourceCredentials.provider,
      field: sourceCredentials.field,
      hint: sourceCredentials.hint,
    })
    .from(sourceCredentials);
}

/**
 * The stored credentials, as the `provider:field` names readiness is judged by.
 *
 * `startApi` and the routes both need this set, and both used to build it by
 * mapping `listCredentialHints` through `credentialRecordName` themselves. Two
 * copies of one join is how a set ends up holding names the store does not
 * use, so the join lives here.
 */
export async function storedCredentialNames(db: Database): Promise<ReadonlySet<string>> {
  const hints = await listCredentialHints(db);
  return new Set(hints.map((hint) => credentialRecordName(hint.provider, hint.field)));
}

export async function deleteSourceCredential(
  db: Database,
  provider: Provider,
  field: string,
): Promise<void> {
  await db
    .delete(sourceCredentials)
    .where(and(eq(sourceCredentials.provider, provider), eq(sourceCredentials.field, field)));
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
        provider: sourceCredentials.provider,
        field: sourceCredentials.field,
        ciphertext: sourceCredentials.ciphertext,
        record: sourceCredentials.record,
      })
      .from(sourceCredentials);

    for (const row of rows) {
      // Decrypt every row before writing any. A row that cannot be read with
      // the old key aborts the transaction with its own name in the message.
      const value = decryptSecret(from, row.ciphertext, row.record);
      // Sealed again under the current name. A rotation is the other moment a
      // row written before US-024 stops carrying its old one.
      const record = credentialRecordName(row.provider, row.field);

      await tx
        .update(sourceCredentials)
        .set({
          ciphertext: encryptSecret(to, value, record),
          record,
          updatedAt: new Date(),
        })
        .where(
          and(eq(sourceCredentials.provider, row.provider), eq(sourceCredentials.field, row.field)),
        );
    }

    return rows.length;
  });
}
