CREATE TABLE "account_key_source" (
	"user_id" text PRIMARY KEY NOT NULL,
	"source" text DEFAULT 'instance' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_key_source_known" CHECK (source IN ('instance', 'own'))
);
--> statement-breakpoint
ALTER TABLE "api_usage" ADD COLUMN "key_source" text DEFAULT 'instance' NOT NULL;--> statement-breakpoint
ALTER TABLE "model_calls" ADD COLUMN "key_source" text DEFAULT 'instance' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_key_source_known" CHECK (key_source IN ('instance', 'own'));--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_key_source_known" CHECK (key_source IN ('instance', 'own'));