/**
 * The paywall, and the three routes behind it. US-072.
 *
 * Correctness-critical, in the same way the session gate is and with the same
 * failure shape: a rule that is applied route by route is a rule the route
 * added next month will not have. So there is one `onRequest` hook, it runs
 * after the session gate, and what is *not* behind it is a written list.
 *
 * **Reads stay, writes stop.** A person whose trial ran out can sign in, read
 * their inbox, export the CSV and pay. They cannot create a monitor, run a cost
 * test or draft a reply. Taking the data away would make paying feel like a
 * ransom, and it would remove the one thing that brings somebody back.
 *
 * **The method is the rule, not a list of paths.** Every route that changes
 * something is a POST, PUT, PATCH or DELETE, so asking about the method covers
 * the route nobody remembered to add to a list. `billing.test.ts` walks every
 * route this build registers and checks each one against that rule, which is
 * what makes it a claim about all of them rather than about the ones somebody
 * thought of.
 *
 * **402, not 403.** "You may not do this" and "this account has not paid" send
 * a person to two different places, and the screen reads the reason to decide
 * which sentence to show.
 */
import {
  applyStripeSubscription,
  type BillingMode,
  type BillingProvider,
  type BillingSettings,
  createStripeBilling,
  type Database,
  type Entitlement,
  type Logger,
  linkStripeCustomer,
  readEntitlement,
  readSubscription,
  trialDays,
} from "@signalscout/core";
import { z } from "zod";
import { billingBasePath, billingWebhookPath, isOpenPath, sessionUserId } from "./auth.js";
import type { ApiServer } from "./server.js";

/** The methods that change something, and therefore need a paid-up account. */
export const writeMethods = ["POST", "PUT", "PATCH", "DELETE"] as const;

/**
 * The paths a signed-in person may still write to with no subscription, and
 * why each one is here.
 *
 * Two entries, and both are the way out of the state. Opening Checkout and
 * opening the portal are POSTs, so without this list an expired account could
 * not reach the page that takes its money — a paywall that cannot be paid.
 * Everything the login does is already outside this hook, because the hook
 * only sees what the session gate let through.
 */
export const openToUnpaidPaths: readonly string[] = [
  `${billingBasePath}/checkout`,
  `${billingBasePath}/portal`,
];

/** The sentence an unpaid write is refused with. */
export const unpaidMessage = "Your trial has ended. Subscribe to keep using SignalScout.";

/** Why it was refused. See the gate below for why this is not in the body. */
export const billingReasonHeader = "x-billing-reason";

/** Is this request one the paywall lets through whatever the account has paid? */
export function isOpenToUnpaid(method: string, path: string): boolean {
  if (!(writeMethods as readonly string[]).includes(method.toUpperCase())) return true;
  if (isOpenPath(path)) return true;

  return openToUnpaidPaths.includes(path);
}

export interface BillingGateOptions {
  readonly db: Database;
  readonly mode: BillingMode;
  /** Injected so a test can stand on either side of a trial deadline. */
  readonly now?: () => Date;
}

/**
 * Refuse a write from an account that has not paid.
 *
 * Registered after the session gate, so `sessionUser` is already set and a
 * signed-out request has already been turned away. In `off` mode the hook is
 * not registered at all: a self-hosted instance runs the code it ran before
 * this file existed.
 */
export function registerBillingGate(app: ApiServer, options: BillingGateOptions): void {
  if (options.mode === "off") return;

  const now = options.now ?? (() => new Date());

  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0] ?? "";

    if (isOpenToUnpaid(request.method, path)) return;

    const entitlement = await readEntitlement(
      options.db,
      sessionUserId(request),
      options.mode,
      now(),
    );

    if (!entitlement.entitled) {
      /**
       * The reason travels in a header rather than in the body, and that is a
       * measured decision rather than a preference. Most routes declare a Zod
       * schema for their error responses, and a schema strips a key it does not
       * name — so a `reason` in the body survives on some routes and vanishes
       * on others, which is worse than not sending it. A header passes every
       * serializer untouched.
       */
      return reply
        .code(402)
        .header(billingReasonHeader, entitlement.reason)
        .send({ message: unpaidMessage });
    }
  });
}

/** What the billing screen shows. One read, so nothing on it can disagree. */
const billingStateSchema = z.object({
  mode: z.enum(["off", "stripe"]),
  entitled: z.boolean(),
  reason: z.string(),
  status: z.string().nullable(),
  trialDaysLeft: z.number().int().nullable(),
  trialEndsAt: z.string().nullable(),
  currentPeriodEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  /** Whether this account has ever been to Checkout, which is what the portal needs. */
  hasBillingAccount: z.boolean(),
  trialDays: z.number().int(),
});

export interface BillingRoutesOptions {
  readonly db: Database;
  readonly logger: Logger;
  /** Null when this deployment does not charge; no route is then registered. */
  readonly settings: BillingSettings | null;
  /**
   * The payment provider. Injected by every test, because no test spends money
   * and no test needs the network. Undefined builds the real Stripe client.
   */
  readonly billing?: BillingProvider;
  readonly now?: () => Date;
}

