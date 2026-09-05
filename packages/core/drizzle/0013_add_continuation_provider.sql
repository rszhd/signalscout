ALTER TABLE "source_continuations" DROP CONSTRAINT "source_continuations_monitor_source_unique";--> statement-breakpoint
ALTER TABLE "source_continuations" ADD COLUMN "provider" text;--> statement-breakpoint
UPDATE "source_continuations" SET "provider" = 'brightdata' WHERE "provider" IS NULL;--> statement-breakpoint
ALTER TABLE "source_continuations" ALTER COLUMN "provider" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "source_continuations" ADD CONSTRAINT "source_continuations_monitor_source_unique" UNIQUE("monitor_id","source","provider");--> statement-breakpoint
ALTER TABLE "source_continuations" ADD CONSTRAINT "source_continuations_provider_known" CHECK (provider IN ('brightdata', 'scrapecreators'));
