ALTER TABLE "filter_drops" DROP CONSTRAINT "filter_drops_stage_known";--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "text_partial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "partial_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "filter_drops" ADD CONSTRAINT "filter_drops_stage_known" CHECK (stage IN ('keyword', 'embedding', 'triage', 'ceiling', 'match_cap', 'old_thread'));