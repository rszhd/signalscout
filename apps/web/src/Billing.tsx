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
import { Link, useSearchParams } from "react-router";
import { messageFor, requestJson } from "./api.js";
import { paths } from "./route.js";

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
  /** What Stripe charges, or null when it could not be read. BUG-014. */
  price: { amount: number; currency: string; interval: string | null } | null;
}

/**
 * The price, as the provider states it.
 *
 * `amount` is the currency's minor unit and is handed to the formatter rather
 * than divided by a hundred here: JPY and KRW have no minor unit, and
 * `Intl.NumberFormat` knows which currencies those are.
 *
 * This screen said `$15` as a literal until BUG-014. The literal was right the
 * day it was written and became wrong when the cloud price was set to $20,
 * with nothing anywhere to notice — so the figure comes from Stripe now, and
 * when Stripe cannot be reached the screen shows no figure rather than one
 * this product guessed.
 */
export function priceLabel(price: BillingState["price"]): string | null {
  if (!price) return null;

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: price.currency.toUpperCase(),
    // A whole-dollar plan reads as "$20", not "$20.00"; a price with cents in
    // it keeps them.
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(price.amount / 10 ** currencyExponent(price.currency));
}

/**
 * How many minor units make one unit of this currency.
 *
 * Stripe's zero-decimal list is what this encodes. It is a list rather than a
 * lookup because there is no such thing in the browser: `Intl` will format a
 * number correctly once it is scaled, but it cannot tell us the scale.
 */
