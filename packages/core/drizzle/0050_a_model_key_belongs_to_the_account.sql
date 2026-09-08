CREATE TABLE "ai_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"provider" text,
	"ciphertext" text NOT NULL,
	"record" text NOT NULL,
	"hint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_keys_name_not_blank" CHECK (length(btrim("ai_keys"."name")) > 0),
	CONSTRAINT "ai_keys_ciphertext_format" CHECK (ciphertext LIKE 'v1.%.%.%'),
	CONSTRAINT "ai_keys_hint_masked" CHECK (hint LIKE '••••%' AND length(hint) <= 8)
);--> statement-breakpoint

CREATE UNIQUE INDEX "ai_keys_user_name_unique" ON "ai_keys" USING btree ("user_id",lower("name"));--> statement-breakpoint

ALTER TABLE "ai_settings" ADD COLUMN "key_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_key_id_ai_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."ai_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

--> Every key a job holds becomes a key the account holds, named after the job
--> it was pasted on so a person recognises it. One row per job, so the names
--> cannot collide.
-->
--> **The ciphertext and its record travel together, unchanged.** `record` is
--> stored per row and the cipher authenticates what is stored, so moving a row
--> between tables is a move and not a re-encryption. Nobody retypes a key.
INSERT INTO "ai_keys" ("user_id", "name", "provider", "ciphertext", "record", "hint")
SELECT
  "user_id",
  CASE "task"
    WHEN 'classify' THEN 'Scoring key'
    WHEN 'triage' THEN 'Triage key'
    WHEN 'draft' THEN 'Drafting key'
    ELSE 'Similarity key'
  END,
  "provider",
  "ciphertext",
  "record",
  "hint"
  FROM "ai_settings"
 WHERE "ciphertext" IS NOT NULL;--> statement-breakpoint

UPDATE "ai_settings" AS "s"
   SET "key_id" = "k"."id"
  FROM "ai_keys" AS "k"
 WHERE "k"."user_id" = "s"."user_id"
   AND "k"."record" = "s"."record";--> statement-breakpoint

ALTER TABLE "ai_settings" DROP CONSTRAINT "ai_settings_ciphertext_format";--> statement-breakpoint
ALTER TABLE "ai_settings" DROP CONSTRAINT "ai_settings_hint_masked";--> statement-breakpoint
ALTER TABLE "ai_settings" DROP CONSTRAINT "ai_settings_key_complete";--> statement-breakpoint
ALTER TABLE "ai_settings" DROP COLUMN "ciphertext";--> statement-breakpoint
ALTER TABLE "ai_settings" DROP COLUMN "record";--> statement-breakpoint
ALTER TABLE "ai_settings" DROP COLUMN "hint";
