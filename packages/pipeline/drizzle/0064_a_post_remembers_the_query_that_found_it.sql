CREATE TABLE "post_discoveries" (
	"monitor_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_discoveries_monitor_id_post_id_kind_value_pk" PRIMARY KEY("monitor_id","post_id","kind","value"),
	CONSTRAINT "post_discoveries_kind_known" CHECK (kind IN ('query', 'channel'))
);
--> statement-breakpoint
ALTER TABLE "post_discoveries" ADD CONSTRAINT "post_discoveries_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_discoveries" ADD CONSTRAINT "post_discoveries_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_discoveries_monitor_value_idx" ON "post_discoveries" USING btree ("monitor_id","kind","value");--> statement-breakpoint
CREATE INDEX "post_discoveries_post_idx" ON "post_discoveries" USING btree ("post_id");