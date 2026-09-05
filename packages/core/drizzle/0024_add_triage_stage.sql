ALTER TABLE "filter_drops" DROP CONSTRAINT "filter_drops_stage_known";--> statement-breakpoint
ALTER TABLE "filter_drops" ADD CONSTRAINT "filter_drops_stage_known" CHECK (stage IN ('keyword', 'embedding', 'triage'));--> statement-breakpoint
ALTER TABLE "model_calls" DROP CONSTRAINT "model_calls_purpose_known";--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_purpose_known" CHECK (purpose IN ('classification', 'query_generation', 'embedding', 'triage'));
