ALTER TABLE "poll_runs" DROP CONSTRAINT "poll_runs_stop_reason_known";--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "key_source" text DEFAULT 'instance' NOT NULL;--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_key_source_known" CHECK (key_source IN ('instance', 'own'));--> statement-breakpoint
ALTER TABLE "poll_runs" ADD CONSTRAINT "poll_runs_stop_reason_known" CHECK (stop_reason IS NULL OR stop_reason IN ('budget_exhausted', 'account_budget_exhausted', 'no_credentials', 'no_provider_choice', 'not_offered', 'resume_key_missing', 'collection_abandoned', 'provider_wait', 'page_cap', 'still_collecting', 'platform_not_due', 'other_keys', 'error'));--> statement-breakpoint
UPDATE "monitors" SET "key_source" = "account_key_source"."source"
  FROM "account_key_source"
  WHERE "account_key_source"."user_id" = "monitors"."user_id";
