/**
 * Whether an account has finished setting up. US-105.
 *
 * Correctness-critical: the setup gate. The failure shape is an existing
 * account sent back to the onboarding page after it removes its last key,
 * because the product forgot it was ever configured.
 *
 * **A row means complete, and its absence is the only new account there is.**
 * The write is `markOnboardingComplete`, an idempotent insert, and the read is
 * `hasCompletedOnboarding`. Nothing deletes a row, and that is deliberate:
 * removing a key must not remove the fact that the account was set up.
 *
 * US-088 derived setup from the keys alone and argued against a flag. This is
 * that decision reversed, and `db/schema.ts` carries the reasoning.
 */
import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { userOnboarding } from "../db/schema.js";

/**
 * Remember that this account has finished setting up.
 *
 * Idempotent, so the caller can ask on every load without checking first. A
 * second call is a no-op, not an error: two tabs can finish setup together.
 */
export async function markOnboardingComplete(db: Database, userId: string): Promise<void> {
  await db.insert(userOnboarding).values({ userId }).onConflictDoNothing();
}

/** Whether this account has ever finished setting up. */
export async function hasCompletedOnboarding(db: Database, userId: string): Promise<boolean> {
  const rows = await db
    .select({ userId: userOnboarding.userId })
    .from(userOnboarding)
    .where(eq(userOnboarding.userId, userId))
    .limit(1);

  return rows.length > 0;
}
