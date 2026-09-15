/**
 * The paywall, and the routes behind it.
 *
 * Correctness-critical, and the enumeration is the point — the same argument
 * `auth.test.ts` makes about the session gate. A sample of five routes passes
 * for ever while the sixth, added next month, quietly lets an expired account
 * spend money. This walks what the build actually registered and checks every
 * write route against one rule.
 *
 * No test here reaches Stripe. `fakeBilling` records what it was asked for,
 * which is the only thing worth asserting: whether the trial deadline was
 * handed over, whether the customer was reused, and whether an unverified body
 * changed anything.
 */
import { randomUUID } from "node:crypto";
import {
  type BillingEvent,
  type BillingProvider,
  type BillingSettings,
  createDatabase,
  createLogger,
  type Database,
  loadEnv,
  monitors,
  readSubscription,
  recordSourceUsage,
  startTrial,
  subscriptions,
  users,
} from "@signalscout/core";
import { createTestDatabase, type TestDatabase } from "@signalscout/core/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { billingBasePath, billingWebhookPath, isOpenPath } from "./auth.js";
import {
  billingReasonHeader,
  isOpenToUnpaid,
  openToUnpaidPaths,
  unpaidMessage,
  writeMethods,
} from "./billing.js";
import { type ApiServer, buildServer } from "./server.js";
import { asUser } from "./testing.js";

const logger = createLogger({ level: "silent", name: "test" });

const settings: BillingSettings = {
  mode: "stripe",
  apiKey: "sk_test_not_a_real_key",
  priceId: "price_test",
  // US-128. A deployment that sells the keys-included plan names its price
  // here; these cases are about the gate and the webhook, so they sell one.
  keysIncludedPriceId: undefined,
  webhookSecret: "whsec_test",
  appUrl: "https://app.example.test",
};

interface Recorded {
  checkout: unknown[];
  portal: unknown[];
  /** What `readEvent` will answer next, or a thrown signature failure. */
  next: BillingEvent | Error;
  /** How many times the screen asked Stripe what the price is. BUG-014. */
  priceReads?: number;
  /** Set to make the price unreadable, which is Stripe being unreachable. */
  priceFails?: boolean;
}

function fakeBilling(recorded: Recorded): BillingProvider {
  return {
    async readPrice() {
      recorded.priceReads = (recorded.priceReads ?? 0) + 1;
      if (recorded.priceFails) throw new Error("Stripe is unreachable");
      return { amount: 2000, currency: "usd", interval: "month" };
    },
    async createCheckout(request) {
      recorded.checkout.push(request);
      return {
        url: "https://checkout.stripe.test/session",
        customerId: request.customerId ?? "cus_new",
      };
    },
    async createPortal(request) {
      recorded.portal.push(request);
      return { url: "https://portal.stripe.test/session" };
    },
    async readEvent() {
      if (recorded.next instanceof Error) throw recorded.next;
      return recorded.next;
    },
  };
}

