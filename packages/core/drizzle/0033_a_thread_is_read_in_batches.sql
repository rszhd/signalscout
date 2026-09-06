ALTER TABLE "posts" ADD COLUMN "replies_cursor" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "replies_batch_start" integer;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "replies_empty_batches" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "replies_stopped" text;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_replies_stopped_known" CHECK (replies_stopped IS NULL OR replies_stopped IN ('threshold', 'ceiling', 'budget', 'end'));--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "replies_stopped_at_count" integer;
