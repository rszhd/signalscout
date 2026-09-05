CREATE TABLE "source_credentials" (
	"source" text NOT NULL,
	"field" text NOT NULL,
	"ciphertext" text NOT NULL,
	"hint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_credentials_source_field_pk" PRIMARY KEY("source","field"),
	CONSTRAINT "source_credentials_source_known" CHECK (source IN ('reddit', 'x')),
	CONSTRAINT "source_credentials_ciphertext_format" CHECK (ciphertext LIKE 'v1.%.%.%'),
	CONSTRAINT "source_credentials_hint_masked" CHECK (hint LIKE '••••%' AND length(hint) <= 8)
);