describe("the paywall", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;
  let recorded: Recorded;

  beforeAll(async () => {
    database = await createTestDatabase("api_billing");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close();
    await database.drop();
  });

  afterEach(async () => {
    await db.delete(monitors);
    await db.delete(subscriptions);
    await db.delete(users);
  });

  async function account(id: string): Promise<string> {
    await db.insert(users).values({ id, name: id, email: `${id}@example.test` });
    return id;
  }

  async function server(userId: string, mode: "stripe" | "off" = "stripe"): Promise<ApiServer> {
    recorded = { checkout: [], portal: [], next: { kind: "ignored", type: "none" } };
    const env = loadEnv({ DATABASE_URL: database.url, AUTH_SECRET: "x".repeat(32) });

    return buildServer({
      env,
      logger,
      db,
      auth: null,
      session: asUser(userId),
      queryGenerator: null,
      billingSettings: mode === "off" ? null : settings,
      billing: fakeBilling(recorded),
    });
  }

  it("refuses every write route this build registers when the trial has ended", async () => {
    const id = await account(`expired-${randomUUID()}`);
    await startTrial(db, id, { now: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) });

    const app = await server(id);

    try {
      /**
       * Every route, not a chosen few. The rule is a claim about all of them,
       * and the route somebody adds next month is exactly the one nobody would
       * think to add to a sample.
       */
      const guarded = app.registeredRoutes.filter(
        (route) =>
          (writeMethods as readonly string[]).includes(route.method) &&
          route.url.startsWith("/api/") &&
          !isOpenPath(route.url) &&
          !openToUnpaidPaths.includes(route.url),
      );

      expect(guarded.length).toBeGreaterThan(5);

      for (const route of guarded) {
        const response = await app.inject({
          method: route.method as "POST",
          url: route.url.replace(/:\w+/g, randomUUID()).replace("/*", "/anything"),
          payload: {},
        });

        expect(
          { url: route.url, method: route.method, status: response.statusCode },
          `${route.method} ${route.url} should be refused without a subscription`,
        ).toEqual({ url: route.url, method: route.method, status: 402 });

        expect(response.json()).toMatchObject({ message: unpaidMessage });
        // In a header, because a route's own error schema strips a body key it
        // does not name and only some routes declare one.
        expect(response.headers[billingReasonHeader]).toBe("trial_expired");
      }
    } finally {
      await app.close();
    }
  });

  it("lets an expired account read, so paying is not a ransom", async () => {
    const id = await account(`reader-${randomUUID()}`);
    await startTrial(db, id, { now: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) });

    const app = await server(id);

    try {
      const inbox = await app.inject({ method: "GET", url: "/api/matches" });
      expect(inbox.statusCode).toBe(200);

      const monitorList = await app.inject({ method: "GET", url: "/api/monitors" });
      expect(monitorList.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("lets an expired account reach Checkout, so the paywall can be paid", async () => {
    const id = await account(`payer-${randomUUID()}`);
    await startTrial(db, id, { now: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) });

    const app = await server(id);

    try {
      const response = await app.inject({ method: "POST", url: `${billingBasePath}/checkout` });

      expect(response.statusCode).toBe(200);
      expect(response.json().url).toBe("https://checkout.stripe.test/session");
    } finally {
      await app.close();
    }
  });

  it("lets a trial that has days left write", async () => {
    const id = await account(`trialing-${randomUUID()}`);
    await startTrial(db, id);

    const app = await server(id);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/projects",
        payload: { name: "A project" },
      });

      expect(response.statusCode).not.toBe(402);
    } finally {
      await app.close();
    }
  });

  it("registers no gate at all when this deployment does not charge", async () => {
    const id = await account(`selfhosted-${randomUUID()}`);
    // An expired row, which on a free instance must change nothing.
    await startTrial(db, id, { now: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) });

    const app = await server(id, "off");

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/projects",
        payload: { name: "A project" },
      });

      expect(response.statusCode).not.toBe(402);
      expect(app.registeredRoutes.some((route) => route.url.startsWith(billingBasePath))).toBe(
        false,
      );
    } finally {
      await app.close();
    }
  });

  it("says which methods are gated, and that the login and billing are not", () => {
    expect(isOpenToUnpaid("GET", "/api/monitors")).toBe(true);
    expect(isOpenToUnpaid("POST", "/api/monitors")).toBe(false);
    expect(isOpenToUnpaid("POST", "/api/auth/sign-in/email")).toBe(true);
    expect(isOpenToUnpaid("POST", `${billingBasePath}/checkout`)).toBe(true);
    expect(isOpenToUnpaid("POST", billingWebhookPath)).toBe(true);
  });
});

