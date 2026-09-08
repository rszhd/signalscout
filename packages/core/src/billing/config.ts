/**
 * What this deployment needs before it may charge anybody. US-072.
 *
 * The check here exists for the quiet failure rather than the loud one. An
 * instance whose `BILLING_MODE` is `stripe` but whose price or webhook secret
 * is missing does not break: it serves the whole product, every screen works,
 * every trial runs out and nothing ever asks for money. That is the state this
 * refuses to boot in, and it is the same reasoning `AUTH_SECRET` is refused
 * under — a setting that is wrong in the safe-looking direction is the one
 * nobody notices.
 *
 * `off` needs nothing and checks nothing, because the self-hosted instance is
 * the common one and it must be able to ignore this whole file.
 */
import type { BillingMode } from "./entitlement.js";

export interface BillingEnvironment {
  readonly BILLING_MODE?: BillingMode;
  readonly STRIPE_SECRET_KEY?: string | undefined;
  readonly STRIPE_PRICE_ID?: string | undefined;
  readonly STRIPE_WEBHOOK_SECRET?: string | undefined;
  readonly APP_URL?: string | undefined;
}

export interface BillingSettings {
  readonly mode: BillingMode;
  readonly apiKey: string;
  readonly priceId: string;
  readonly webhookSecret: string;
  /**
   * Where Stripe sends a person back to.
   *
   * Required in `stripe` mode and not derived from the request. Checkout's
   * return address has to be a URL Stripe will accept, and building one from a
   * header is building it from something a caller controls.
   */
  readonly appUrl: string;
}

/** The variables a `stripe` deployment must set, in the order a person reads them. */
export const requiredBillingVariables = [
  "STRIPE_SECRET_KEY",
  "STRIPE_PRICE_ID",
  "STRIPE_WEBHOOK_SECRET",
  "APP_URL",
] as const;

/**
 * The settings, or null when this deployment does not charge.
 *
 * Throws in `stripe` mode when something is missing, naming every missing
 * variable at once rather than one per restart.
 */
export function billingSettingsFrom(env: BillingEnvironment): BillingSettings | null {
  const mode = env.BILLING_MODE ?? "off";
  if (mode === "off") return null;

  const missing = requiredBillingVariables.filter((name) => !env[name]);

  if (missing.length > 0) {
    throw new Error(
      `BILLING_MODE is "stripe", so this instance charges for itself, but ${missing.join(", ")} ` +
        "is not set.\n" +
        "Without it every trial runs out and nobody is ever asked to pay, and every screen " +
        "keeps working.\n" +
        "Set them in .env, or set BILLING_MODE=off to run this instance for free.\n",
    );
  }

  return {
    mode,
    apiKey: env.STRIPE_SECRET_KEY as string,
    priceId: env.STRIPE_PRICE_ID as string,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET as string,
    appUrl: (env.APP_URL as string).replace(/\/+$/, ""),
  };
}
