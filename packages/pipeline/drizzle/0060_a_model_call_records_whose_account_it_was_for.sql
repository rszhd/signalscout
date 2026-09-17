-- US-162. Whose bill a model call lands on, so an account's month can be
-- summed without a monitor in between: a draft, a query generation and a key
-- test have none.
ALTER TABLE "model_calls" ADD COLUMN "user_id" text;--> statement-breakpoint
CREATE INDEX "model_calls_user_created_idx" ON "model_calls" USING btree ("user_id","created_at");--> statement-breakpoint
-- Backfill from the monitor where there is one. A row with no monitor and no
-- owner stays null: it was a draft or a query written before this column, and
-- nobody can now say whose it was. accountSpend counts nothing it cannot
-- attribute, so a null here is a call that is on no account's month rather
-- than on the wrong one.
UPDATE "model_calls" SET "user_id" = "monitors"."user_id"
  FROM "monitors"
  WHERE "model_calls"."monitor_id" = "monitors"."id" AND "model_calls"."user_id" IS NULL;
