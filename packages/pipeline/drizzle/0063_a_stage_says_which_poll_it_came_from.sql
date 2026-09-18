ALTER TABLE "stage_runs" ADD COLUMN "poll_run_id" uuid;--> statement-breakpoint
ALTER TABLE "stage_runs" ADD CONSTRAINT "stage_runs_poll_run_id_poll_runs_id_fk" FOREIGN KEY ("poll_run_id") REFERENCES "public"."poll_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stage_runs_poll_run_idx" ON "stage_runs" USING btree ("poll_run_id");