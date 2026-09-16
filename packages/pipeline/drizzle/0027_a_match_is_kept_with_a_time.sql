ALTER TABLE "matches" DROP COLUMN "saved";--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "saved_at" timestamp with time zone;
