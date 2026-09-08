--> A value added to an array in `schema.ts` is not a value the database
--> accepts. This repository has shipped that mistake twice — `apify` in US-057
--> and `draft_reply` in US-040 — and both times a full suite passed and a live
--> run found it after the money was spent. `key_test` is the third value, and
--> this is the constraint it needs.
ALTER TABLE "model_calls" DROP CONSTRAINT "model_calls_purpose_known";--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_purpose_known" CHECK (purpose IN ('classification', 'query_generation', 'embedding', 'triage', 'project_analysis', 'draft_reply', 'key_test'));
