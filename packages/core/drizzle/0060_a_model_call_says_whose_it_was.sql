ALTER TABLE "model_calls" ADD COLUMN "user_id" text;--> statement-breakpoint
CREATE INDEX "model_calls_user_created_idx" ON "model_calls" USING btree ("user_id","created_at");--> statement-breakpoint
-- Every row that has a monitor gets that monitor's owner. US-129.
--
-- The rows with no monitor cannot be attributed now: query generation, a
-- project drafted from a document and a drafted reply each belong to an
-- account this table never recorded. They stay null, which reads as "before
-- this column existed" rather than as a guess.
UPDATE "model_calls"
SET "user_id" = "monitors"."user_id"
FROM "monitors"
WHERE "model_calls"."monitor_id" = "monitors"."id"
  AND "model_calls"."user_id" IS NULL;