describe("the billing routes", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;
  let recorded: Recorded;

  beforeAll(async () => {
    database = await createTestDatabase("api_billing_routes");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close();
    await database.drop();
  });

  afterEach(async () => {
    await db.delete(subscriptions);
    await db.delete(users);
  });

  async function server(
    userId: string,
    lines?: string[],
    /**
     * An instance that lends its keys: registrations open and a month to lend.
     * US-129. Nothing is injected — the cap the route answers with is the one
     * `buildServer` builds for the worker, which is the whole point of the two
     * assertions below.
     */
    lending?: { capMicros: number },
  ): Promise<ApiServer> {
    recorded = { checkout: [], portal: [], next: { kind: "ignored", type: "none" } };
    const env = loadEnv({
      DATABASE_URL: database.url,
      AUTH_SECRET: "x".repeat(32),
      ...(lending
        ? {
            AUTH_SIGNUP: "open",
            ACCOUNT_MONTHLY_CAP_MICROS: String(lending.capMicros),
          }
        : {}),
    });

    return buildServer({
      env,
      logger: lines
        ? createLogger({
            level: "error",
            name: "billing-test",
            destination: { write: (line: string) => lines.push(line) },
          })
        : logger,
      db,
      auth: null,
      session: asUser(userId),
      queryGenerator: null,
      billingSettings: settings,
      billing: fakeBilling(recorded),
    });
  }

  async function account(id: string): Promise<string> {
    await db.insert(users).values({ id, name: id, email: `${id}@example.test` });
    return id;
  }

  /**
   * US-129. The screen states the cap the worker enforces, from the same object
   * — a second copy of the figure is how a page and a poll stop agreeing.
   */
  /**
   * US-133 replaced the allowance with the capacity, and the expected value
   * moved because the behaviour was meant to. The route used to answer with
   * `ACCOUNT_MONTHLY_CAP_MICROS` and the month's spend — the deployment's
   * fuse, printed as though it were the customer's allowance, so a $49
   * account was told its included usage was $15. What it answers with now is
   * what the customer bought: monitors, queries, platforms and a schedule.
   */
  it("reports what the plan sells, and no figure in dollars", async () => {
    const id = await account(`lent-${randomUUID()}`);
    await db.insert(subscriptions).values({ userId: id, status: "active", plan: "keys_included" });

    await recordSourceUsage(db, {
      userId: id,
      monitorId: null,
      source: "reddit",
      provider: "socialcrawl",
      units: 1,
      pricePerUnitMicros: 4_000_000,
    });

    const app = await server(id, undefined, { capMicros: 25_000_000 });

    try {
      const body = (await app.inject({ method: "GET", url: billingBasePath })).json();

      expect(body.plan).toBe("keys_included");
      expect(body.included).toEqual({
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
      });

      // The fuse is the deployment's and no key here names it.
      expect(JSON.stringify(body.included)).not.toMatch(/Micros|spent|cap/i);
    } finally {
      await app.close();
    }
  });

  /**
   * An account spending its own money meets no cap, so the screen shows none.
   * A figure there would be a limit that does not apply, which is worse than
   * no figure at all.
   */
  it("reports no lent month for an account spending its own money", async () => {
    const id = await account(`own-${randomUUID()}`);
    // The same lending instance, and an account on the other plan.
    const app = await server(id, undefined, { capMicros: 25_000_000 });

    try {
      const body = (await app.inject({ method: "GET", url: billingBasePath })).json();

      expect(body.plan).toBe("own_keys");
      expect(body.included).toBeNull();
    } finally {
      await app.close();
    }
  });

  it("reports the trial a new account is on", async () => {
    const id = await account(`state-${randomUUID()}`);
    await startTrial(db, id);

    const app = await server(id);

    try {
      const response = await app.inject({ method: "GET", url: billingBasePath });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        mode: "stripe",
        entitled: true,
        reason: "trialing",
        status: "trialing",
        trialDaysLeft: 7,
        hasBillingAccount: false,
      });
    } finally {
      await app.close();
    }
  });

  /**
   * BUG-014. The screen carried `$15` as a literal and the live price is $20,
   * so it quoted a figure Stripe does not charge and Checkout corrected it on
   * the next page.
   */
  it("states the price the provider holds rather than one of its own", async () => {
    const id = await account(`price-${randomUUID()}`);
    await startTrial(db, id);

    const app = await server(id);

    try {
      const body = (await app.inject({ method: "GET", url: billingBasePath })).json();

      // The minor unit, undivided. Dividing here would be wrong for a currency
      // that has no minor unit, and the screen is where the scaling belongs.
      expect(body.price).toEqual({ amount: 2000, currency: "usd", interval: "month" });
    } finally {
      await app.close();
    }
  });

  it("reads the price once and holds it, so a screen load is not a Stripe call", async () => {
    const id = await account(`price-cache-${randomUUID()}`);
    await startTrial(db, id);

    const app = await server(id);

    try {
      await app.inject({ method: "GET", url: billingBasePath });
      await app.inject({ method: "GET", url: billingBasePath });
      await app.inject({ method: "GET", url: billingBasePath });

      expect(recorded.priceReads).toBe(1);
    } finally {
      await app.close();
    }
  });

  it("shows no price when the provider cannot be reached, and invents none", async () => {
    // A wrong number about money is worse than a missing one. Checkout states
    // the real terms on the next page, so nothing is lost by saying nothing.
    const id = await account(`price-down-${randomUUID()}`);
    await startTrial(db, id);

    const app = await server(id);
    recorded.priceFails = true;

    try {
      const body = (await app.inject({ method: "GET", url: billingBasePath })).json();

      expect(body.price).toBe(null);
      // Still entitled, and Checkout is still reachable: an unreadable price
      // must not become a paywall.
      expect(body.entitled).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("retries a failed price read rather than pinning the failure", async () => {
    // Only a successful read is cached. Caching the failure would leave the
    // screen priceless until somebody restarted the process.
    const id = await account(`price-retry-${randomUUID()}`);
    await startTrial(db, id);

    const app = await server(id);
    recorded.priceFails = true;

    try {
      expect((await app.inject({ method: "GET", url: billingBasePath })).json().price).toBe(null);

      recorded.priceFails = false;

      expect((await app.inject({ method: "GET", url: billingBasePath })).json().price).toEqual({
        amount: 2000,
        currency: "usd",
        interval: "month",
      });
    } finally {
      await app.close();
    }
  });

  it("hands Checkout the trial deadline, so paying early does not charge early", async () => {
    const id = await account(`early-${randomUUID()}`);
    const trial = await startTrial(db, id);

    const app = await server(id);

    try {
      await app.inject({ method: "POST", url: `${billingBasePath}/checkout` });

      expect(recorded.checkout).toHaveLength(1);
      expect(recorded.checkout[0]).toMatchObject({
        userId: id,
        customerId: null,
        trialEndsAt: trial.trialEndsAt,
      });
    } finally {
      await app.close();
    }
  });

  it("writes the customer before the person leaves for Stripe", async () => {
    /**
     * The webhook arrives keyed by the customer and by nothing else, so a
     * payment that succeeded against a customer this database has never heard
     * of is a person who paid and stayed locked out.
     */
    const id = await account(`customer-${randomUUID()}`);
    await startTrial(db, id);

    const app = await server(id);

    try {
      await app.inject({ method: "POST", url: `${billingBasePath}/checkout` });

      expect((await readSubscription(db, id))?.stripeCustomerId).toBe("cus_new");

      // And the second visit reuses it rather than making a second customer.
      await app.inject({ method: "POST", url: `${billingBasePath}/checkout` });

      expect(recorded.checkout[1]).toMatchObject({ customerId: "cus_new" });
    } finally {
      await app.close();
    }
  });

  it("refuses the portal for an account that has never paid", async () => {
    const id = await account(`noportal-${randomUUID()}`);
    await startTrial(db, id);

    const app = await server(id);

    try {
      const response = await app.inject({ method: "POST", url: `${billingBasePath}/portal` });

      expect(response.statusCode).toBe(409);
      expect(recorded.portal).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it("changes nothing when a webhook's signature does not verify", async () => {
    const id = await account(`unsigned-${randomUUID()}`);
    await startTrial(db, id);
    await db.update(subscriptions).set({ stripeCustomerId: "cus_signed" });

    const app = await server(id);
    recorded.next = new Error("no signatures found matching the expected signature");

    try {
      const response = await app.inject({
        method: "POST",
        url: billingWebhookPath,
        headers: { "stripe-signature": "t=1,v1=nonsense", "content-type": "application/json" },
        payload: JSON.stringify({ type: "customer.subscription.updated" }),
      });

      expect(response.statusCode).toBe(400);
      expect((await readSubscription(db, id))?.status).toBe("trialing");
    } finally {
      await app.close();
    }
  });

  it("refuses a webhook with no signature header at all", async () => {
    const id = await account(`nosig-${randomUUID()}`);
    const app = await server(id);

    try {
      const response = await app.inject({
        method: "POST",
        url: billingWebhookPath,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ type: "customer.subscription.updated" }),
      });

      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("moves the stored status when Stripe says a subscription changed", async () => {
    const id = await account(`paid-${randomUUID()}`);
    await startTrial(db, id);
    await db.update(subscriptions).set({ stripeCustomerId: "cus_paid" });

    const app = await server(id);
    const periodEnd = new Date("2026-10-08T00:00:00Z");

    recorded.next = {
      kind: "subscription",
      type: "customer.subscription.updated",
      state: {
        stripeCustomerId: "cus_paid",
        stripeSubscriptionId: "sub_1",
        status: "active",
        plan: "own_keys",
        priceId: "price_own",
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        trialEndsAt: null,
      },
    };

    try {
      const response = await app.inject({
        method: "POST",
        url: billingWebhookPath,
        headers: { "stripe-signature": "t=1,v1=fine", "content-type": "application/json" },
        payload: JSON.stringify({ type: "customer.subscription.updated" }),
      });

      expect(response.statusCode).toBe(200);

      const stored = await readSubscription(db, id);
      expect(stored?.status).toBe("active");
      expect(stored?.stripeSubscriptionId).toBe("sub_1");
      expect(stored?.currentPeriodEnd?.toISOString()).toBe(periodEnd.toISOString());
      // The seven days are kept, so a screen can still say when they ended.
      expect(stored?.trialEndsAt).not.toBeNull();
    } finally {
      await app.close();
    }
  });

  /**
   * US-128. The plan reaches the column the only way it can: from the price
   * Stripe names, through the webhook. No screen sets it and no route does,
   * which is what stops a person choosing the expensive plan by choosing it.
   */
  it("writes the plan the price named, and moves it back when Stripe says so", async () => {
    const id = await account(`plan-${randomUUID()}`);
    await startTrial(db, id);
    await db.update(subscriptions).set({ stripeCustomerId: "cus_plan" });

    const app = await server(id);

    const event = (plan: "own_keys" | "keys_included") => ({
      kind: "subscription" as const,
      type: "customer.subscription.updated",
      state: {
        stripeCustomerId: "cus_plan",
        stripeSubscriptionId: "sub_plan",
        status: "active" as const,
        plan,
        priceId: plan === "keys_included" ? "price_included" : "price_own",
        currentPeriodEnd: new Date("2026-10-08T00:00:00Z"),
        cancelAtPeriodEnd: false,
        trialEndsAt: null,
      },
    });

    const deliver = async () =>
      app.inject({
        method: "POST",
        url: billingWebhookPath,
        headers: { "stripe-signature": "t=1,v1=fine", "content-type": "application/json" },
        payload: JSON.stringify({ type: "customer.subscription.updated" }),
      });

    try {
      recorded.next = event("keys_included");
      expect((await deliver()).statusCode).toBe(200);
      expect((await readSubscription(db, id))?.plan).toBe("keys_included");

      // And back. An account that moves off the plan stops spending our keys,
      // and this is the write that says so.
      recorded.next = event("own_keys");
      expect((await deliver()).statusCode).toBe(200);
      expect((await readSubscription(db, id))?.plan).toBe("own_keys");
    } finally {
      await app.close();
    }
  });

  /**
   * US-128. A price neither variable names is read as the plan that spends the
   * account's own money, which is the safe direction and a silent one: an
   * operator who mistyped `STRIPE_PRICE_ID_KEYS_INCLUDED` would see paying
   * accounts on the cheaper plan and no error anywhere. So it is an error.
   */
  it("says so when a subscription names a price this instance does not sell", async () => {
    const id = await account(`unknown-price-${randomUUID()}`);
    await startTrial(db, id);
    await db.update(subscriptions).set({ stripeCustomerId: "cus_unknown_price" });

    const lines: string[] = [];
    const app = await server(id, lines);

    recorded.next = {
      kind: "subscription",
      type: "customer.subscription.updated",
      state: {
        stripeCustomerId: "cus_unknown_price",
        stripeSubscriptionId: "sub_unknown",
        status: "active",
        plan: "own_keys",
        priceId: "price_nobody_configured",
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        trialEndsAt: null,
      },
    };

    try {
      const response = await app.inject({
        method: "POST",
        url: billingWebhookPath,
        headers: { "stripe-signature": "t=1,v1=fine", "content-type": "application/json" },
        payload: JSON.stringify({ type: "customer.subscription.updated" }),
      });

      // Answered, and stored, and complained about. The account keeps polling
      // on its own keys, which is what the safe direction means.
      expect(response.statusCode).toBe(200);
      expect((await readSubscription(db, id))?.plan).toBe("own_keys");
      expect(lines.join("\n")).toContain("price_nobody_configured");
    } finally {
      await app.close();
    }
  });

  it("answers 200 to an event it does not act on, so Stripe stops retrying it", async () => {
    const id = await account(`ignored-${randomUUID()}`);
    const app = await server(id);
    recorded.next = { kind: "ignored", type: "customer.discount.created" };

    try {
      const response = await app.inject({
        method: "POST",
        url: billingWebhookPath,
        headers: { "stripe-signature": "t=1,v1=fine", "content-type": "application/json" },
        payload: JSON.stringify({ type: "customer.discount.created" }),
      });

      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
