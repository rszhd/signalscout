/**
 * Whether a monitor belongs to an account. US-336.
 *
 * The `…Owned…` functions ask this before they read or write a row keyed by a
 * monitor id, so a route can call none of them without naming the account.
 * Each answers for a monitor the account does not own what its unchecked twin
 * answers for an id that does not exist.
 *
 * A file of its own because the budget and the notification settings both
 * need it, and `monitors.ts` already imports the second.
 */
import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { monitors } from "../db/schema.js";

export async function ownsMonitor(
  db: Database,
  userId: string,
  monitorId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: monitors.id })
    .from(monitors)
    .where(and(eq(monitors.id, monitorId), eq(monitors.userId, userId)))
    .limit(1);

  return row !== undefined;
}
