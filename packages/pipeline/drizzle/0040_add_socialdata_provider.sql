ALTER TABLE "api_usage" DROP CONSTRAINT "api_usage_provider_known";--> statement-breakpoint
ALTER TABLE "posts" DROP CONSTRAINT "posts_provider_known";--> statement-breakpoint
ALTER TABLE "query_estimate_probes" DROP CONSTRAINT "query_estimate_probes_provider_known";--> statement-breakpoint
ALTER TABLE "source_continuations" DROP CONSTRAINT "source_continuations_provider_known";--> statement-breakpoint
ALTER TABLE "source_credentials" DROP CONSTRAINT "source_credentials_provider_known";--> statement-breakpoint
ALTER TABLE "source_providers" DROP CONSTRAINT "source_providers_provider_known";--> statement-breakpoint
ALTER TABLE "post_verifications" DROP CONSTRAINT "post_verifications_provider_known";--> statement-breakpoint
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_provider_known" CHECK (provider IN ('brightdata', 'scrapecreators', 'socialcrawl', 'apify', 'socialdata'));--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_provider_known" CHECK (provider IS NULL OR provider IN ('brightdata', 'scrapecreators', 'socialcrawl', 'apify', 'socialdata'));--> statement-breakpoint
ALTER TABLE "query_estimate_probes" ADD CONSTRAINT "query_estimate_probes_provider_known" CHECK (provider IS NULL OR provider IN ('brightdata', 'scrapecreators', 'socialcrawl', 'apify', 'socialdata'));--> statement-breakpoint
ALTER TABLE "source_continuations" ADD CONSTRAINT "source_continuations_provider_known" CHECK (provider IN ('brightdata', 'scrapecreators', 'socialcrawl', 'apify', 'socialdata'));--> statement-breakpoint
ALTER TABLE "source_credentials" ADD CONSTRAINT "source_credentials_provider_known" CHECK (provider IN ('brightdata', 'scrapecreators', 'socialcrawl', 'apify', 'socialdata'));--> statement-breakpoint
ALTER TABLE "source_providers" ADD CONSTRAINT "source_providers_provider_known" CHECK (provider IN ('brightdata', 'scrapecreators', 'socialcrawl', 'apify', 'socialdata'));--> statement-breakpoint
ALTER TABLE "post_verifications" ADD CONSTRAINT "post_verifications_provider_known" CHECK (provider IN ('brightdata', 'scrapecreators', 'socialcrawl', 'apify', 'socialdata'));
