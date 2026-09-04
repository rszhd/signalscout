CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"verdict" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "feedback_verdict_known" CHECK (verdict IN ('good', 'not_relevant'))
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"relevance" integer NOT NULL,
	"problem_fit" integer NOT NULL,
	"icp_fit" integer NOT NULL,
	"intent" integer NOT NULL,
	"urgency" integer NOT NULL,
	"intent_type" text NOT NULL,
	"reasons" text[] NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"saved" boolean DEFAULT false NOT NULL,
	"last_verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matches_monitor_post_unique" UNIQUE("monitor_id","post_id"),
	CONSTRAINT "matches_score_range" CHECK (score BETWEEN 0 AND 100),
	CONSTRAINT "matches_relevance_range" CHECK (relevance BETWEEN 0 AND 100),
	CONSTRAINT "matches_problem_fit_range" CHECK (problem_fit BETWEEN 0 AND 100),
	CONSTRAINT "matches_icp_fit_range" CHECK (icp_fit BETWEEN 0 AND 100),
	CONSTRAINT "matches_intent_range" CHECK (intent BETWEEN 0 AND 100),
	CONSTRAINT "matches_urgency_range" CHECK (urgency BETWEEN 0 AND 100),
	CONSTRAINT "matches_intent_type_known" CHECK (intent_type IN ('none', 'problem', 'recommendation_request', 'alternative_search', 'competitor_complaint', 'comparison', 'purchase', 'hiring'))
);
--> statement-breakpoint
CREATE TABLE "monitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"product" text NOT NULL,
	"ideal_customer" text NOT NULL,
	"problem" text NOT NULL,
	"signals" text[] DEFAULT '{}' NOT NULL,
	"generated_queries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generated_subreddits" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"author" text,
	"channel" text,
	"title" text,
	"excerpt" text NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"embedding" vector(1536),
	CONSTRAINT "posts_source_external_id_unique" UNIQUE("source","external_id"),
	CONSTRAINT "posts_source_known" CHECK (source IN ('reddit', 'x'))
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_current_verdict_unique" ON "feedback" USING btree ("match_id","user_id") WHERE superseded_at IS NULL;