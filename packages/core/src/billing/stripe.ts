/**
 * Stripe, behind an interface. US-072.
 *
 * The interface is the point. Every seam in this repository that reaches
 * somebody else's API is injectable, because no test spends money and no test
 * needs the network — and a payment provider is the one where a test that got
 * through would be spending a real card. `BillingProvider` is what the routes
 * hold; `createStripeBilling` is the only thing in this repository that
 * constructs a Stripe client.
 *
 * **Three calls and no more.** Open Checkout, open the portal, read a webhook.
 * Cancelling, changing a card, updating an address and reading an invoice are
 * all Stripe's own portal, so this product builds none of those screens and
 * cannot get any of them wrong.
 *
 * **The webhook is the integration, not the success page.** A person closes the
 * tab, a renewal succeeds a month later, a card fails in March, somebody
 * cancels from the portal: none of that passes through a browser we control. So
 * `readEvent` is what moves the stored status, and the success page only says
 * thank you.
 */
import Stripe from "stripe";
import type { SubscriptionStatus } from "../db/schema.js";
import type { StripeSubscriptionState } from "./store.js";

/**
 * The API version this integration is written against.
 *
 * Pinned rather than left to the account's default, because a Stripe account's
 * version can be changed from a dashboard by somebody who is not reading this
 * file, and the shape below would then change under a running deployment. It
 * matters here in particular: `current_period_end` moved off the subscription
 * and onto the subscription item, so a version drift would read as a null
 * renewal date rather than as an error.
 */
export const stripeApiVersion = "2026-07-29.dahlia" as const;

export interface CheckoutRequest {
  readonly userId: string;
  readonly email: string;
  /** Null until this account has been to Checkout once. */
  readonly customerId: string | null;
  /**
   * When the free trial ends, so a person who pays on day two is still not
   * charged until day seven. Null once it has passed.
   */
  readonly trialEndsAt: Date | null;
  readonly successUrl: string;
  readonly cancelUrl: string;
}

export interface HostedPage {
  readonly url: string;
}

export interface CheckoutResult extends HostedPage {
  /** Always set: the customer is created here when the account had none. */
  readonly customerId: string;
}

export interface PortalRequest {
  readonly customerId: string;
  readonly returnUrl: string;
}

/**
 * What a webhook turned out to be.
 *
 * `ignored` is a first-class answer rather than a thrown error. Stripe sends
 * whatever the account is subscribed to, and an event this product does not act
 * on must still be answered 200 — a non-2xx makes Stripe retry it for days.
 */
export type BillingEvent =
  | {
      readonly kind: "subscription";
      readonly type: string;
      readonly state: StripeSubscriptionState;
    }
  | { readonly kind: "ignored"; readonly type: string };

export interface BillingProvider {
  /** Opens Stripe's hosted Checkout, creating the customer if there is none. */
  createCheckout(request: CheckoutRequest): Promise<CheckoutResult>;
  /** Opens Stripe's billing portal: change a card, cancel, read an invoice. */
  createPortal(request: PortalRequest): Promise<HostedPage>;
  /**
   * Verify a webhook's signature and say what it means.
   *
   * Throws when the signature does not check out. That throw is the gate on an
   * open route, so it must never be softened into a null the caller can forget
   * to test.
   */
  readEvent(payload: Buffer | string, signature: string): Promise<BillingEvent>;
}

/**
 * Stripe's status set, mapped onto the five this product stores.
 *
 * Mapped rather than carried through, and that is deliberate. A status this
 * application does not understand must not reach the column that decides
 * whether somebody may poll — `entitlementFor`'s `default` branch refuses, so an
 * unmapped Stripe value arriving verbatim would lock a paying person out.
 *
 * `unpaid` and `incomplete_expired` become `canceled` because Stripe has
 * stopped trying by then. `paused` becomes `canceled` for the same reason: a
 * paused subscription bills nothing, and a person who is billing nothing is not
 * paying for hosting.
 */
export function statusFromStripe(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "incomplete":
      return "incomplete";
    default:
      return "canceled";
  }
}

/** Stripe counts seconds; everything here is a `Date`. */
function fromUnixSeconds(seconds: number | null | undefined): Date | null {
  return typeof seconds === "number" ? new Date(seconds * 1000) : null;
}

function customerIdOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * When this period ends, read from the subscription item.
 *
 * It used to be on the subscription itself and it is not any more. Reading the
 * old place returns undefined rather than an error, which would show a person
 * no renewal date and tell nobody why.
 */
export function periodEndOf(subscription: Stripe.Subscription): Date | null {
  const [item] = subscription.items?.data ?? [];
  return fromUnixSeconds(item?.current_period_end);
}

