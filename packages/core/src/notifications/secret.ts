/**
 * The secret an account's webhook deliveries are signed with. US-096.
 *
 * Correctness-critical. The failure shape is one customer signing a payload
 * that another customer's receiver accepts as genuine — which is what a single
 * `WEBHOOK_SIGNING_SECRET` shared by every account on a hosted instance makes
 * possible, because the contract hands that value to each of them to verify
 * with.
 *
 * **We generate it, which is what makes this simpler than every other secret
 * here.** `source_credentials` and `ai_keys` hold what somebody typed, so both
 * probe a provider before storing. Nothing to probe here: a random 32 bytes is
 * valid by construction. It is still encrypted, because a leaked database would
 * otherwise let anybody forge a delivery to a customer's receiver.
 *
 * **An account with no row falls back to the environment**, and that is the
 * rule that keeps every self-hosted instance working unchanged. A person there
 * set `WEBHOOK_SIGNING_SECRET` and configured a receiver against it, and an
 * upgrade that invalidated it would break working deliveries with nothing on
 * screen to say why.
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { webhookSecrets } from "../db/schema.js";
import { decryptSecret, type EncryptionKey, encryptSecret, maskSecret } from "../secrets/cipher.js";

/**
 * 32 bytes as hex, which is 64 characters.
 *
 * The same size docs/notifications.md tells a self-hoster to generate with
 * `openssl rand -hex 32`, so the two halves of one instance cannot disagree
 * about what a secret looks like, and `WEBHOOK_SIGNING_SECRET`'s own minimum of
 * 32 characters is comfortably cleared.
 */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * What the ciphertext is authenticated with.
 *
 * The owner is in the name for `credentialRecordName`'s reason: without it a
 * row moved between two accounts by anybody with `psql` would decrypt happily,
 * and the primary key alone does not stop that. Here that would hand one
 * account another's signing secret, which is the whole thing this table exists
 * to prevent.
 */
export function webhookSecretRecordName(userId: string): string {
  return `${userId}:webhook:signingSecret`;
}

export interface WebhookSecretHint {
  readonly hint: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Make a secret for this account, replacing any it already had.
 *
 * Returns the plaintext, because this is the **one** moment it can be shown.
 * Nothing reads it back out to a screen afterwards: a secret a page will
 * re-display is a secret that leaks with a screenshot, and regenerating costs
 * one visit to the receiver's settings.
 *
 * Replacing rather than refusing is deliberate. Regeneration is the repair for
 * a leaked secret, and a repair that needs a delete first is a repair somebody
 * abandons half way.
 */
export async function generateAccountWebhookSecret(
  db: Database,
  key: EncryptionKey,
  userId: string,
): Promise<string> {
  const secret = generateWebhookSecret();
  const record = webhookSecretRecordName(userId);

  const row = {
    userId,
    record,
    ciphertext: encryptSecret(key, secret, record),
    hint: maskSecret(secret),
    updatedAt: new Date(),
  };

  await db
    .insert(webhookSecrets)
    .values(row)
    .onConflictDoUpdate({
      target: webhookSecrets.userId,
      // The old ciphertext is overwritten and never kept beside the new one. A
      // second row would leave the replaced secret verifying, which is exactly
      // what regenerating after a leak is meant to stop.
      set: {
        ciphertext: row.ciphertext,
        record: row.record,
        hint: row.hint,
        updatedAt: row.updatedAt,
      },
    });

  return secret;
}

/**
 * Whether this account has a secret, and what it looks like — without
 * decrypting one.
 *
 * The screen needs to say "a secret is set, ending 1234" and needs no key to do
 * it, which is `listCredentialHints`' rule and the reason `hint` is a column.
 */
export async function readWebhookSecretHint(
  db: Database,
  userId: string,
): Promise<WebhookSecretHint | null> {
  const [row] = await db
    .select({
      hint: webhookSecrets.hint,
      createdAt: webhookSecrets.createdAt,
      updatedAt: webhookSecrets.updatedAt,
    })
    .from(webhookSecrets)
    .where(eq(webhookSecrets.userId, userId));

  return row ?? null;
}

/**
 * The secret a delivery for this account is signed with.
 *
 * The account's own row wins; the environment answers when it has none. Null
 * means neither, which is the state the transport already knows how to refuse.
 *
 * `key` is undefined on an instance with no `ENCRYPTION_KEY`. A stored row
 * cannot be opened there, so the environment is the only answer — which is the
 * same branch the connections screen already shows.
 */
export async function webhookSecretFor(
  db: Database,
  userId: string,
  key: EncryptionKey | undefined,
  environmentSecret: string | undefined,
): Promise<string | null> {
  if (key) {
    const [row] = await db
      .select({ ciphertext: webhookSecrets.ciphertext })
      .from(webhookSecrets)
      .where(eq(webhookSecrets.userId, userId));

    /**
     * **The record is derived from the account asked about, not read from the
     * row.** `readSourceCredential` does the opposite, and its comment says
     * why: US-024 renamed what that table is keyed by, so a derived name would
     * refuse to open a key that works. This table is new and every row was
     * written under the derived name, so there is no such history — and
     * deriving is what makes the defence real. A row moved to another account
     * with `psql` carries its `record` column along, so a reader that trusted
     * that column would decrypt it happily and hand one account another's
     * signing secret.
     *
     * A row that will not decrypt throws rather than falling back. Signing with
     * the instance's secret instead would send a delivery the account's own
     * receiver cannot verify, and the failure would read as the receiver being
     * broken.
     */
    if (row) return decryptSecret(key, row.ciphertext, webhookSecretRecordName(userId));
  }

  return environmentSecret ?? null;
}

/** Delete this account's secret, so it signs with the environment again. */
export async function deleteAccountWebhookSecret(db: Database, userId: string): Promise<void> {
  await db.delete(webhookSecrets).where(eq(webhookSecrets.userId, userId));
}
