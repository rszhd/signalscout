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
import {
  Billing,
  type BillingState,
  priceLabel,
  subscriptionSentence,
  usageLabel,
} from "./Billing.js";
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
    price: { amount: 2000, currency: "usd", interval: "month" },
    // US-128's default, and it is the one every account had before the second
    // plan existed: the person brings their own keys.
    plan: "own_keys",
    included: null,
    ...overrides,
  };
}

/**
 * BUG-014. This screen said `$15` as a literal while Stripe charged $20, so a
 * person read one figure and Checkout asked for another.
 */
describe("the price on the screen", () => {
  it("formats what the provider states, and never a figure of its own", () => {
    expect(priceLabel({ amount: 2000, currency: "usd", interval: "month" })).toBe("$20");
    expect(priceLabel({ amount: 1500, currency: "usd", interval: "month" })).toBe("$15");
  });

  it("keeps the cents on a price that has them", () => {
    expect(priceLabel({ amount: 1999, currency: "usd", interval: "month" })).toBe("$19.99");
  });

  it("does not divide a currency that has no minor unit", () => {
    // 2000 JPY is ¥2,000, not ¥20. Dividing by a hundred everywhere would
    // under-quote this plan by two orders of magnitude.
    const yen = priceLabel({ amount: 2000, currency: "jpy", interval: "month" });

    expect(yen).toContain("2,000");
    expect(yen).not.toContain("20.00");
  });

  it("shows nothing when the provider could not be read", () => {
    expect(priceLabel(null)).toBe(null);
  });

  describe("on the screen itself", () => {
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

    it("puts the provider's amount on the screen and no literal", async () => {
      fetched.mockImplementation(async () =>
        json(state({ price: { amount: 4200, currency: "usd", interval: "month" } })),
      );

      screen = await mount(<Billing />);
      await settle();

      // 4200 rather than any number written in this repository. A literal
      // returning to the screen fails here whatever it says.
      expect(document.body.textContent).toContain("$42");
      expect(document.body.textContent).not.toContain("$15");
      expect(document.body.textContent).not.toContain("$20");
    });

    it("says pricing is shown at checkout when the price could not be read", async () => {
      fetched.mockImplementation(async () => json(state({ price: null })));

      screen = await mount(<Billing />);
      await settle();

      expect(document.body.textContent).toContain("Pricing is shown at checkout");
      // And the way out is still offered: an unreadable price is not a paywall.
      expect(button("Subscribe")).toBeTruthy();
    });

    it("shows a self-hosted instance zero and asks no provider", async () => {
      fetched.mockImplementation(async () => json(state({ mode: "off", price: null })));

      screen = await mount(<Billing />);
      await settle();

      expect(document.body.textContent).toContain("$0");
      expect(document.body.textContent).not.toContain("Pricing is shown at checkout");
    });
  });
});

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

/**
 * US-129. Four decimal places, for `budget/budget.ts`'s reason: ten Reddit
 * records cost $0.015, and a page that rounded that to two cents could not be
 * reconciled against anything.
 */
