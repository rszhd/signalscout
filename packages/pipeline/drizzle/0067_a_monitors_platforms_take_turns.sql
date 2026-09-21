ALTER TABLE "monitors" ADD COLUMN "poll_credits_per_hour" numeric(8, 3);--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "poll_credit_balance" numeric(8, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "poll_cursor" integer DEFAULT 0 NOT NULL;