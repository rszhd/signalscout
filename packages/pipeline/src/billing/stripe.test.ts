/**
 * Reading Stripe's objects. US-072.
 *
 * No test here reaches Stripe. What is asserted is the mapping — the part this
 * repository wrote — and two of the cases are about the API version rather than
 * about our own code:
 *
 * `current_period_end` has moved off the subscription and onto the subscription
 * item. Reading the old place returns undefined rather than an error, so the
 * fault would be a renewal date that is silently absent.
 *
 * And a status this application does not understand must not reach the column
 * that decides who may poll: `entitlementFor` refuses anything it does not know,
 * so an unmapped value arriving verbatim would lock a paying person out.
 */
import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import {
  periodEndOf,
  stateFromSubscription,
  statusFromStripe,
  stripeApiVersion,
  subscriptionIdOf,
} from "./stripe.js";

function subscription(overrides: Record<string, unknown> = {}): Stripe.Subscription {
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    cancel_at_period_end: false,
    trial_end: null,
    items: { data: [{ current_period_end: 1_791_000_000 }] },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

describe("Stripe's statuses, mapped onto ours", () => {
  it("keeps the four this application understands", () => {
    expect(statusFromStripe("trialing")).toBe("trialing");
    expect(statusFromStripe("active")).toBe("active");
    expect(statusFromStripe("past_due")).toBe("past_due");
    expect(statusFromStripe("incomplete")).toBe("incomplete");
  });

  it("turns every ending into `canceled`, because Stripe has stopped trying", () => {
    for (const status of ["canceled", "unpaid", "incomplete_expired", "paused"] as const) {
      expect(statusFromStripe(status)).toBe("canceled");
    }
  });
});

describe("reading a subscription", () => {
  it("takes the period end off the item, where this API version keeps it", () => {
    expect(periodEndOf(subscription())?.toISOString()).toBe("2026-10-03T04:00:00.000Z");
  });

  it("answers null rather than throwing when there are no items", () => {
    expect(periodEndOf(subscription({ items: { data: [] } }))).toBeNull();
  });

  it("reads the customer whether it is an id or an expanded object", () => {
    expect(stateFromSubscription(subscription())?.stripeCustomerId).toBe("cus_1");
    expect(
      stateFromSubscription(subscription({ customer: { id: "cus_2" } }))?.stripeCustomerId,
    ).toBe("cus_2");
  });

  it("answers null for a subscription with no customer, so nothing is written blind", () => {
    expect(stateFromSubscription(subscription({ customer: null }))).toBeNull();
  });

  it("carries Stripe's own trial deadline when Stripe is running one", () => {
    const state = stateFromSubscription(
      subscription({ status: "trialing", trial_end: 1_789_000_000 }),
    );

    expect(state?.status).toBe("trialing");
    expect(state?.trialEndsAt?.toISOString()).toBe("2026-09-10T00:26:40.000Z");
  });
});

describe("the subscription an invoice belongs to", () => {
  it("reads it off the invoice's parent", () => {
    const invoice = {
      parent: { subscription_details: { subscription: "sub_7" } },
    } as unknown as Stripe.Invoice;

    expect(subscriptionIdOf(invoice)).toBe("sub_7");
  });

  it("answers null for an invoice that is not a subscription's", () => {
    expect(subscriptionIdOf({ parent: null } as unknown as Stripe.Invoice)).toBeNull();
  });
});

describe("the API version", () => {
  it("is pinned, so a dashboard change cannot move the shapes above", () => {
    /**
     * An account's default version can be changed by somebody who is not
     * reading this file, and `current_period_end` moving is exactly what that
     * would look like: a null renewal date and no error anywhere.
     */
    expect(stripeApiVersion).toBe("2026-07-29.dahlia");
  });
});
