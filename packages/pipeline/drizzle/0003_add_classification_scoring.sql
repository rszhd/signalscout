CREATE TABLE "model_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid,
	"post_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"outcome" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer NOT NULL,
	"estimated_cost_micros" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_calls_outcome_known" CHECK (outcome IN ('scored', 'rejected', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "min_score" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_calls_monitor_post_idx" ON "model_calls" USING btree ("monitor_id","post_id");--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_min_score_range" CHECK (min_score BETWEEN 0 AND 100);