--> A value added to a TypeScript array is not a value the database accepts.
--> US-057 and US-040 both shipped one without this line, and both were found by
--> a live run rather than by 1,300 passing tests.
ALTER TABLE "ai_settings" DROP CONSTRAINT "ai_settings_task_known";--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_task_known"
  CHECK (task IN ('classify', 'triage', 'embed', 'draft'));
