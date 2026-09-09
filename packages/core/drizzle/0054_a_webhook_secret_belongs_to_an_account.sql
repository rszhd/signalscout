CREATE TABLE "webhook_secrets" (
	"user_id" text PRIMARY KEY NOT NULL,
	"ciphertext" text NOT NULL,
	"record" text NOT NULL,
	"hint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_secrets_ciphertext_format" CHECK (ciphertext LIKE 'v1.%.%.%'),
	CONSTRAINT "webhook_secrets_hint_masked" CHECK (hint LIKE '••••%' AND length(hint) <= 8)
);