export async function registerBillingRoutes(
  app: ApiServer,
  { db, logger, settings, billing, now = () => new Date() }: BillingRoutesOptions,
): Promise<void> {
  if (!settings) return;

  const provider = billing ?? createStripeBilling(settings);
  const iso = (value: Date | null) => value?.toISOString() ?? null;

  app.route({
    method: "GET",
    url: billingBasePath,
    schema: { response: { 200: billingStateSchema } },
    handler: async (request) => {
      const userId = sessionUserId(request);
      const subscription = await readSubscription(db, userId);
      const entitlement: Entitlement = await readEntitlement(db, userId, settings.mode, now());

      return {
        mode: settings.mode,
        entitled: entitlement.entitled,
        reason: entitlement.reason,
        status: subscription?.status ?? null,
        trialDaysLeft: entitlement.trialDaysLeft,
        trialEndsAt: iso(subscription?.trialEndsAt ?? null),
        currentPeriodEnd: iso(subscription?.currentPeriodEnd ?? null),
        cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
        hasBillingAccount: Boolean(subscription?.stripeCustomerId),
        trialDays,
      };
    },
  });

  app.route({
    method: "POST",
    url: `${billingBasePath}/checkout`,
    schema: { response: { 200: z.object({ url: z.url() }) } },
    handler: async (request) => {
      const userId = sessionUserId(request);
      const subscription = await readSubscription(db, userId);

      const checkout = await provider.createCheckout({
        userId,
        email: request.sessionUser?.email ?? "",
        customerId: subscription?.stripeCustomerId ?? null,
        trialEndsAt: subscription?.trialEndsAt ?? null,
        successUrl: `${settings.appUrl}/billing?checkout=done`,
        cancelUrl: `${settings.appUrl}/billing?checkout=cancelled`,
      });

      /**
       * The customer is written before the person leaves, not when they come
       * back. Every webhook arrives keyed by the customer and by nothing else,
       * so a payment that succeeded against a customer this database has never
       * heard of is a person who paid and stayed locked out.
       */
      await linkStripeCustomer(db, userId, checkout.customerId);

      return { url: checkout.url };
    },
  });

  app.route({
    method: "POST",
    url: `${billingBasePath}/portal`,
    schema: {
      response: { 200: z.object({ url: z.url() }), 409: z.object({ message: z.string() }) },
    },
    handler: async (request, reply) => {
      const subscription = await readSubscription(db, sessionUserId(request));

      if (!subscription?.stripeCustomerId) {
        return reply
          .code(409)
          .send({ message: "This account has no billing details yet. Subscribe first." });
      }

      const portal = await provider.createPortal({
        customerId: subscription.stripeCustomerId,
        returnUrl: `${settings.appUrl}/billing`,
      });

      return { url: portal.url };
    },
  });

  /**
   * Stripe's webhook.
   *
   * In a plugin scope of its own, for the reason the login routes are: the
   * signature is over the exact bytes Stripe sent, and Fastify's JSON parser
   * would hand this route an object that cannot be verified. A content type
   * parser is encapsulated by the scope it is registered in, so putting it on
   * the root instance would take JSON parsing away from every other route in
   * the process.
   */
  await app.register(async (scope) => {
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_request, body, done) => {
        done(null, body);
      },
    );

    scope.route({
      method: "POST",
      url: billingWebhookPath,
      schema: {
        response: {
          200: z.object({ received: z.literal(true) }),
          400: z.object({ message: z.string() }),
        },
      },
      handler: async (request, reply) => {
        const signature = request.headers["stripe-signature"];

        if (typeof signature !== "string") {
          return reply.code(400).send({ message: "No Stripe signature." });
        }

        let event: Awaited<ReturnType<BillingProvider["readEvent"]>>;

        try {
          event = await provider.readEvent(request.body as Buffer, signature);
        } catch (error) {
          /**
           * A body that does not verify changes nothing and is answered 400.
           * This is the gate on an open route, so the refusal is the whole
           * protection and it must never become a warning beside a write.
           */
          logger.warn({ err: error }, "a Stripe webhook failed signature verification");
          return reply.code(400).send({ message: "Signature verification failed." });
        }

        if (event.kind === "ignored") {
          /**
           * Answered 200 on purpose. Stripe sends whatever the account is
           * subscribed to, and a non-2xx makes it retry the same event for
           * days over something this product deliberately does not act on.
           */
          logger.debug({ type: event.type }, "a Stripe webhook was ignored");
          return { received: true as const };
        }

        const updated = await applyStripeSubscription(db, event.state);

        if (!updated) {
          /**
           * A customer this database does not know. Logged rather than
           * created: an account is written when Checkout is opened, and
           * inventing one from an event would attach somebody who is paying to
           * no account at all.
           */
          logger.error(
            { type: event.type, customer: event.state.stripeCustomerId },
            "a Stripe webhook named a customer no account here holds",
          );
        } else {
          logger.info(
            { type: event.type, userId: updated.userId, status: updated.status },
            "a subscription changed",
          );
        }

        return { received: true as const };
      },
    });
  });
}
