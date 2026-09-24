CREATE TABLE "post_copies" (
	"monitor_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"card_post_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_copies_monitor_id_post_id_pk" PRIMARY KEY("monitor_id","post_id")
);
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "text_fingerprint" text GENERATED ALWAYS AS (md5(btrim(regexp_replace(lower(coalesce(title, '') || ' ' || excerpt), '[[:space:]]+', ' ', 'g')))) STORED;--> statement-breakpoint
ALTER TABLE "post_copies" ADD CONSTRAINT "post_copies_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_copies" ADD CONSTRAINT "post_copies_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_copies" ADD CONSTRAINT "post_copies_card_post_id_posts_id_fk" FOREIGN KEY ("card_post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_copies_card_idx" ON "post_copies" USING btree ("monitor_id","card_post_id");--> statement-breakpoint
CREATE INDEX "posts_author_fingerprint_idx" ON "posts" USING btree ("source","author","text_fingerprint");