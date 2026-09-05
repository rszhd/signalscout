CREATE TABLE "api_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"source" text NOT NULL,
	"day" date NOT NULL,
	"units" bigint DEFAULT 0 NOT NULL,
	"estimated_cost_micros" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_usage_monitor_source_day_unique" UNIQUE("monitor_id","source","day"),
	CONSTRAINT "api_usage_source_known" CHECK (source IN ('reddit', 'x')),
	CONSTRAINT "api_usage_units_non_negative" CHECK (units >= 0),
	CONSTRAINT "api_usage_cost_non_negative" CHECK (estimated_cost_micros >= 0)
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"monitor_id" uuid PRIMARY KEY NOT NULL,
	"monthly_cap_micros" bigint NOT NULL,
	"on_exhausted" text DEFAULT 'pause' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_on_exhausted_known" CHECK (on_exhausted IN ('pause', 'notify')),
	CONSTRAINT "budgets_cap_non_negative" CHECK (monthly_cap_micros >= 0)
);
--> statement-breakpoint
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_usage_monitor_day_idx" ON "api_usage" USING btree ("monitor_id","day");