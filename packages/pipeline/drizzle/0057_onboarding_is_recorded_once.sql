CREATE TABLE "user_onboarding" (
	"user_id" text PRIMARY KEY NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

--> The backfill. Every account that exists when this runs was created before
--> the marker existed, and none of them is a new account: the instance was
--> already running and somebody was using it. On a fresh database this inserts
--> nothing, so the first account of a new install still meets the setup gate.
--> US-105.
INSERT INTO "user_onboarding" ("user_id") SELECT "id" FROM "users";
