ALTER TABLE "monitors" ADD COLUMN "poll_days" smallint[] DEFAULT '{0,1,2,3,4,5,6}' NOT NULL;--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "poll_timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_poll_days_valid" CHECK (cardinality(poll_days) > 0 AND poll_days <@ ARRAY[0,1,2,3,4,5,6]::smallint[]);
