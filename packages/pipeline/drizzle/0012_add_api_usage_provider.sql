ALTER TABLE "api_usage" DROP CONSTRAINT "api_usage_monitor_source_day_unique";--> statement-breakpoint
ALTER TABLE "api_usage" ADD COLUMN "provider" text;--> statement-breakpoint
UPDATE "api_usage" SET "provider" = 'brightdata' WHERE "provider" IS NULL;--> statement-breakpoint
ALTER TABLE "api_usage" ALTER COLUMN "provider" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_monitor_source_day_unique" UNIQUE NULLS NOT DISTINCT("monitor_id","source","provider","day");--> statement-breakpoint
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_provider_known" CHECK (provider IN ('brightdata', 'scrapecreators'));
