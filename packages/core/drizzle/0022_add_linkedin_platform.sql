ALTER TABLE "api_usage" DROP CONSTRAINT "api_usage_source_known";--> statement-breakpoint
ALTER TABLE "posts" DROP CONSTRAINT "posts_source_known";--> statement-breakpoint
ALTER TABLE "query_estimate_probes" DROP CONSTRAINT "query_estimate_probes_source_known";--> statement-breakpoint
ALTER TABLE "source_continuations" DROP CONSTRAINT "source_continuations_source_known";--> statement-breakpoint
ALTER TABLE "source_providers" DROP CONSTRAINT "source_providers_source_known";--> statement-breakpoint
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_source_known" CHECK (source IN ('reddit', 'x', 'linkedin'));--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_source_known" CHECK (source IN ('reddit', 'x', 'linkedin'));--> statement-breakpoint
ALTER TABLE "query_estimate_probes" ADD CONSTRAINT "query_estimate_probes_source_known" CHECK (source IN ('reddit', 'x', 'linkedin'));--> statement-breakpoint
ALTER TABLE "source_continuations" ADD CONSTRAINT "source_continuations_source_known" CHECK (source IN ('reddit', 'x', 'linkedin'));--> statement-breakpoint
ALTER TABLE "source_providers" ADD CONSTRAINT "source_providers_source_known" CHECK (source IN ('reddit', 'x', 'linkedin'));