/**
 * What a deployment must set before it may charge. US-072.
 *
 * The case that matters is the third one. A missing key is not a broken
 * instance — it is an instance that runs the whole product and never asks
 * anybody for money, with every screen working. Nothing about that looks wrong
 * from the outside, which is why it is a refusal to boot rather than a warning.
 */
import { describe, expect, it } from "vitest";
import { billingSettingsFrom, requiredBillingVariables } from "./config.js";

const complete = {
  BILLING_MODE: "stripe" as const,
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_PRICE_ID: "price_x",
  STRIPE_WEBHOOK_SECRET: "whsec_x",
  APP_URL: "https://app.example.test",
};

describe("the billing settings", () => {
  it("asks nothing of a deployment that does not charge", () => {
    expect(billingSettingsFrom({})).toBeNull();
    expect(billingSettingsFrom({ BILLING_MODE: "off" })).toBeNull();
    // Even with everything else set. The mode is the switch, and a stray key in
    // an environment file must not turn a paywall on.
    expect(billingSettingsFrom({ ...complete, BILLING_MODE: "off" })).toBeNull();
  });

  it("reads a complete configuration", () => {
    expect(billingSettingsFrom(complete)).toEqual({
      mode: "stripe",
      apiKey: "sk_test_x",
      priceId: "price_x",
      webhookSecret: "whsec_x",
      appUrl: "https://app.example.test",
    });
  });

  it("refuses to start when any one of them is missing, and names it", () => {
    for (const name of requiredBillingVariables) {
      const broken = { ...complete, [name]: undefined };

      expect(() => billingSettingsFrom(broken), `${name} missing should refuse`).toThrow(name);
    }
  });

  it("names every missing variable at once, not one per restart", () => {
    const thrown = (() => {
      try {
        billingSettingsFrom({ BILLING_MODE: "stripe" });
        return "";
      } catch (error) {
        return String(error);
      }
    })();

    for (const name of requiredBillingVariables) expect(thrown).toContain(name);
  });

  it("trims a trailing slash off the return address", () => {
    // Otherwise every URL sent to Stripe carries a double slash, which works
    // and looks like a mistake in a person's address bar at the moment they
    // are deciding whether to type a card number.
    expect(billingSettingsFrom({ ...complete, APP_URL: "https://app.example.test/" })?.appUrl).toBe(
      "https://app.example.test",
    );
  });
});
