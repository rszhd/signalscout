ALTER TABLE "feedback" ADD COLUMN "monitor_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "monitor_version" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_monitor_current_idx" ON "feedback" USING btree ("monitor_id","verdict") WHERE superseded_at IS NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_monitor_version_positive" CHECK (monitor_version >= 1);