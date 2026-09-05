ALTER TABLE "posts" ADD COLUMN "kind" text DEFAULT 'post' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "parent_post_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "parent_reply_external_id" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "reply_count" integer;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "replies_partial" boolean;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_parent_post_id_posts_id_fk" FOREIGN KEY ("parent_post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_kind_known" CHECK (kind IN ('post', 'reply'));--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_reply_has_parent" CHECK ((kind = 'post' AND parent_post_id IS NULL) OR (kind = 'reply' AND parent_post_id IS NOT NULL));--> statement-breakpoint
CREATE INDEX "posts_parent_idx" ON "posts" USING btree ("parent_post_id");--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "include_replies" boolean DEFAULT false NOT NULL;
