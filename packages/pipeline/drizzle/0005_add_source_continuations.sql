CREATE TABLE "source_continuations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"source" text NOT NULL,
	"cursor" text NOT NULL,
	"since" timestamp with time zone,
	"resume_after" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_continuations_monitor_source_unique" UNIQUE("monitor_id","source"),
	CONSTRAINT "source_continuations_source_known" CHECK (source IN ('reddit', 'x')),
	CONSTRAINT "source_continuations_attempts_bounded" CHECK (attempts >= 0)
);
--> statement-breakpoint
ALTER TABLE "source_continuations" ADD CONSTRAINT "source_continuations_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;