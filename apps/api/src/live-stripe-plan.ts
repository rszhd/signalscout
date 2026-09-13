/**
 * Does a real Stripe subscription put an account on the right plan? US-128.
 *
 * The suite proves the mapping against a subscription this repository wrote,
 * which is evidence about our own shape and none about Stripe's. One thing in
 * particular is somebody else's half and has never been checked: `priceIdOf`
 * reads the price off the subscription *item*, the way `periodEndOf` reads the
 * period end, and reading the wrong place answers undefined rather than an
 * error — an account quietly on the cheaper plan, and nothing anywhere saying
 * so.
 *
 * **It spends nothing.** Test mode, a test card fixture, and every object it
 * makes is deleted on the way out.
 *
 * **It is end to end.** A real customer, a real subscription on a real price, a
 * real webhook delivered by `stripe listen` over a real signature, and the row
 * read back out of a scratch database. The only thing standing in for
 * production is the database, which is dropped.
 *
 *     pnpm --filter @signalscout/core live:stripe-plan
 *
 * `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` and `STRIPE_PRICE_ID_KEYS_INCLUDED`
 * are read from `.env`. The key must be a test key: this refuses to run against
 * a live one, because it creates and cancels subscriptions.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import {
  createDatabase,
  createLogger,
  linkStripeCustomer,
  loadEnv,
  readSubscription,
  users,
} from "@signalscout/core";
import { createTestDatabase } from "@signalscout/core/testing";
import { buildServer } from "./server.js";

const apiKey = process.env.STRIPE_SECRET_KEY ?? "";
const ownPrice = process.env.STRIPE_PRICE_ID ?? "";
const lentPrice = process.env.STRIPE_PRICE_ID_KEYS_INCLUDED ?? "";
/**
 * A port of its own, and deliberately not `PORT`.
 *
 * `.env` names the port the development server listens on, and this script
 * would take it — so a run while `pnpm dev` is up refuses to start, which is
 * the state a person is most likely to be in when they run this.
 */
const port = Number(process.env.LIVE_STRIPE_PORT ?? 3999);

if (!apiKey.startsWith("sk_test_")) {
  console.error(
    "This needs a Stripe *test* key in STRIPE_SECRET_KEY. It creates and cancels\n" +
      "subscriptions, and it refuses to do that against a live account.",
  );
  process.exit(1);
}

if (!ownPrice || !lentPrice) {
  console.error(
    "Set STRIPE_PRICE_ID and STRIPE_PRICE_ID_KEYS_INCLUDED. This run is about which\n" +
      "of the two a subscription names, so it cannot tell you anything with one.",
  );
  process.exit(1);
}

const started = Date.now();
const say = (line: string) =>
  console.log(`[${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s] ${line}`);

/** Stripe's own form encoding, so nothing here needs their SDK to make a call. */
async function stripe(
  path: string,
  body?: Record<string, string>,
  method = body ? "POST" : "GET",
): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
      ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(body ? { body: new URLSearchParams(body).toString() } : {}),
  });

  const answer = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    const error = answer.error as { message?: string } | undefined;
    throw new Error(`Stripe ${method} ${path}: ${error?.message ?? response.status}`);
  }

  return answer;
}

/** The signing secret for this account's local listener, without starting one. */
async function printSecret(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("stripe", ["listen", "--print-secret", "--api-key", apiKey]);
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
    });
    child.on("close", () => {
      const secret = out
        .trim()
        .split(/\s+/)
        .find((word) => word.startsWith("whsec_"));
      secret ? resolve(secret) : reject(new Error(`no signing secret in: ${out}`));
    });
    child.on("error", reject);
  });
}

const logger = createLogger({ level: "error", name: "live-stripe-plan" });
const webhookSecret = await printSecret();
say("read this account's webhook signing secret");

const scratch = await createTestDatabase("live_stripe_plan");
const { db, close } = createDatabase(scratch.url);
say(`scratch database ${scratch.name}`);

