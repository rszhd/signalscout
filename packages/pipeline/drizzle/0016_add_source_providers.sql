CREATE TABLE "source_providers" (
	"source" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_providers_source_known" CHECK (source IN ('reddit', 'x')),
	CONSTRAINT "source_providers_provider_known" CHECK (provider IN ('brightdata', 'scrapecreators'))
);
