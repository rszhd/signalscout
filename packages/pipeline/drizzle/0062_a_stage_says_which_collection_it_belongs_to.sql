ALTER TABLE "stage_runs" ADD COLUMN "walk_id" uuid;--> statement-breakpoint
CREATE INDEX "stage_runs_walk_idx" ON "stage_runs" USING btree ("walk_id");