describe("the usage figure on the screen", () => {
  it("keeps four decimal places, and drops the zeros a whole figure does not need", () => {
    expect(usageLabel(15_000_000)).toBe("$15");
    expect(usageLabel(3_800)).toBe("$0.0038");
    expect(usageLabel(0)).toBe("$0");
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

  /** The capacity US-134 priced, as the route answers it. */
  const soldCapacity = {
    monitors: 1,
    projects: 1,
    queries: 6,
    queriesPerPlatform: { linkedin: 3 },
    platforms: ["reddit", "x", "linkedin", "youtube", "tiktok", "instagram"],
    pollIntervalSeconds: {
      reddit: 4 * 60 * 60,
      x: 4 * 60 * 60,
      youtube: 4 * 60 * 60,
      tiktok: 4 * 60 * 60,
      instagram: 12 * 60 * 60,
      linkedin: 24 * 60 * 60,
    },
    replies: false,
    paused: false,
  };

  /**
   * US-128 and US-133. The plan changes what the page claims, and the claim it
   * used to make is the one that matters twice over: a page telling an account
   * with no providers that its providers bill it directly is describing
   * somebody else's plan, and a page telling a paying account that its plan
   * includes $15 is printing our own fuse as their allowance.
   */
  it("tells a lent-keys account what its plan includes, in dials and not in dollars", async () => {
    fetched.mockImplementation(async () =>
      json(
        state({
          reason: "subscribed",
          status: "active",
          hasBillingAccount: true,
          plan: "keys_included",
          included: soldCapacity,
        }),
      ),
    );

    screen = await mount(<Billing />);
    await settle();

    const text = document.body.textContent ?? "";

    expect(text).toContain("1 monitor in 1 project");
    expect(text).toContain("6 searches in total");
    expect(text).toContain("At most 3 searches on LinkedIn");
    expect(text).toContain("LinkedIn checked once a day");
    expect(text).toContain("Instagram checked twice a day");
    expect(text).toContain("Posts, not comment threads");
    expect(text).toContain("Your provider usage is included");
    expect(text).not.toContain("Your provider usage is separate");

    // The fuse is the deployment's, and no figure from it reaches this page.
    expect(text).not.toContain("$15");
    expect(text).not.toContain("$25");
    expect(text.toLowerCase()).not.toContain("allowance");
  });

  it("says the month resets when the fuse blows, blames nobody and names no figure", async () => {
    fetched.mockImplementation(async () =>
      json(
        state({
          reason: "subscribed",
          status: "active",
          hasBillingAccount: true,
          plan: "keys_included",
          included: { ...soldCapacity, paused: true },
        }),
      ),
    );

    screen = await mount(<Billing />);
    await settle();

    const text = document.body.textContent ?? "";

    // Nobody raises this cap. A sentence inviting somebody to would send them
    // looking for a control that does not exist — and an account that reaches
    // it did nothing wrong, because it sits above what the plan sells.
    expect(text).toContain("Paused for this month");
    expect(text).toContain("start again when the month does");
    expect(text).toContain("nothing you set caused this");
    expect(text.toLowerCase()).not.toContain("raise");
  });

  it("shows no paused notice while the plan is running", async () => {
    fetched.mockImplementation(async () =>
      json(
        state({
          reason: "subscribed",
          status: "active",
          hasBillingAccount: true,
          plan: "keys_included",
          included: soldCapacity,
        }),
      ),
    );

    screen = await mount(<Billing />);
    await settle();

    expect(document.body.textContent ?? "").not.toContain("Paused for this month");
  });

  /**
   * The account that was here before the second plan, and every self-hosted
   * one. It meets no allowance, so the screen must show none: a figure there
   * would be a limit that does not apply.
   */
  it("shows no allowance to an account spending its own money", async () => {
    screen = await mount(<Billing />);
    await settle();

    const text = document.body.textContent ?? "";

    expect(text).not.toContain("Included usage");
    expect(text).toContain("Your provider usage is separate");
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

  it("returns an incomplete purchase to Checkout instead of the billing portal", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { assign, hash: "" });
    fetched.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return json({ url: "https://checkout.stripe.test/retry" });
      return json(
        state({
          entitled: false,
          reason: "incomplete",
          status: "incomplete",
          hasBillingAccount: true,
        }),
      );
    });

    screen = await mount(<Billing />);
    await settle();

    expect(button("Complete purchase")).toBeTruthy();
    expect(document.body.textContent).toContain("Return to Stripe");

    await act(async () => button("Complete purchase").click());
    await settle();

    expect(fetched).toHaveBeenCalledWith("/api/billing/checkout", {
      method: "POST",
    });
    expect(assign).toHaveBeenCalledWith("https://checkout.stripe.test/retry");
  });

  it("offers a new subscription after a previous subscription ended", async () => {
    fetched.mockResolvedValue(
      json(
        state({
          entitled: false,
          reason: "canceled",
          status: "canceled",
          hasBillingAccount: true,
        }),
      ),
    );

    screen = await mount(<Billing />);
    await settle();

    expect(button("Subscribe again")).toBeTruthy();
    expect(() => button("Manage billing")).toThrow();
  });

  it("retries a failed subscription read", async () => {
    fetched.mockResolvedValueOnce(json({ message: "Billing is unavailable." }, 502));
    screen = await mount(<Billing />);
    await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Billing is unavailable.",
    );

    await act(async () => button("Try again").click());
    await settle();

    expect(button("Subscribe")).toBeTruthy();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("does not offer a payment action when billing is off", async () => {
    fetched.mockResolvedValue(json(state({ mode: "off", reason: "billing_off" })));
    screen = await mount(<Billing />);
    await settle();

    expect(document.body.textContent).toContain("Self-hosted");
    expect(document.body.textContent).not.toContain("$15");
    expect(document.querySelector("button")).toBeNull();
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
