ALTER TABLE "monitors" ADD COLUMN "sources" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "poll_interval_seconds" integer DEFAULT 3600 NOT NULL;--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "last_polled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_poll_interval_floor" CHECK (poll_interval_seconds >= 60);