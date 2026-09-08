CREATE TABLE "ai_settings" (
	"user_id" text NOT NULL,
	"task" text NOT NULL,
	"provider" text,
	"model" text,
	"base_url" text,
	"input_price_micros" integer,
	"output_price_micros" integer,
	"ciphertext" text,
	"record" text,
	"hint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_settings_user_id_task_pk" PRIMARY KEY("user_id","task"),
	CONSTRAINT "ai_settings_task_known" CHECK (task IN ('classify', 'triage', 'embed')),
	CONSTRAINT "ai_settings_ciphertext_format" CHECK (ciphertext IS NULL OR ciphertext LIKE 'v1.%.%.%'),
	CONSTRAINT "ai_settings_hint_masked" CHECK (hint IS NULL OR (hint LIKE '••••%' AND length(hint) <= 8)),
	CONSTRAINT "ai_settings_key_complete" CHECK ((ciphertext IS NULL) = (record IS NULL) AND (ciphertext IS NULL) = (hint IS NULL))
);
--> statement-breakpoint
CREATE INDEX "ai_settings_user_idx" ON "ai_settings" USING btree ("user_id");
