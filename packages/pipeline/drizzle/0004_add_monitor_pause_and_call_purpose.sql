ALTER TABLE "model_calls" ADD COLUMN "purpose" text DEFAULT 'classification' NOT NULL;--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_purpose_known" CHECK (purpose IN ('classification', 'query_generation'));