/** The part of a Stripe subscription this database keeps. */
export function stateFromSubscription(
  subscription: Stripe.Subscription,
): StripeSubscriptionState | null {
  const stripeCustomerId = customerIdOf(subscription.customer);
  if (!stripeCustomerId) return null;

  return {
    stripeCustomerId,
    stripeSubscriptionId: subscription.id,
    status: statusFromStripe(subscription.status),
    currentPeriodEnd: periodEndOf(subscription),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    trialEndsAt: fromUnixSeconds(subscription.trial_end),
  };
}

/**
 * The events that move a stored subscription, and why each one is here.
 *
 * `customer.subscription.*` is the whole lifecycle: created at Checkout,
 * updated when a trial converts or somebody cancels from the portal, deleted
 * when it ends. The two invoice events are here because a failed card reaches
 * `past_due` through them and a recovered one comes back through `paid`, and
 * both carry the subscription so the state below is read the same way.
 */
export const handledEventTypes = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
] as const;

export interface StripeBillingOptions {
  readonly apiKey: string;
  readonly priceId: string;
  readonly webhookSecret: string;
  /** Injected by the test that drives the mapping without a network. */
  readonly client?: Stripe;
}

/**
 * A label on every Checkout Session this build opens, so one flow can be told
 * from another in Stripe's own dashboard. The suffix is fixed rather than
 * random: it names this integration, and a new random one per session would
 * make the dashboard's grouping useless.
 */
export const integrationIdentifier = "signalscout_cloudsubs";

export function createStripeBilling({
  apiKey,
  priceId,
  webhookSecret,
  client,
}: StripeBillingOptions): BillingProvider {
  const stripe = client ?? new Stripe(apiKey, { apiVersion: stripeApiVersion });

  return {
    async createCheckout(request) {
      const customerId =
        request.customerId ??
        (
          await stripe.customers.create({
            email: request.email,
            // The account this customer is, so a person found in Stripe's
            // dashboard can be found in this database without a search.
            metadata: { userId: request.userId },
          })
        ).id;

      /**
       * Stripe refuses a trial that ends too soon, so the remaining days are
       * only handed over when there are enough of them. Somebody paying on the
       * last afternoon of their week starts their subscription now, which is
       * what they asked for by pressing the button.
       */
      const minimumTrialMs = 48 * 60 * 60 * 1000;
      const trialEnd =
        request.trialEndsAt && request.trialEndsAt.getTime() - Date.now() > minimumTrialMs
          ? Math.floor(request.trialEndsAt.getTime() / 1000)
          : undefined;

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        // No `payment_method_types`. Stripe decides which methods to offer from
        // the account's own settings, and naming one here would lock out every
        // other.
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: trialEnd ? { trial_end: trialEnd } : {},
        client_reference_id: request.userId,
        integration_identifier: integrationIdentifier,
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
      });

      if (!session.url) {
        throw new Error("Stripe returned a Checkout Session with no URL.");
      }

      return { url: session.url, customerId };
    },

    async createPortal(request) {
      const session = await stripe.billingPortal.sessions.create({
        customer: request.customerId,
        return_url: request.returnUrl,
      });

      return { url: session.url };
    },

    async readEvent(payload, signature) {
      /**
       * `constructEventAsync` rather than the synchronous one. Node's crypto is
       * available either way; the async form is what works unchanged if this
       * ever runs somewhere that only has the Web Crypto API.
       */
      const event = await stripe.webhooks.constructEventAsync(payload, signature, webhookSecret);

      if (event.type.startsWith("customer.subscription.")) {
        const state = stateFromSubscription(event.data.object as Stripe.Subscription);
        return state
          ? { kind: "subscription", type: event.type, state }
          : { kind: "ignored", type: event.type };
      }

      if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
        /**
         * An invoice names its subscription but does not carry it, so the
         * subscription is read back. One extra call per invoice event, on the
         * path where a person's access is about to change: reading the
         * subscription is the only way to learn the status Stripe just moved it
         * to.
         */
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = subscriptionIdOf(invoice);
        if (!subscriptionId) return { kind: "ignored", type: event.type };

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const state = stateFromSubscription(subscription);
        return state
          ? { kind: "subscription", type: event.type, state }
          : { kind: "ignored", type: event.type };
      }

      return { kind: "ignored", type: event.type };
    },
  };
}

/**
 * The subscription an invoice belongs to.
 *
 * On this API version an invoice does not carry a `subscription` field. It
 * carries a `parent`, and a subscription invoice's parent holds it — which is
 * why this is a function with a comment rather than a property read. An invoice
 * for something that is not a subscription answers null, and the caller treats
 * that as an event to ignore.
 */
export function subscriptionIdOf(invoice: Stripe.Invoice): string | null {
  return customerIdOf(invoice.parent?.subscription_details?.subscription);
}
