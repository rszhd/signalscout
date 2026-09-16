CREATE TABLE "filter_drops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"similarity" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "filter_drops_monitor_post_unique" UNIQUE("monitor_id","post_id"),
	CONSTRAINT "filter_drops_stage_known" CHECK (stage IN ('keyword', 'embedding')),
	CONSTRAINT "filter_drops_similarity_range" CHECK (similarity IS NULL OR similarity BETWEEN -1 AND 1)
);
--> statement-breakpoint
ALTER TABLE "model_calls" DROP CONSTRAINT "model_calls_purpose_known";--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "pre_filter_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "similarity_threshold" real DEFAULT 0.15 NOT NULL;--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "description_embedding" vector(1536);--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "description_embedding_source" text;--> statement-breakpoint
ALTER TABLE "filter_drops" ADD CONSTRAINT "filter_drops_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filter_drops" ADD CONSTRAINT "filter_drops_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "filter_drops_monitor_stage_idx" ON "filter_drops" USING btree ("monitor_id","stage");--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_purpose_known" CHECK (purpose IN ('classification', 'query_generation', 'embedding'));--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_similarity_threshold_range" CHECK (similarity_threshold BETWEEN 0 AND 1);