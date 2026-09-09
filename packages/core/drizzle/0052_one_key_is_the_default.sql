--> One key an account's jobs run on until a job says otherwise. US-083.
ALTER TABLE "ai_keys" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint

--> One default per account, and the database is what makes it one.
--> A writer that forgot to clear the previous default would leave two rows
--> claiming it, and every screen would show whichever the ordering returned.
--> Partial, because `false` is the ordinary state and there are many of those.
CREATE UNIQUE INDEX "ai_keys_user_default_unique" ON "ai_keys" USING btree ("user_id") WHERE "is_default";--> statement-breakpoint

--> **Nothing is backfilled, on purpose.**
-->
--> Marking an existing account's only key as the default would move every job
--> that has no settings row of its own — which is most of them — onto that key
--> and onto this build's recommended models. That is a different provider, a
--> different model and a different bill, arriving on an instance that was
--> working, through an upgrade nobody read a note about.
-->
--> So every existing key is `false`, every existing account keeps the exact
--> behaviour it had, and a person who wants the new one presses the button on
--> the Models screen. The default is set automatically only on the first key
--> added to an account that has none, where there is no behaviour to change.
