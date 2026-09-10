CREATE TABLE "poll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"walk_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" text NOT NULL,
	"posts_returned" integer DEFAULT 0 NOT NULL,
	"posts_new" integer DEFAULT 0 NOT NULL,
	"units" bigint DEFAULT 0 NOT NULL,
	"estimated_cost_micros" bigint DEFAULT 0 NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stop_reason" text,
	CONSTRAINT "poll_runs_outcome_known" CHECK (outcome IN ('collected', 'empty', 'refused', 'waiting', 'failed')),
	CONSTRAINT "poll_runs_stop_reason_known" CHECK (stop_reason IS NULL OR stop_reason IN ('budget_exhausted', 'no_credentials', 'no_provider_choice', 'not_offered', 'resume_key_missing', 'collection_abandoned', 'provider_wait', 'page_cap', 'still_collecting', 'error')),
	CONSTRAINT "poll_runs_counts_non_negative" CHECK (posts_returned >= 0 AND posts_new >= 0),
	CONSTRAINT "poll_runs_new_within_returned" CHECK (posts_new <= posts_returned),
	CONSTRAINT "poll_runs_spend_non_negative" CHECK (units >= 0 AND estimated_cost_micros >= 0)
);
--> statement-breakpoint
ALTER TABLE "poll_runs" ADD CONSTRAINT "poll_runs_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "poll_runs_monitor_started_idx" ON "poll_runs" USING btree ("monitor_id","started_at");--> statement-breakpoint
CREATE INDEX "poll_runs_walk_idx" ON "poll_runs" USING btree ("walk_id");