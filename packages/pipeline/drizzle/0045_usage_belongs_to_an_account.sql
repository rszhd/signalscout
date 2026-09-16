ALTER TABLE "api_usage" ADD COLUMN "user_id" text DEFAULT 'self-hosted' NOT NULL;--> statement-breakpoint

--> A row with a monitor belongs to that monitor's owner. That is every row on
--> an instance that has ever polled, and it is exact rather than a guess.
UPDATE "api_usage" AS "u"
   SET "user_id" = "m"."user_id"
  FROM "monitors" AS "m"
 WHERE "m"."id" = "u"."monitor_id";--> statement-breakpoint

--> A row with no monitor is a cost test, bought before a monitor existed. It
--> belongs to the first account, the same rule US-017's sign-up hook uses.
UPDATE "api_usage"
   SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" ASC LIMIT 1)
 WHERE "monitor_id" IS NULL
   AND "user_id" = 'self-hosted'
   AND EXISTS (SELECT 1 FROM "users");--> statement-breakpoint

ALTER TABLE "api_usage" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint

ALTER TABLE "api_usage" DROP CONSTRAINT "api_usage_monitor_source_day_unique";--> statement-breakpoint
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_monitor_source_day_unique"
  UNIQUE NULLS NOT DISTINCT ("user_id","monitor_id","source","provider","day");--> statement-breakpoint

CREATE INDEX "api_usage_user_day_idx" ON "api_usage" USING btree ("user_id","day");
