ALTER TABLE "source_credentials" ADD COLUMN "user_id" text DEFAULT 'self-hosted' NOT NULL;--> statement-breakpoint
ALTER TABLE "query_estimates" ADD COLUMN "user_id" text DEFAULT 'self-hosted' NOT NULL;--> statement-breakpoint

--> The rows that predate accounts belong to the first account, if there is one.
--> Same rule as US-017's sign-up hook, applied to the tables it did not cover:
--> an instance upgrading with a key already stored must keep polling.
UPDATE "source_credentials"
   SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" ASC LIMIT 1)
 WHERE "user_id" = 'self-hosted'
   AND EXISTS (SELECT 1 FROM "users");--> statement-breakpoint

--> An estimate whose monitor still exists belongs to that monitor's owner,
--> which is more precise than the first account and is the same on every
--> instance that has only one.
UPDATE "query_estimates" AS "e"
   SET "user_id" = "m"."user_id"
  FROM "monitors" AS "m"
 WHERE "m"."id" = "e"."monitor_id";--> statement-breakpoint

UPDATE "query_estimates"
   SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" ASC LIMIT 1)
 WHERE "user_id" = 'self-hosted'
   AND EXISTS (SELECT 1 FROM "users");--> statement-breakpoint

--> The default was only for the backfill. Leaving it would let a writer that
--> forgot the owner store a key nobody can reach and nothing can poll with.
ALTER TABLE "source_credentials" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "query_estimates" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint

ALTER TABLE "source_credentials" DROP CONSTRAINT "source_credentials_provider_field_pk";--> statement-breakpoint
ALTER TABLE "source_credentials" ADD CONSTRAINT "source_credentials_user_id_provider_field_pk" PRIMARY KEY("user_id","provider","field");--> statement-breakpoint

CREATE INDEX "query_estimates_user_id_idx" ON "query_estimates" USING btree ("user_id");
