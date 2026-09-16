CREATE TABLE "query_estimate_probes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"estimate_id" uuid NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"term" text NOT NULL,
	"position" integer NOT NULL,
	"status" text DEFAULT 'collecting' NOT NULL,
	"cursor" text,
	"resume_after" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"units" bigint DEFAULT 0 NOT NULL,
	"estimated_cost_micros" bigint DEFAULT 0 NOT NULL,
	"posts_found" integer DEFAULT 0 NOT NULL,
	"capped" boolean DEFAULT false NOT NULL,
	"oldest_post_at" timestamp with time zone,
	"newest_post_at" timestamp with time zone,
	"samples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "query_estimate_probes_term_unique" UNIQUE("estimate_id","source","kind","term"),
	CONSTRAINT "query_estimate_probes_source_known" CHECK (source IN ('reddit', 'x')),
	CONSTRAINT "query_estimate_probes_kind_known" CHECK (kind IN ('query', 'channel')),
	CONSTRAINT "query_estimate_probes_status_known" CHECK (status IN ('collecting', 'ready', 'failed')),
	CONSTRAINT "query_estimate_probes_units_non_negative" CHECK (units >= 0),
	CONSTRAINT "query_estimate_probes_cost_non_negative" CHECK (estimated_cost_micros >= 0),
	CONSTRAINT "query_estimate_probes_posts_non_negative" CHECK (posts_found >= 0),
	CONSTRAINT "query_estimate_probes_attempts_bounded" CHECK (attempts >= 0)
);
--> statement-breakpoint
CREATE TABLE "query_estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid,
	"status" text DEFAULT 'collecting' NOT NULL,
	"poll_interval_seconds" integer NOT NULL,
	"monthly_cap_micros" bigint,
	"units" bigint DEFAULT 0 NOT NULL,
	"estimated_cost_micros" bigint DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "query_estimates_status_known" CHECK (status IN ('collecting', 'ready', 'failed')),
	CONSTRAINT "query_estimates_poll_interval_floor" CHECK (poll_interval_seconds >= 60),
	CONSTRAINT "query_estimates_units_non_negative" CHECK (units >= 0),
	CONSTRAINT "query_estimates_cost_non_negative" CHECK (estimated_cost_micros >= 0)
);
--> statement-breakpoint
ALTER TABLE "api_usage" DROP CONSTRAINT "api_usage_monitor_source_day_unique";--> statement-breakpoint
ALTER TABLE "api_usage" ALTER COLUMN "monitor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "query_estimate_probes" ADD CONSTRAINT "query_estimate_probes_estimate_id_query_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."query_estimates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "query_estimates" ADD CONSTRAINT "query_estimates_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "query_estimate_probes_estimate_idx" ON "query_estimate_probes" USING btree ("estimate_id");--> statement-breakpoint
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_monitor_source_day_unique" UNIQUE NULLS NOT DISTINCT("monitor_id","source","day");