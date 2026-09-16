--> statement-breakpoint
INSERT INTO "projects" ("user_id", "name", "product", "ideal_customer", "problem", "signals")
SELECT DISTINCT ON ("m"."user_id")
  "m"."user_id",
  'Default project',
  "m"."product",
  "m"."ideal_customer",
  "m"."problem",
  "m"."signals"
FROM "monitors" "m"
WHERE "m"."project_id" IS NULL
ORDER BY "m"."user_id", "m"."created_at" DESC;--> statement-breakpoint
UPDATE "monitors" "m"
SET "project_id" = "p"."id"
FROM "projects" "p"
WHERE "m"."project_id" IS NULL
  AND "p"."user_id" = "m"."user_id"
  AND "p"."name" = 'Default project';
