ALTER TABLE "model_calls" DROP CONSTRAINT "model_calls_purpose_known";--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_purpose_known" CHECK (purpose IN ('classification', 'query_generation', 'embedding', 'triage', 'project_analysis', 'draft_reply'));
