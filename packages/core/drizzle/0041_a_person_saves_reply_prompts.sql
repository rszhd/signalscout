CREATE TABLE "reply_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"instruction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reply_prompts_name_not_blank" CHECK (length(btrim(name)) > 0),
	CONSTRAINT "reply_prompts_instruction_not_blank" CHECK (length(btrim(instruction)) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "reply_prompts_user_name_unique" ON "reply_prompts" ("user_id", lower("name"));