/** The API, built the way `start.ts` builds it and told to charge. */
const app = await buildServer({
  env: loadEnv({
    ...process.env,
    DATABASE_URL: scratch.url,
    AUTH_SIGNUP: "open",
    BILLING_MODE: "stripe",
    STRIPE_WEBHOOK_SECRET: webhookSecret,
    APP_URL: `http://localhost:${port}`,
    PORT: String(port),
  }),
  logger,
  db,
  queryGenerator: null,
});

await app.listen({ host: "127.0.0.1", port });
say(`api listening on ${port}`);

const listener = spawn("stripe", [
  "listen",
  "--api-key",
  apiKey,
  "--forward-to",
  `http://localhost:${port}/api/billing/webhook`,
  "--skip-verify",
]);

listener.stderr.on("data", (chunk) => {
  const line = String(chunk).trim();
  if (line.includes("Ready!")) say("stripe listen is forwarding");
});

// The CLI needs a moment before it is actually forwarding; a subscription made
// before that is an event nobody receives, and the run would read as a failure
// of the mapping rather than of the timing.
await sleep(4000);

const made: { customers: string[] } = { customers: [] };

async function accountOn(priceId: string, label: string): Promise<string> {
  const userId = `stripe-${label}`;
  await db.insert(users).values({ id: userId, name: userId, email: `${userId}@example.test` });

  const customer = (await stripe("customers", {
    email: `${userId}@example.test`,
    // The account this customer is, the way `createCheckout` records it.
    "metadata[userId]": userId,
  })) as { id: string };

  made.customers.push(customer.id);

  // The account is linked before the subscription exists, exactly as the
  // Checkout route does it: every webhook arrives keyed by the customer and by
  // nothing else.
  await linkStripeCustomer(db, userId, customer.id);

  const method = (await stripe("payment_methods", {
    type: "card",
    "card[token]": "tok_visa",
  })) as { id: string };

  await stripe(`payment_methods/${method.id}/attach`, { customer: customer.id });
  await stripe(`customers/${customer.id}`, {
    "invoice_settings[default_payment_method]": method.id,
  });

  const subscription = (await stripe("subscriptions", {
    customer: customer.id,
    "items[0][price]": priceId,
  })) as { id: string; status: string };

  say(`${label}: subscription ${subscription.id} is ${subscription.status}`);
  return userId;
}

/** Wait for the webhook to land, rather than assuming it has. */
async function planOf(userId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const row = await readSubscription(db, userId);
    if (row?.stripeSubscriptionId) return row.plan;
    await sleep(500);
  }

  return null;
}

try {
  say("");
  say("1. a subscription on the keys-included price");
  const lent = await accountOn(lentPrice, "lent");
  say(`   plan written by the webhook: ${await planOf(lent)}`);

  say("");
  say("2. a subscription on the ordinary price");
  const own = await accountOn(ownPrice, "own");
  say(`   plan written by the webhook: ${await planOf(own)}`);

  say("");
  say("the rows");

  // Read through `readSubscription` rather than a query written here: this app
  // holds no drizzle, and a second copy of the read is a second thing to get
  // wrong about the column this run is about.
  for (const id of [lent, own]) {
    const row = await readSubscription(db, id);
    say(
      `  ${id}: plan=${row?.plan} status=${row?.status} ` +
        `periodEnd=${row?.currentPeriodEnd?.toISOString() ?? "none"}`,
    );
  }
} finally {
  say("");

  for (const customer of made.customers) {
    // Deleting the customer cancels its subscriptions, so this is one call
    // rather than two and it leaves no object behind either way.
    await stripe(`customers/${customer}`, undefined, "DELETE").catch(() => undefined);
    say(`deleted ${customer}`);
  }

  listener.kill();
  await app.close();
  await close();
  await scratch.drop();
  say(`dropped ${scratch.name}`);
}
