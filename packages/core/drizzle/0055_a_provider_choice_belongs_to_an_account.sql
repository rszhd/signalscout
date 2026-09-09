ALTER TABLE "source_providers" ADD COLUMN "user_id" text DEFAULT 'self-hosted' NOT NULL;--> statement-breakpoint

--> A choice recorded before accounts existed belongs to the first account, if
--> there is one. Same rule as US-017's sign-up hook and as 0044's, applied to
--> the table BUG-009 left behind: the instance upgrading here has one person on
--> it, and their monitors must keep polling through the provider they picked.
--> Where there is no account yet the row keeps 'self-hosted' and the first
--> sign-up claims it, the way a monitor written before the login is claimed.
UPDATE "source_providers"
   SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" ASC LIMIT 1)
 WHERE "user_id" = 'self-hosted'
   AND EXISTS (SELECT 1 FROM "users");--> statement-breakpoint

--> The default was only for the backfill. Leaving it would let a writer that
--> forgot the owner record a choice that decides for an account nobody named,
--> which is the whole of BUG-010 arriving through a different door.
ALTER TABLE "source_providers" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint

ALTER TABLE "source_providers" DROP CONSTRAINT "source_providers_pkey";--> statement-breakpoint
ALTER TABLE "source_providers" ADD CONSTRAINT "source_providers_user_id_source_pk" PRIMARY KEY("user_id","source");
