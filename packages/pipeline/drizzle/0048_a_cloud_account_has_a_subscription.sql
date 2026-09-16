--> US-072. One row per account, in a deployment that charges.
--> No row is normal: self-hosted it means billing is off, hosted it means an
--> account older than this table. `entitlementFor` reads both as entitled.
CREATE TABLE "subscriptions" (
  "user_id" text PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "status" text NOT NULL,
  "trial_ends_at" timestamp with time zone,
  "stripe_customer_id" text UNIQUE,
  "stripe_subscription_id" text UNIQUE,
  "current_period_end" timestamp with time zone,
  "cancel_at_period_end" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
--> A value added to a TypeScript array is not a value the database accepts.
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_status_known"
  CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'incomplete'));--> statement-breakpoint
--> A trial with no deadline is not a trial.
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_trial_has_an_end"
  CHECK (status <> 'trialing' OR trial_ends_at IS NOT NULL);
