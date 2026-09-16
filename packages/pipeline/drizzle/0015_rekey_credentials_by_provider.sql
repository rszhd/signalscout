ALTER TABLE "source_credentials" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "source_credentials" ADD COLUMN "record" text;--> statement-breakpoint
UPDATE "source_credentials" SET "record" = "source" || ':' || "field" WHERE "record" IS NULL;--> statement-breakpoint
UPDATE "source_credentials" SET "provider" = 'brightdata' WHERE "provider" IS NULL AND "source" = 'reddit';--> statement-breakpoint
ALTER TABLE "source_credentials" ALTER COLUMN "provider" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "source_credentials" ALTER COLUMN "record" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "source_credentials" DROP CONSTRAINT "source_credentials_source_known";--> statement-breakpoint
ALTER TABLE "source_credentials" DROP CONSTRAINT "source_credentials_source_field_pk";--> statement-breakpoint
ALTER TABLE "source_credentials" ADD CONSTRAINT "source_credentials_provider_field_pk" PRIMARY KEY("provider","field");--> statement-breakpoint
ALTER TABLE "source_credentials" DROP COLUMN "source";--> statement-breakpoint
ALTER TABLE "source_credentials" ADD CONSTRAINT "source_credentials_provider_known" CHECK (provider IN ('brightdata', 'scrapecreators'));
