/**
 * The per-account webhook signing secret. US-096.
 *
 * Correctness-critical, and the failure shape is one customer signing a payload
 * another customer's receiver accepts as genuine. That was the state of the
 * product before this: `WEBHOOK_SIGNING_SECRET` was one value for the instance,
 * and the contract hands that value to every customer to verify with.
 *
 * So the case that matters most is the one at the bottom — two accounts, two
 * secrets, and neither verifying the other's.
 */
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { webhookSecrets } from "../db/schema.js";
import { generateEncryptionKey, readEncryptionKey } from "../secrets/cipher.js";
import { rotateEncryptionKey } from "../secrets/store.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import {
  deleteAccountWebhookSecret,
  generateAccountWebhookSecret,
  generateWebhookSecret,
  readWebhookSecretHint,
  webhookSecretFor,
  webhookSecretRecordName,
} from "./secret.js";

let database: TestDatabase;
let db: Database;
let close: () => Promise<void>;

const key = readEncryptionKey(generateEncryptionKey());

beforeAll(async () => {
  database = await createTestDatabase("webhook_secret");
  ({ db, close } = createDatabase(database.url));
}, 60_000);

afterAll(async () => {
  await close?.();
  await database?.drop();
});

beforeEach(async () => {
  await db.delete(webhookSecrets);
});

describe("generating a secret", () => {
  it("is 32 bytes of hex, which is what the documented command produces", () => {
    // docs/notifications.md tells a self-hoster `openssl rand -hex 32`, so the
    // two halves of one instance cannot disagree about what a secret looks
    // like, and WEBHOOK_SIGNING_SECRET's own 32-character minimum is cleared.
    const secret = generateWebhookSecret();

    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(generateWebhookSecret()).not.toBe(secret);
  });

  it("returns the value once and stores only a masked hint beside it", async () => {
    const secret = await generateAccountWebhookSecret(db, key, "account-a");
    const [row] = await db.select().from(webhookSecrets);

    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.hint).toBe(`••••${secret.slice(-4)}`);
    // The plaintext is nowhere in the row.
    expect(JSON.stringify(row)).not.toContain(secret);
  });

  it("refuses a row moved to another account, record column and all", async () => {
    /**
     * `credentialRecordName`'s rule, made real. The record is **derived from
     * the account asked about**, not read from the row — so copying the row
     * wholesale into another account's slot, which is what anybody with `psql`
     * would do, does not hand them the secret. `readSourceCredential` trusts
     * the stored column instead, and its own comment says why it has to: that
     * table has rows written under an older name and this one does not.
     */
    await generateAccountWebhookSecret(db, key, "account-a");
    const [row] = await db.select().from(webhookSecrets);

    expect(row?.record).toBe(webhookSecretRecordName("account-a"));

    await db.delete(webhookSecrets);
    await db
      .insert(webhookSecrets)
      .values({ ...(row as typeof webhookSecrets.$inferInsert), userId: "account-b" });

    await expect(webhookSecretFor(db, "account-b", key, undefined)).rejects.toThrow();
  });

  it("replaces rather than refusing, because regenerating is the repair", async () => {
    // A leaked secret is fixed by making a new one. A repair that needs a
    // delete first is a repair somebody abandons half way.
    const first = await generateAccountWebhookSecret(db, key, "account-a");
    const second = await generateAccountWebhookSecret(db, key, "account-a");

    expect(second).not.toBe(first);
    expect(await db.select().from(webhookSecrets)).toHaveLength(1);
    // And the old one no longer signs anything, which is the point.
    expect(await webhookSecretFor(db, "account-a", key, undefined)).toBe(second);
  });
});

describe("which secret signs a delivery", () => {
  it("prefers the account's own over the instance's", async () => {
    const mine = await generateAccountWebhookSecret(db, key, "account-a");

    expect(await webhookSecretFor(db, "account-a", key, "the-instance-secret")).toBe(mine);
  });

  it("falls back to the instance's for an account with none", async () => {
    // The self-hosted path, unchanged: somebody set the variable and configured
    // a receiver against it, and an upgrade must not invalidate that.
    expect(await webhookSecretFor(db, "account-a", key, "the-instance-secret")).toBe(
      "the-instance-secret",
    );
  });

  it("answers null when neither exists, so the transport refuses", async () => {
    expect(await webhookSecretFor(db, "account-a", key, undefined)).toBeNull();
  });

  it("reads the environment when the instance cannot decrypt anything", async () => {
    // No ENCRYPTION_KEY. A stored row cannot be opened, so the environment is
    // the only answer — the same branch the connections screen already shows.
    await generateAccountWebhookSecret(db, key, "account-a");

    expect(await webhookSecretFor(db, "account-a", undefined, "the-instance-secret")).toBe(
      "the-instance-secret",
    );
  });

  it("goes back to the instance's secret when the account gives its own up", async () => {
    await generateAccountWebhookSecret(db, key, "account-a");
    await deleteAccountWebhookSecret(db, "account-a");

    expect(await readWebhookSecretHint(db, "account-a")).toBeNull();
    expect(await webhookSecretFor(db, "account-a", key, "the-instance-secret")).toBe(
      "the-instance-secret",
    );
  });

  it("gives two accounts two secrets, and neither verifies the other", async () => {
    /**
     * The money case, and the reason this table exists. Before US-096 both of
     * these would have been the one instance secret, so an account could sign a
     * payload the other's receiver accepted as genuine — and the receiver had
     * no way to tell.
     */
    const a = await generateAccountWebhookSecret(db, key, "account-a");
    const b = await generateAccountWebhookSecret(db, key, "account-b");

    expect(a).not.toBe(b);

    const body = '1788566400.{"version":1}';
    const signedByA = createHmac("sha256", a).update(body).digest("hex");
    const verifiedByB = createHmac("sha256", b).update(body).digest("hex");

    expect(signedByA).not.toBe(verifiedByB);
    expect(await webhookSecretFor(db, "account-a", key, undefined)).toBe(a);
    expect(await webhookSecretFor(db, "account-b", key, undefined)).toBe(b);
  });
});

describe("rotating the encryption key", () => {
  it("re-encrypts the signing secrets too", async () => {
    /**
     * US-079 found that `db:rotate-key` had never touched `ai_keys`: it
     * reported success and then failed every model call once the old key was
     * thrown away. A secret missed here is quieter and worse — every webhook
     * for that account fails, and it reads as the receiver being down.
     */
    const secret = await generateAccountWebhookSecret(db, key, "account-a");
    const next = readEncryptionKey(generateEncryptionKey());

    const moved = await rotateEncryptionKey(db, key, next);

    expect(moved).toBe(1);
    expect(await webhookSecretFor(db, "account-a", next, undefined)).toBe(secret);
  });
});
