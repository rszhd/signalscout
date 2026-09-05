CREATE TABLE "post_verifications" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"monitor_id" uuid,
	"provider" text NOT NULL,
	"cursor" text,
	"next_attempt_at" timestamp with time zone NOT NULL,
	CONSTRAINT "post_verifications_provider_known" CHECK (provider IN ('brightdata', 'scrapecreators'))
);
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "post_verifications" ADD CONSTRAINT "post_verifications_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_verifications" ADD CONSTRAINT "post_verifications_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Correctness-critical: late classifications must not resurrect a deleted post.
-- The shared row lock orders a concurrent insert against deletion's post update.
CREATE FUNCTION hide_deleted_post_match() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE removed_at timestamptz;
BEGIN
  SELECT deleted_at INTO removed_at FROM posts WHERE id = NEW.post_id FOR SHARE;
  IF removed_at IS NOT NULL THEN NEW.hidden := true; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER matches_honor_post_deletion BEFORE INSERT OR UPDATE OF hidden, post_id ON matches
FOR EACH ROW EXECUTE FUNCTION hide_deleted_post_match();
