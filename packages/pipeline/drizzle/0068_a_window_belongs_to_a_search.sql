ALTER TABLE "source_coverage" ADD COLUMN "query" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_continuations" ADD COLUMN "query" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_continuations" DROP CONSTRAINT "source_continuations_monitor_source_unique";--> statement-breakpoint
ALTER TABLE "source_coverage" DROP CONSTRAINT "source_coverage_monitor_id_source_pk";--> statement-breakpoint
ALTER TABLE "source_coverage" ADD CONSTRAINT "source_coverage_monitor_id_source_query_pk" PRIMARY KEY("monitor_id","source","query");--> statement-breakpoint
ALTER TABLE "source_continuations" ADD CONSTRAINT "source_continuations_monitor_source_unique" UNIQUE("monitor_id","source","provider","query");
