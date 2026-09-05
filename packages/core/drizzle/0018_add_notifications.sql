CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"channel" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_items" (
	"delivery_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "notification_items_match_id_channel_kind_pk" PRIMARY KEY("match_id","channel","kind")
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"monitor_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"email_enabled" boolean DEFAULT false NOT NULL,
	"email_to" text DEFAULT '' NOT NULL,
	"digest_hours" integer DEFAULT 24 NOT NULL,
	"min_score" integer DEFAULT 50 NOT NULL,
	"immediate_score" integer,
	"webhook_enabled" boolean DEFAULT false NOT NULL,
	"webhook_url" text DEFAULT '' NOT NULL,
	"webhook_mode" text DEFAULT 'digest' NOT NULL,
	"webhook_failures" integer DEFAULT 0 NOT NULL,
	"webhook_error" text,
	"email_error" text,
	"enabled_since" timestamp with time zone DEFAULT now() NOT NULL,
	"next_digest_at" timestamp with time zone NOT NULL,
	CONSTRAINT "notification_digest_hours_range" CHECK ("notification_settings"."digest_hours" BETWEEN 1 AND 168),
	CONSTRAINT "notification_min_score_range" CHECK ("notification_settings"."min_score" BETWEEN 0 AND 100),
	CONSTRAINT "notification_immediate_score_range" CHECK ("notification_settings"."immediate_score" BETWEEN 0 AND 100),
	CONSTRAINT "notification_webhook_mode_known" CHECK ("notification_settings"."webhook_mode" IN ('match', 'digest'))
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_items" ADD CONSTRAINT "notification_items_delivery_id_notification_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."notification_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_items" ADD CONSTRAINT "notification_items_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_deliveries_due_idx" ON "notification_deliveries" USING btree ("monitor_id","next_attempt_at") WHERE status = 'pending';