/**
 * Reading and writing the one `subscriptions` row an account has. US-072.
 *
 * Nothing here decides anything. The decision is `entitlementFor`, and keeping
 * it out of this file is what stops a second copy of the rule growing beside
 * the query that feeds it.
 */
import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { type SubscriptionStatus, subscriptions } from "../db/schema.js";
import {
  type BillingMode,
  type Entitlement,
  entitlementFor,
  type SubscriptionRecord,
  trialDays,
} from "./entitlement.js";

function toRecord(row: typeof subscriptions.$inferSelect): SubscriptionRecord {
  return {
    userId: row.userId,
    status: row.status as SubscriptionStatus,
    trialEndsAt: row.trialEndsAt,
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
  };
}

/** One account's subscription, or null when it has no row. */
export async function readSubscription(
  db: Database,
  userId: string,
): Promise<SubscriptionRecord | null> {
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  return row ? toRecord(row) : null;
}

/** The row a Stripe event belongs to, found by the customer it names. */
export async function subscriptionByCustomer(
  db: Database,
  stripeCustomerId: string,
): Promise<SubscriptionRecord | null> {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, stripeCustomerId));
  return row ? toRecord(row) : null;
}

export interface StartTrialOptions {
  /** Injected so a test can start a trial at a moment it chooses. */
  readonly now?: Date;
  readonly days?: number;
}

/**
 * Give a new account its seven days.
 *
 * Called from the sign-up hook, and it makes no network call: with no card
 * there is nothing for Stripe to hold, and registration must not be able to
 * fail because a payment provider is slow.
 *
 * **It never overwrites.** `onConflictDoNothing` is the whole guarantee: a
 * second call for the same account — a hook that runs twice, a re-registration
 * after a delete that left the row — must not hand somebody a fresh week or
 * push a paying subscription back into a trial.
 */
export async function startTrial(
  db: Database,
  userId: string,
  { now = new Date(), days = trialDays }: StartTrialOptions = {},
): Promise<SubscriptionRecord> {
  const trialEndsAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  await db
    .insert(subscriptions)
    .values({ userId, status: "trialing", trialEndsAt })
    .onConflictDoNothing();

  const record = await readSubscription(db, userId);
  // The insert either wrote the row or found one already there, so this cannot
  // be null. Throwing beats a non-null assertion that would be silently wrong.
  if (!record) throw new Error(`no subscription row for ${userId} after starting a trial`);
  return record;
}

/**
 * Remember which Stripe customer an account is, before sending it to Checkout.
 *
 * Written before the person leaves for Stripe rather than when they come back.
 * The webhook arrives keyed by the customer and by nothing else, and a payment
 * that succeeded against a customer this database has never heard of is a
 * person who paid and stayed locked out.
 */
export async function linkStripeCustomer(
  db: Database,
  userId: string,
  stripeCustomerId: string,
): Promise<void> {
  await db
    .insert(subscriptions)
    .values({ userId, status: "incomplete", stripeCustomerId })
    .onConflictDoUpdate({
      target: subscriptions.userId,
      set: { stripeCustomerId, updatedAt: new Date() },
    });
}

export interface StripeSubscriptionState {
  readonly stripeCustomerId: string;
  readonly stripeSubscriptionId: string;
  readonly status: SubscriptionStatus;
  readonly currentPeriodEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  /** Stripe's own trial deadline, when Stripe is running one. */
  readonly trialEndsAt: Date | null;
}

/**
 * Write what Stripe says about a subscription.
 *
 * Keyed by the customer, because that is what every webhook carries. A row that
 * cannot be found is not created here: the account is written when Checkout is
 * opened, and inventing one from an event would attach a paying customer to no
 * account at all. The caller says so in its log rather than guessing.
 *
 * The returned value says whether a row moved, so a webhook that names a
 * customer nobody here knows is visible rather than silent.
 */
export async function applyStripeSubscription(
  db: Database,
  state: StripeSubscriptionState,
): Promise<SubscriptionRecord | null> {
  const [row] = await db
    .update(subscriptions)
    .set({
      status: state.status,
      stripeSubscriptionId: state.stripeSubscriptionId,
      currentPeriodEnd: state.currentPeriodEnd,
      cancelAtPeriodEnd: state.cancelAtPeriodEnd,
      /**
       * A trial deadline is only ever written, never cleared. Our own seven
       * days are the record of what the account was given, and a Stripe
       * subscription with no trial must not erase them: the screen still says
       * when the free week ended.
       */
      ...(state.trialEndsAt ? { trialEndsAt: state.trialEndsAt } : {}),
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.stripeCustomerId, state.stripeCustomerId))
    .returning();

  return row ? toRecord(row) : null;
}

/** One account's entitlement, read and decided together. */
export async function readEntitlement(
  db: Database,
  userId: string,
  mode: BillingMode,
  now: Date = new Date(),
): Promise<Entitlement> {
  if (mode === "off") return entitlementFor({ mode, subscription: null, now });

  return entitlementFor({ mode, subscription: await readSubscription(db, userId), now });
}
