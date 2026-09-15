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
  type AccountKeys,
  applyStripeSubscription,
  type BillingMode,
  type BillingProvider,
  type BillingSettings,
  checkAccountBudget,
  createStripeBilling,
  type Database,
  type Entitlement,
  type Logger,
  linkStripeCustomer,
  type PlanPrice,
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
  /**
   * What a card will be charged, from Stripe. BUG-014.
   *
   * Null when the provider could not be reached, and the screen then shows no
   * figure rather than one this product guessed. A wrong number about money is
   * worse than a missing one, and Checkout states the real terms on the next
   * page either way.
   *
   * `amount` is the currency's minor unit, as Stripe gives it. It is not
   * divided here: JPY has no minor unit and `Intl.NumberFormat` knows that
   * while a division by a hundred does not.
   */
  price: z
    .object({
      amount: z.number().int(),
      currency: z.string(),
      interval: z.string().nullable(),
    })
    .nullable(),
  /**
   * Whose keys this account's monitors spend. US-128, rekeyed by US-141.
   *
   * It was the Stripe plan and it is the account's own state now: one price,
   * and a choice a person changes on the connections screen rather than by
   * moving between subscriptions.
   */
  keySource: z.enum(["instance", "own"]),
  /**
   * The month this plan lends, and what is left of it. US-129.
   *
   * Null on every account spending its own money, and the screen then shows
   * nothing rather than a cap that does not apply. Micro-dollars, like every
   * other money figure this API answers with.
   *
   * `spentMicros` is an estimate, like every figure in `budget/`. The
   * provider's invoice is authoritative and this is not, which is why the
   * screen says "estimated" beside it.
   */
  included: z
    .object({
      /**
       * What the plan sells, which is what a customer bought. US-133.
       *
       * No figure in dollars, and no cap: `ACCOUNT_MONTHLY_CAP_MICROS` is the
       * deployment's fuse, it sits above this, and a screen that showed it
       * would tell somebody paying $35 that their plan includes $25. The
       * numbers here are the dials they already set on the monitor form.
       */
      monitors: z.number().int(),
      projects: z.number().int(),
      queries: z.number().int(),
      queriesPerPlatform: z.record(z.string(), z.number().int()),
      platforms: z.array(z.string()),
      pollIntervalSeconds: z.record(z.string(), z.number().int()),
      replies: z.boolean(),
      /**
       * True when the deployment's fuse has stopped this account for the
       * month. No figures travel with it: what a person may read is in
       * `accountBudgetState`'s sentence, which names none either.
       */
      paused: z.boolean(),
    })
    .nullable(),
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
  /**
   * What one account may spend of the instance's money, and what its plan
   * sells. US-129 and US-133.
   *
   * The same object the rest of the composition root uses, so the screen
   * states what the worker enforces rather than a second copy of it. Undefined
   * in a test that is not about either, and the screen then shows none.
   */
  readonly keys?: Pick<AccountKeys, "cap" | "capacity" | "source">;
  readonly now?: () => Date;
}

export async function registerBillingRoutes(
  app: ApiServer,
  { db, logger, settings, billing, keys, now = () => new Date() }: BillingRoutesOptions,
): Promise<void> {
  if (!settings) return;

  const provider = billing ?? createStripeBilling(settings);
  const iso = (value: Date | null) => value?.toISOString() ?? null;

  /**
   * The price, read once and then held for the life of the process.
   *
   * A screen load is not a Stripe call: this figure changes when somebody
   * edits it in a dashboard, which is rarer than people opening the billing
   * page, and a restart is what picks that change up. Only a *successful* read
   * is cached — a failed one is retried on the next request rather than
   * pinning "no price" until the process is restarted.
   */
  let cachedPrice: PlanPrice | null = null;

  async function planPrice(): Promise<PlanPrice | null> {
    if (cachedPrice) return cachedPrice;

    try {
      cachedPrice = await provider.readPrice();
      return cachedPrice;
    } catch (cause) {
      logger.error({ err: cause }, "the plan price could not be read: the screen will show none");
      return null;
    }
  }

  app.route({
    method: "GET",
    url: billingBasePath,
    schema: { response: { 200: billingStateSchema } },
    handler: async (request) => {
      const userId = sessionUserId(request);
      const subscription = await readSubscription(db, userId);
      const entitlement: Entitlement = await readEntitlement(db, userId, settings.mode, now());

      /**
       * What this account may still spend of ours, and what it has. US-129.
       *
       * `keys.cap` answers null for every account spending its own money, and
       * `checkAccountBudget` then reads no ledger — so the common account pays
       * one comparison for this and no query at all.
       */
      const capMicros = (await keys?.cap(userId)) ?? null;
      const included = await checkAccountBudget(db, userId, capMicros, now());
      // US-133. What the account was sold, rather than what the deployment
      // will lend it. Null for everybody spending their own money.
      const capacity = (await keys?.capacity(userId)) ?? null;

      return {
        mode: settings.mode,
        keySource: (await keys?.source(userId)) ?? "instance",
        included:
          capacity === null
            ? null
            : {
                monitors: capacity.monitors,
                projects: capacity.projects,
                queries: capacity.queries,
                queriesPerPlatform: Object.fromEntries(
                  Object.entries(capacity.queriesPerPlatform).filter(
                    ([, limit]) => limit !== undefined,
                  ),
                ) as Record<string, number>,
                platforms: [...capacity.platforms],
                pollIntervalSeconds: { ...capacity.pollIntervalSeconds },
                replies: capacity.replies,
                paused: included.exhausted,
              },
        entitled: entitlement.entitled,
        reason: entitlement.reason,
        status: subscription?.status ?? null,
        trialDaysLeft: entitlement.trialDaysLeft,
        trialEndsAt: iso(subscription?.trialEndsAt ?? null),
        currentPeriodEnd: iso(subscription?.currentPeriodEnd ?? null),
        cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
        hasBillingAccount: Boolean(subscription?.stripeCustomerId),
        trialDays,
        price: await planPrice(),
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
        /**
         * Where Stripe sends the person back to.
         *
         * These are the web app's own addresses. US-076 moved its router out
         * of the hash, so `/billing` is a route the app matches and Fastify's
         * not-found handler serves `index.html` for — until then the same
         * return read `/billing?checkout=done#/billing`, one address saying
         * the same thing twice, and the app landed on whichever half it read.
         */
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
            {
              type: event.type,
              userId: updated.userId,
              status: updated.status,
            },
            "a subscription changed",
          );

          /**
           * A price this deployment does not sell. US-128, kept by US-141.
           *
           * It decides nothing now — whose keys an account runs on is the
           * account's own state, not the price it pays. It is still worth a
           * line: an operator who mistyped `STRIPE_PRICE_ID` would otherwise
           * see subscriptions arriving against a price nothing here names,
           * with no error anywhere.
           */
          if (event.state.priceId && event.state.priceId !== settings.priceId) {
            logger.error(
              { userId: updated.userId, price: event.state.priceId },
              "a subscription names a price this instance does not sell",
            );
          }
        }

        return { received: true as const };
      },
    });
  });
}
