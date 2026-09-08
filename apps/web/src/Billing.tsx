/**
 * The billing screen. US-072.
 *
 * One page, and most of it is Stripe's. Subscribing opens Stripe's hosted
 * Checkout; changing a card, reading an invoice and cancelling all open
 * Stripe's portal. This product builds none of those screens, so it cannot get
 * any of them wrong — and a card number never touches this application.
 *
 * The page reads one route, so nothing on it can disagree with anything else on
 * it. The same read decides the sentence at the top and which button is offered.
 */
import { useCallback, useEffect, useState } from "react";
import { messageFor, requestJson } from "./api.js";

export interface BillingState {
  mode: "off" | "stripe";
  entitled: boolean;
  reason: string;
  status: string | null;
  trialDaysLeft: number | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasBillingAccount: boolean;
  trialDays: number;
}

/** A date a person reads, or an empty string. */
function on(value: string | null): string {
  if (!value) return "";

  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * What this account is, in one sentence.
 *
 * Written from the reason rather than from the status, because the reason is
 * what the gate itself decided. A sentence derived from anything else can be
 * kind about an account the server is refusing.
 */
export function subscriptionSentence(state: BillingState): string {
  switch (state.reason) {
    case "trialing": {
      const days = state.trialDaysLeft ?? 0;
      const left = days === 1 ? "1 day" : `${days} days`;
      return `Your free trial has ${left} left. It ends on ${on(state.trialEndsAt)}.`;
    }
    case "trial_expired":
      return `Your free trial ended on ${on(state.trialEndsAt)}. Subscribe to start collecting again.`;
    case "subscribed":
      return state.cancelAtPeriodEnd
        ? `Your subscription ends on ${on(state.currentPeriodEnd)}. Until then everything keeps running.`
        : `You are subscribed. The next payment is on ${on(state.currentPeriodEnd)}.`;
    case "past_due":
      return "Your last payment did not go through. Your monitors are still running while Stripe retries the card.";
    case "canceled":
      return "Your subscription has ended. Subscribe to start collecting again.";
    case "incomplete":
      return "Your subscription is not finished. Complete the payment to start collecting.";
    default:
      return "This instance does not charge for itself.";
  }
}

export function Billing() {
  const [state, setState] = useState<BillingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await requestJson<BillingState>("/api/billing"));
    } catch (cause) {
      setError(messageFor(cause, "The billing details could not be read."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Leave for Stripe.
   *
   * The window is replaced rather than opened beside this one. Checkout is a
   * page a person finishes and comes back from, and a second tab leaves the
   * first one showing a trial that has just been paid for.
   */
  async function open(path: "checkout" | "portal"): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const { url } = await requestJson<{ url: string }>(`/api/billing/${path}`, {
        method: "POST",
      });
      globalThis.location.assign(url);
    } catch (cause) {
      setError(messageFor(cause, "Stripe could not be reached. Try again in a moment."));
      setBusy(false);
    }
  }

  if (state === null) {
    return (
      <div className="billing-page">
        <header className="topbar">
          <div>
            <h1>Billing</h1>
            <p className="page-subtitle">{error ?? "Reading your subscription…"}</p>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className="billing-page">
      <header className="topbar">
        <div>
          <h1>Billing</h1>
          <p className="page-subtitle">{subscriptionSentence(state)}</p>
        </div>
        {state.hasBillingAccount ? (
          <button
            className="primary-button"
            type="button"
            disabled={busy}
            onClick={() => void open("portal")}
          >
            Manage billing
          </button>
        ) : (
          <button
            className="primary-button"
            type="button"
            disabled={busy}
            onClick={() => void open("checkout")}
          >
            Subscribe
          </button>
        )}
      </header>

      {error && (
        <p className="billing-error" role="alert">
          {error}
        </p>
      )}

      <section className="billing-plan">
        <h2>SignalScout Cloud</h2>
        <p className="billing-price">
          <strong>$15</strong> <span>USD / month</span>
        </p>
        <ul className="billing-includes">
          <li>We run the application, the scheduler and the database.</li>
          <li>Automatic updates and backups.</li>
          <li>Your own social data and AI keys. Provider usage is billed by them, not by us.</li>
        </ul>
        {/*
          Said here rather than only on the landing page. Somebody reading this
          screen is deciding whether $15 is the whole cost, and it is not: the
          providers bill separately, and docs/costs.md is firm that our own
          figure for that is an estimate.
        */}
        <p className="billing-note">
          The subscription covers the hosting. What your monitors spend at the social data and model
          providers is billed by those providers, on your own keys.
        </p>
      </section>

      {state.hasBillingAccount && (
        <p className="billing-note">
          Cards, invoices and cancelling are on Stripe's own page. Nothing about a card is stored
          here.
        </p>
      )}
    </div>
  );
}
