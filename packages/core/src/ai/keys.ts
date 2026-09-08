/**
 * One account's model API keys. US-079.
 *
 * Correctness-critical: credential encryption. The failure shape is
 * `secrets/store.ts`'s — a key reaching a log line or an API response.
 *
 * **A key is owned by the account and pointed at by a job.** US-068 hung one
 * off each job's settings row, so a person with a single key had to know which
 * job held it; US-078 then added a rule for lending it to the others, which is
 * a rule nobody asked to learn. Here a key is a row a person adds once and
 * names, and every job picks from the same list.
 *
 * Nothing reads a key back out. `list` returns masks, and the only path to a
 * plaintext is `ai/settings.ts` resolving what a job runs on.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { aiKeys } from "../db/schema.js";
import { decryptSecret, type EncryptionKey, encryptSecret, maskSecret } from "../secrets/cipher.js";

/** What the cipher authenticates: the owner, and this key's own id. */
export function aiKeyRecordName(userId: string, id: string): string {
  return `${userId}:ai-key:${id}`;
}

/** One stored key, as a person sees it. Never the key itself. */
export interface AiKey {
  readonly id: string;
  readonly name: string;
  /** The provider it is for, as a label. Null means nobody said. */
  readonly provider: string | null;
  /** `••••1234`. */
  readonly hint: string;
  readonly createdAt: Date;
}

export interface CreateAiKeyInput {
  readonly name: string;
  readonly provider?: string | null;
  readonly apiKey: string;
}

/** Thrown when a name is taken, so a route can answer 409 rather than 500. */
export class DuplicateAiKeyName extends Error {
  readonly keyName: string;

  constructor(keyName: string) {
    super(`You already have a key called "${keyName}".`);
    this.name = "DuplicateAiKeyName";
    this.keyName = keyName;
  }
}

/** Postgres says 23505 when a unique index refuses a row. */
function isUniqueViolation(error: unknown): boolean {
  const codeOf = (value: unknown): unknown => (value as { code?: unknown })?.code;

  return codeOf(error) === "23505" || codeOf((error as { cause?: unknown })?.cause) === "23505";
}

export async function listAiKeys(db: Database, userId: string): Promise<AiKey[]> {
  return await db
    .select({
      id: aiKeys.id,
      name: aiKeys.name,
      provider: aiKeys.provider,
      hint: aiKeys.hint,
      createdAt: aiKeys.createdAt,
    })
    .from(aiKeys)
    .where(eq(aiKeys.userId, userId))
    // By name, because this list is chosen from rather than read as a history.
    .orderBy(asc(sql`lower(${aiKeys.name})`));
}

/**
 * Store one key.
 *
 * The id is made here rather than by the database, because the cipher
 * authenticates the row's own id and the ciphertext has to exist before the
 * insert does. A row moved between two accounts' ids by anybody with `psql`
 * then fails to decrypt, which the primary key alone does not stop.
 */
export async function createAiKey(
  db: Database,
  key: EncryptionKey | undefined,
  userId: string,
  input: CreateAiKeyInput,
): Promise<AiKey> {
  const name = input.name.trim();
  const value = input.apiKey.trim();

  if (!name) throw new Error("A key needs a name.");
  if (!value) throw new Error("A key needs a value.");

  if (!key) {
    throw new Error(
      "This instance cannot store a key yet. Set ENCRYPTION_KEY to the base64 of 32 " +
        "random bytes — `openssl rand -base64 32` — and restart.",
    );
  }

  const id = randomUUID();
  const record = aiKeyRecordName(userId, id);

  try {
    const [row] = await db
      .insert(aiKeys)
      .values({
        id,
        userId,
        name,
        provider: input.provider ?? null,
        ciphertext: encryptSecret(key, value, record),
        record,
        hint: maskSecret(value),
      })
      .returning({
        id: aiKeys.id,
        name: aiKeys.name,
        provider: aiKeys.provider,
        hint: aiKeys.hint,
        createdAt: aiKeys.createdAt,
      });

    if (!row) throw new Error("The key was not stored.");
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateAiKeyName(name);
    throw error;
  }
}

/**
 * One key's plaintext, for the one caller that has to have it.
 *
 * `ai/settings.ts` opens keys for the worker; this is for testing a key a
 * person has chosen and not yet saved. It is a second door to a plaintext, so
 * it is a named function rather than a general read: nothing that answers a
 * browser calls it, and what it returns goes to a provider and nowhere else.
 *
 * Null when the key is not this account's, so a caller cannot spend another
 * account's key by guessing an id.
 */
export async function readAiKeySecret(
  db: Database,
  key: EncryptionKey | undefined,
  userId: string,
  id: string,
): Promise<string | null> {
  const [row] = await db
    .select({ ciphertext: aiKeys.ciphertext, record: aiKeys.record })
    .from(aiKeys)
    .where(and(eq(aiKeys.id, id), eq(aiKeys.userId, userId)));

  if (!row) return null;

  if (!key) {
    throw new Error(
      "This instance cannot open a stored key. Set ENCRYPTION_KEY to the value it was " +
        "stored under and restart.",
    );
  }

  // A stored key this process cannot open throws rather than answering null.
  // `ai/settings.ts` makes the same choice, and for the same reason: a
  // rotation that half worked must not look like a key nobody stored.
  return decryptSecret(key, row.ciphertext, row.record);
}

/**
 * Forget one key.
 *
 * Every job pointing at it goes back to the instance's key, by the foreign
 * key's `set null`. That is a decision: a job left pointing at nothing would
 * fail every call with no screen able to say why.
 */
export async function deleteAiKey(db: Database, userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(aiKeys)
    .where(and(eq(aiKeys.id, id), eq(aiKeys.userId, userId)))
    .returning({ id: aiKeys.id });

  return rows.length > 0;
}

/**
 * One key of this account's, or null.
 *
 * Null answers two questions at once — there is no such key, or it is somebody
 * else's — and a route wants the same answer to both: this account may not
 * spend it, and saying which is true would tell a stranger that an id exists.
 */
export async function readAiKey(db: Database, userId: string, id: string): Promise<AiKey | null> {
  const [row] = await db
    .select({
      id: aiKeys.id,
      name: aiKeys.name,
      provider: aiKeys.provider,
      hint: aiKeys.hint,
      createdAt: aiKeys.createdAt,
    })
    .from(aiKeys)
    .where(and(eq(aiKeys.id, id), eq(aiKeys.userId, userId)));

  return row ?? null;
}
