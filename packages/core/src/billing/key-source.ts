/**
 * Whose keys one account runs on, read and written. US-141.
 *
 * Correctness-critical: plan. The failure shape is an account polling and
 * classifying on this instance's keys when it was never meant to.
 *
 * **It replaces `subscriptions.plan` as the thing that decides.** US-128 keyed
 * this to the Stripe price, and US-141 undid that: there is one price, and a
 * price cannot express a choice somebody changes at three o'clock. A webhook is
 * not how a key starts being used.
 *
 * **One state, never a mix.** An account runs on its own keys or on this
 * instance's. A platform it holds no key for does not run rather than falling
 * back to ours — `startBlockers` is what says which key, on the form, before a
 * monitor starts.
 *
 * No row means this instance's keys. That is what a new account gets, what
 * every account had before this existed, and what a self-hosted instance is.
 */
import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { accountKeySource, type KeySource } from "../db/schema.js";

/** What an account with no row of its own runs on. */
export const defaultKeySource: KeySource = "instance";

export async function readKeySource(
  /**
   * A transaction is as good as a pool here, and both ledger writers call this
   * with whatever they were handed. Narrowed to the one method it uses so a
   * caller inside a transaction does not have to widen its own type.
   */
  db: Pick<Database, "select">,
  userId: string,
): Promise<KeySource> {
  const [row] = await db
    .select({ source: accountKeySource.source })
    .from(accountKeySource)
    .where(eq(accountKeySource.userId, userId));

  return row?.source ?? defaultKeySource;
}

/**
 * Move an account onto its own keys, or back onto this instance's.
 *
 * It takes effect on the next poll and the next request, because every reader
 * asks per job and per request rather than at boot — the same rule
 * `readPlan` followed and for the same reason. Nothing is deleted either way:
 * an account that moves back to ours keeps the keys it stored, and moving
 * again uses them.
 */
export async function setKeySource(db: Database, userId: string, source: KeySource): Promise<void> {
  await db
    .insert(accountKeySource)
    .values({ userId, source, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: accountKeySource.userId,
      set: { source, updatedAt: new Date() },
    });
}

/**
 * Which of these accounts run on this instance's keys, in one read.
 *
 * For the scheduler, which holds a list of owners and must not read a row per
 * monitor to find out whose money a poll would spend. The same shape
 * `keysIncludedAmong` had, and it replaces it.
 */
export async function onInstanceKeysAmong(
  db: Database,
  userIds: readonly string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];

  const rows = await db
    .select({ userId: accountKeySource.userId, source: accountKeySource.source })
    .from(accountKeySource);

  // A row saying `own` is the only thing that takes an account off ours, so
  // the answer is every id asked about minus those.
  const onOwn = new Set(rows.filter((row) => row.source === "own").map((row) => row.userId));

  return userIds.filter((userId) => !onOwn.has(userId));
}
