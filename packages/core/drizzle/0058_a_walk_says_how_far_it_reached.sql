CREATE TABLE "source_coverage" (
	"monitor_id" uuid NOT NULL,
	"source" text NOT NULL,
	"covered_through" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_coverage_monitor_id_source_pk" PRIMARY KEY("monitor_id","source"),
	CONSTRAINT "source_coverage_source_known" CHECK (source IN ('reddit', 'x', 'linkedin', 'youtube', 'tiktok', 'instagram'))
);
--> statement-breakpoint
ALTER TABLE "source_coverage" ADD CONSTRAINT "source_coverage_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Seed every monitor that has already polled. BUG-017.
--
-- Without this, the first poll after the upgrade finds no coverage row and
-- collects with no window at all — one unwindowed walk per monitor per
-- platform, at a provider that bills the page. Nothing would be lost, because
-- `posts` deduplicates, but the bill would arrive without anyone choosing it.
--
-- `last_polled_at` is exactly what the window used to be, so seeding from it
-- makes the first poll after the upgrade behave as the last one before it.
INSERT INTO "source_coverage" ("monitor_id", "source", "covered_through")
SELECT "id", unnest("sources"), "last_polled_at"
FROM "monitors"
WHERE "last_polled_at" IS NOT NULL
ON CONFLICT DO NOTHING;
