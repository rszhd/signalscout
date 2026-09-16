/**
 * The scheduler's entitlement gate, read from the subscriptions table.
 *
 * `worker/entitlement.ts` says what a gate promises. This is the one a
 * deployment that charges passes in: it asks Postgres which of the due
 * owners have a subscription row that says they may not poll, and hands back
 * the rest. No row means entitled, for `entitlement.ts`'s reason — a
 * self-hosted instance never writes here, and a hosted one has accounts older
 * than the table.
 *
 * `off` is `admitEveryone` itself, not a query that happens to admit
 * everyone. The self-hosted default must not read a table to decide nothing.
 */

import type { Database } from "@signalscout/pipeline";
import { admitEveryone, type EntitlementGate } from "@signalscout/pipeline";
import { and, inArray, not, sql } from "drizzle-orm";
import { subscriptions } from "../db/schema.js";
import { type BillingMode, entitledCondition } from "./entitlement.js";

export function subscriptionGate(db: Database, mode: BillingMode): EntitlementGate {
  if (mode === "off") return admitEveryone;

  return async (owners) => {
    if (owners.size === 0) return owners;

    const refused = await db
      .select({ userId: subscriptions.userId })
      .from(subscriptions)
      .where(
        and(
          inArray(subscriptions.userId, [...owners]),
          not(entitledCondition(sql`${subscriptions.status}`, sql`${subscriptions.trialEndsAt}`)),
        ),
      );

    const lapsed = new Set(refused.map((row) => row.userId));
    return new Set([...owners].filter((owner) => !lapsed.has(owner)));
  };
}
