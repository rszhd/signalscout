/**
 * Whether an account may write and whether its monitors may poll. US-072.
 *
 * Correctness-critical, and the failure shape is quiet in both directions. Too
 * strict and a paying person's monitors stop for a bug nobody can see from a
 * screen. Too loose and an account that cancelled in March is still polling in
 * June, on our hosting, on our database, and the only thing that would notice
 * is an invoice.
 *
 * **One rule, stated twice, in one file.** `entitlementFor` answers about a row
 * already read; `entitledCondition` answers inside the scheduler's query, where
 * a row per monitor cannot be read into TypeScript first. They are next to each
 * other so that changing one without the other is a thing you have to do on
 * purpose, and `entitlement.test.ts` drives both over the same cases against
 * real Postgres.
 *
 * **No row means entitled.** That reads backwards until you count the two ways
 * it happens. A self-hosted instance never writes here at all. A hosted one has
 * accounts older than this table — the owner's own among them. Neither is a
 * person who stopped paying, and a migration that silently locked the owner out
 * of the instance that runs the product is not a state anybody should be able to
 * reach.
 *
 * **`billing_off` short-circuits everything.** The default deployment is
 * self-hosted, it has no Stripe and no trial, and nothing here may make it
 * behave differently from the way it behaved before this file existed.
 */
import { type SQL, sql } from "drizzle-orm";
import type { SubscriptionStatus } from "../db/schema.js";

/**
 * Whether this deployment charges for itself.
 *
 * `off` is the default and it is the self-hosted shape: no trial, no gate, no
 * payment provider. `stripe` is the hosted shape. The default is off rather
 * than on for `AUTH_SIGNUP`'s reason — every instance running today is
 * self-hosted, and a version bump that quietly began refusing writes on
 * somebody's own machine would arrive as a release note nobody read.
 *
 * There is no `manual` value, and that is on purpose. "Somebody in the database
 * sets this account to active" is a thing `psql` already does to the status
 * column, and giving it a mode would make the gate depend on a setting that
 * says nothing about who pays.
 */
export const billingModes = ["off", "stripe"] as const;
export type BillingMode = (typeof billingModes)[number];

/**
 * How long the free trial runs, and it asks for no card.
 *
 * Seven days is the number on the landing page, so it lives here as one
 * constant that the sign-up hook, the screen and the documentation all read.
 * A trial length that is written down in three places is a trial length that
 * will be three different numbers.
 */
export const trialDays = 7;

/** A `subscriptions` row, as everything downstream of the database sees it. */
export interface SubscriptionRecord {
  readonly userId: string;
  readonly status: SubscriptionStatus;
  readonly trialEndsAt: Date | null;
  readonly stripeCustomerId: string | null;
  readonly stripeSubscriptionId: string | null;
  readonly currentPeriodEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
}

/**
 * Why the answer is what it is.
 *
 * A boolean alone would make every screen invent its own sentence, and the
 * sentence is the whole product here: "your trial ended" and "your card was
 * declined" send a person to two different places.
 */
export type EntitlementReason =
  | "billing_off"
  | "no_record"
  | "trialing"
  | "subscribed"
  | "past_due"
  | "trial_expired"
  | "canceled"
  | "incomplete";

export interface Entitlement {
  readonly entitled: boolean;
  readonly reason: EntitlementReason;
  /**
   * Whole days left of the trial, rounded up, or null when there is no trial
   * running. Rounded up because a person with four hours left has a day left,
   * not zero, and zero would read as expired on a screen that still works.
   */
  readonly trialDaysLeft: number | null;
}

export interface EntitlementInput {
  readonly mode: BillingMode;
  /** Null when the account has no row. See the header: that means entitled. */
  readonly subscription: SubscriptionRecord | null;
  /** Injected rather than read, so a test can stand on either side of a deadline. */
  readonly now: Date;
}

const millisecondsPerDay = 24 * 60 * 60 * 1000;

/** Whole days from `now` to `deadline`, rounded up, never below zero. */
export function daysUntil(deadline: Date, now: Date): number {
  return Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / millisecondsPerDay));
}

/**
 * The rule.
 *
 * `past_due` is entitled and that is the one judgement in it. A card that
 * failed this morning is a person Stripe is still retrying, and stopping their
 * monitors before the retries finish throws away collection they paid for. The
 * subscription reaches `canceled` when Stripe gives up, and that is the line.
 */
export function entitlementFor({ mode, subscription, now }: EntitlementInput): Entitlement {
  if (mode === "off") return { entitled: true, reason: "billing_off", trialDaysLeft: null };
  if (!subscription) return { entitled: true, reason: "no_record", trialDaysLeft: null };

  switch (subscription.status) {
    case "active":
      return { entitled: true, reason: "subscribed", trialDaysLeft: null };
    case "past_due":
      return { entitled: true, reason: "past_due", trialDaysLeft: null };
    case "trialing": {
      // The check constraint makes this non-null for a trialing row. A null
      // here would be a row written around the database, and an open-ended
      // trial is the one thing a trial must never be.
      const endsAt = subscription.trialEndsAt;
      if (!endsAt) return { entitled: false, reason: "trial_expired", trialDaysLeft: 0 };

      return endsAt.getTime() > now.getTime()
        ? { entitled: true, reason: "trialing", trialDaysLeft: daysUntil(endsAt, now) }
        : { entitled: false, reason: "trial_expired", trialDaysLeft: 0 };
    }
    case "incomplete":
      return { entitled: false, reason: "incomplete", trialDaysLeft: null };
    default:
      return { entitled: false, reason: "canceled", trialDaysLeft: null };
  }
}

/**
 * The same rule, for a query that cannot read the row first.
 *
 * The scheduler asks Postgres which monitors are due, across every account on
 * the instance, and filtering afterwards in TypeScript would mean reading every
 * monitor on the instance to throw most of them away. So the rule is expressed
 * once more here, over a `subscriptions` row left-joined onto the monitor's
 * owner, and `entitlement.test.ts` proves the two forms agree.
 *
 * `now()` is Postgres's clock, for `findDueMonitors`'s own reason: two workers
 * with two slightly wrong clocks must not disagree about whether a trial has
 * ended.
 */
export function entitledCondition(status: SQL, trialEndsAt: SQL): SQL {
  return sql`(
    ${status} is null
    or ${status} in ('active', 'past_due')
    or (${status} = 'trialing' and ${trialEndsAt} > now())
  )`;
}
