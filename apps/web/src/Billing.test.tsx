// @vitest-environment jsdom
/**
 * The billing screen, through the DOM. US-072.
 *
 * The claims worth asserting are the sentences. A person meeting a refused
 * button needs to read why, and "your trial ended" and "your card was declined"
 * send them to two different places — one to Checkout, one to Stripe's portal.
 * The wrong sentence is the whole failure of this screen.
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Billing, type BillingState, subscriptionSentence } from "./Billing.js";
import { button, json, mount, type Screen, settle } from "./testing.js";

function state(overrides: Partial<BillingState> = {}): BillingState {
  return {
    mode: "stripe",
    entitled: true,
    reason: "trialing",
    status: "trialing",
    trialDaysLeft: 7,
    trialEndsAt: "2026-09-15T00:00:00.000Z",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    hasBillingAccount: false,
    trialDays: 7,
    ...overrides,
  };
}

describe("the sentence this account gets", () => {
  it("counts a trial in days, and says one day rather than 1 days", () => {
    expect(subscriptionSentence(state({ trialDaysLeft: 3 }))).toContain("has 3 days left");
    expect(subscriptionSentence(state({ trialDaysLeft: 1 }))).toContain("has 1 day left");
  });

  it("tells an expired trial what to do next", () => {
    const sentence = subscriptionSentence(state({ reason: "trial_expired", entitled: false }));

    expect(sentence).toContain("ended");
    expect(sentence).toContain("Subscribe");
  });

  it("says a failing card is still running, because it is", () => {
    /**
     * The one judgement in the rule, said to the person it applies to. Their
     * monitors are still collecting while Stripe retries, and a sentence that
     * implied otherwise would have somebody re-entering a card in a panic.
     */
    const sentence = subscriptionSentence(state({ reason: "past_due" }));

    expect(sentence).toContain("did not go through");
    expect(sentence).toContain("still running");
  });

  it("says when a cancelled subscription actually stops", () => {
    const sentence = subscriptionSentence(
      state({
        reason: "subscribed",
        cancelAtPeriodEnd: true,
        currentPeriodEnd: "2026-10-08T00:00:00.000Z",
      }),
    );

    expect(sentence).toContain("ends on");
    expect(sentence).toContain("Until then everything keeps running");
  });
});

describe("the billing screen", () => {
  let screen: Screen;
  let fetched: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetched = vi.fn(async () => json(state()));
    vi.stubGlobal("fetch", fetched);
  });

  afterEach(async () => {
    await screen?.unmount();
    vi.unstubAllGlobals();
  });

  it("offers Subscribe to an account that has never paid", async () => {
    screen = await mount(<Billing />);
    await settle();

    expect(button("Subscribe")).toBeTruthy();
    expect(document.body.textContent).toContain("7 days left");
  });

  it("offers Stripe's own page once there is a customer", async () => {
    /**
     * Cards, invoices and cancelling are Stripe's screens. This product builds
     * none of them, so it cannot get any of them wrong, and no card number
     * reaches this application.
     */
    fetched.mockImplementation(async () =>
      json(state({ reason: "subscribed", status: "active", hasBillingAccount: true })),
    );

    screen = await mount(<Billing />);
    await settle();

    expect(button("Manage billing")).toBeTruthy();
  });

  it("sends a person to Stripe when they press Subscribe", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { assign, hash: "" });

    fetched.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return json({ url: "https://checkout.stripe.test/session" });
      return json(state());
    });

    screen = await mount(<Billing />);
    await settle();

    await act(async () => {
      button("Subscribe").click();
    });
    await settle();

    expect(assign).toHaveBeenCalledWith("https://checkout.stripe.test/session");
  });

  it("says so when Stripe cannot be reached, and stays usable", async () => {
    fetched.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return json({ message: "Stripe is unavailable." }, 502);
      return json(state());
    });

    screen = await mount(<Billing />);
    await settle();

    await act(async () => {
      button("Subscribe").click();
    });
    await settle();

    expect(document.body.textContent).toContain("Stripe is unavailable.");
    expect(button("Subscribe").disabled).toBe(false);
  });
});
