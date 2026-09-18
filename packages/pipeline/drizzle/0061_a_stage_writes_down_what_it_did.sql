CREATE TABLE "stage_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"stage" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" text NOT NULL,
	"items_in" integer DEFAULT 0 NOT NULL,
	"items_out" integer DEFAULT 0 NOT NULL,
	"units" bigint DEFAULT 0 NOT NULL,
	"estimated_cost_micros" bigint DEFAULT 0 NOT NULL,
	"detail" jsonb,
	"stop_reason" text,
	CONSTRAINT "stage_runs_stage_known" CHECK (stage IN ('filter', 'replies', 'classify', 'notify')),
	CONSTRAINT "stage_runs_outcome_known" CHECK (outcome IN ('done', 'empty', 'refused', 'failed')),
	CONSTRAINT "stage_runs_stop_reason_known" CHECK (stop_reason IS NULL OR stop_reason IN ('budget_exhausted', 'no_model', 'no_credentials', 'error')),
	CONSTRAINT "stage_runs_counts_non_negative" CHECK (items_in >= 0 AND items_out >= 0),
	CONSTRAINT "stage_runs_spend_non_negative" CHECK (units >= 0 AND estimated_cost_micros >= 0)
);
--> statement-breakpoint
ALTER TABLE "stage_runs" ADD CONSTRAINT "stage_runs_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stage_runs_monitor_started_idx" ON "stage_runs" USING btree ("monitor_id","started_at");