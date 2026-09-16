-- BUG-003. The classify step skipped a post it had already paid for by asking
-- whether the post had a row in `matches`. A post scored below the monitor's
-- `min_score` writes no match, so the skip never saw it and the next poll
-- bought the same answer again. On the development database 75 of 229 pairs
-- were classified twice, and 72 of those had no match row.
--
-- The skip now reads `model_calls`, which records every call whatever it
-- scored. It has to read the version too: `monitors.version` counts edits to
-- the four fields the system prompt is built from, so a post scored under
-- version 1 has not been asked version 2's question.
ALTER TABLE "model_calls" ADD COLUMN "monitor_version" integer;--> statement-breakpoint

-- Every existing classification is recorded as version 1.
--
-- Versions only increase, so a monitor still at version 1 has never been
-- edited and every row belonging to it was written at version 1: for those the
-- backfill is exact. For a monitor that has since been edited the row could
-- have been written at any version, and saying 1 makes the next poll score
-- that post once more. That is the safe direction. The other one — writing the
-- monitor's current version — would claim an answer to a question the model
-- was never asked, and skip the post for good.
UPDATE "model_calls" SET "monitor_version" = 1 WHERE "purpose" = 'classification';--> statement-breakpoint

ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_classification_versioned" CHECK (purpose <> 'classification' OR monitor_version IS NOT NULL);