function currencyExponent(currency: string): number {
  const zeroDecimal = new Set([
    "bif",
    "clp",
    "djf",
    "gnf",
    "jpy",
    "kmf",
    "krw",
    "mga",
    "pyg",
    "rwf",
    "ugx",
    "vnd",
    "vuv",
    "xaf",
    "xof",
    "xpf",
  ]);

  return zeroDecimal.has(currency.toLowerCase()) ? 0 : 2;
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
  /**
   * Where Stripe sends a person back to. US-076.
   *
   * Checkout returns to `/billing?checkout=done`, which is a real address now
   * rather than a path and a hash saying the same thing twice. The parameter
   * is read once and then removed, because it describes one arrival: a reload
   * or a bookmark of the same address would otherwise announce a payment that
   * happened last week.
   */
  const [search, setSearch] = useSearchParams();
  const [arrival] = useState(() => search.get("checkout"));

  useEffect(() => {
    if (search.has("checkout")) {
      const rest = new URLSearchParams(search);
      rest.delete("checkout");
      setSearch(rest, { replace: true });
    }
  }, [search, setSearch]);

  const [state, setState] = useState<BillingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
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

  const statusLabel =
    state?.mode === "off"
      ? "Self-hosted"
      : ({
          trialing: "Free trial",
          trial_expired: "Trial ended",
          subscribed: state?.cancelAtPeriodEnd ? "Cancels at period end" : "Active subscription",
          past_due: "Payment needs attention",
          canceled: "Subscription ended",
          incomplete: "Payment incomplete",
        }[state?.reason ?? ""] ?? "Subscription");

  /**
   * A Stripe customer is not the same thing as a working subscription.
   *
   * The customer is stored before Checkout opens, so an abandoned or failed
   * first purchase already has `hasBillingAccount: true`. The portal can
   * manage a subscription that exists; it cannot replace the missing purchase
   * flow for an incomplete one. Stripe recommends a new Checkout Session for
   * each payment attempt, so every state that still needs a subscription goes
   * back through Checkout.
   */
  const canManageSubscription =
    state?.hasBillingAccount === true &&
    (state.reason === "subscribed" || state.reason === "past_due");
  const actionPath = canManageSubscription ? "portal" : "checkout";
  const actionLabel =
    state?.reason === "incomplete"
      ? "Complete purchase"
      : state?.reason === "canceled"
        ? "Subscribe again"
        : "Subscribe";

  return (
    <div className="billing-page">
      <header className="topbar">
        <div>
          <h1>Billing</h1>
          <p className="page-subtitle">Your plan, subscription and what's included.</p>
        </div>
      </header>

      <div className="billing-content">
        {/*
          Stripe's own answer is the webhook, not this parameter, so the
          sentence says what happened rather than what the account now is —
          the subscription below is read from our own database either way.
        */}
        {arrival === "done" && (
          <p className="billing-arrival" role="status">
            Thank you. Stripe has taken your payment. Your subscription is shown below.
          </p>
        )}
        {arrival === "cancelled" && (
          <p className="billing-arrival" role="status">
            You left Stripe without paying. Nothing was charged.
          </p>
        )}
        {state === null ? (
          <section className="billing-loading" aria-live="polite">
            {error ? (
              <>
                <h2>Billing details are unavailable</h2>
                <p role="alert">{error}</p>
                <button className="secondary-button" type="button" onClick={() => void load()}>
                  Try again
                </button>
              </>
            ) : (
              <p role="status">Reading your subscription…</p>
            )}
          </section>
        ) : (
          <>
            <div className="billing-overview">
              <section className="billing-plan" aria-labelledby="billing-plan-title">
                <p className="billing-eyebrow">
                  {state.mode === "off" ? "Your deployment" : "Your cloud plan"}
                </p>
                <h2 id="billing-plan-title">
                  SignalScout {state.mode === "off" ? "Self-hosted" : "Cloud"}
                </h2>
                <p className="billing-plan-intro">
                  {state.mode === "off"
                    ? "Your infrastructure. Your keys. Your data."
                    : "You find the conversations. We keep it running."}
                </p>
                <p className="billing-price">
                  {state.mode === "off" ? (
                    <>
                      <strong>$0</strong>
                      <span>USD / month</span>
                    </>
                  ) : priceLabel(state.price) ? (
                    <>
                      <strong>{priceLabel(state.price)}</strong>
                      <span>
                        {state.price?.currency.toUpperCase()}
                        {state.price?.interval ? ` / ${state.price.interval}` : ""}
                      </span>
                    </>
                  ) : (
                    // Stripe could not be reached. Checkout states the real
                    // terms on the next page, so the button still works and
                    // this product invents no figure.
                    <span>Pricing is shown at checkout.</span>
                  )}
                </p>
                <p className="billing-price-note">
                  {state.mode === "off"
                    ? "No application subscription."
                    : "Hosting included. Provider usage billed separately."}
                </p>
                <div className="billing-features">
                  <h3>
                    {state.mode === "off"
                      ? "Included in the application"
                      : "We take care of the hosting"}
                  </h3>
                  <ul className="billing-includes">
                    {(state.mode === "off"
                      ? [
                          "The full SignalScout application",
                          "Scheduled monitoring and your intent inbox",
                          "Your own social data and AI connections",
                        ]
                      : [
                          "Hosted application and database",
                          "Managed scheduler for your monitors",
                          "Automatic updates and backups",
                        ]
                    ).map((feature) => (
                      <li key={feature}>
                        <span aria-hidden="true">✓</span>
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>
              </section>

              <section className="billing-account" aria-labelledby="billing-account-title">
                <div className="billing-account-heading">
                  <h2 id="billing-account-title">Subscription</h2>
                  <span
                    className={`billing-status${!state.entitled || state.reason === "past_due" ? " billing-status-warning" : ""}`}
                  >
                    {statusLabel}
                  </span>
                </div>
                <p className="billing-account-description">{subscriptionSentence(state)}</p>
                {state.reason === "trialing" && state.trialDays > 0 && (
                  <div className="billing-trial">
                    <div>
                      <span>Free trial</span>
                      <strong>
                        {state.trialDaysLeft ?? 0} of {state.trialDays} days left
                      </strong>
                    </div>
                    <progress
                      aria-label="Free trial days remaining"
                      max={state.trialDays}
                      value={Math.max(0, Math.min(state.trialDays, state.trialDaysLeft ?? 0))}
                    />
                  </div>
                )}
                {state.mode === "stripe" && (
                  <div className="billing-action">
                    {error && (
                      <p className="billing-error" role="alert">
                        {error}
                      </p>
                    )}
                    <button
                      className="primary-button"
                      type="button"
                      disabled={busy}
                      onClick={() => void open(actionPath)}
                    >
                      {busy
                        ? "Opening Stripe…"
                        : canManageSubscription
                          ? "Manage billing"
                          : actionLabel}
                    </button>
                    <p>
                      {canManageSubscription
                        ? "Manage your payment method, view invoices or cancel your subscription in Stripe."
                        : state.reason === "incomplete"
                          ? "Return to Stripe to complete your subscription."
                          : "Continue to Stripe to set up your subscription."}
                    </p>
                    <span className="billing-secure">Payments handled securely by Stripe</span>
                  </div>
                )}
              </section>
            </div>

            <section className="billing-usage" aria-labelledby="billing-usage-title">
              <div>
                <p className="billing-eyebrow">Bring your own keys</p>
                <h2 id="billing-usage-title">Your provider usage is separate</h2>
                <p>
                  Social data and AI providers bill your accounts directly. Their usage is separate
                  from your SignalScout subscription.
                </p>
                <Link className="secondary-button" to={paths.connections}>
                  Manage connections <span aria-hidden="true">↗</span>
                </Link>
              </div>
              <dl>
                <div>
                  <dt>Social data</dt>
                  <dd>Searches and conversations collected through your connected providers.</dd>
                </div>
                <div>
                  <dt>AI models</dt>
                  <dd>
                    Classification, embeddings and reply drafts using your model provider keys.
                  </dd>
                </div>
                <div>
                  <dt>You control the budget</dt>
                  <dd>Set a monthly spending cap for each monitor in its settings.</dd>
                </div>
              </dl>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
