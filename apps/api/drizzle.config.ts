import { defineConfig } from "drizzle-kit";

/**
 * The application's own migration stream, beside the pipeline's. US-153.
 * `migrations.table` is what keeps the two apart in one database.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  migrations: { table: "__app_migrations", schema: "drizzle" },
  dbCredentials: {
    url:
      process.env.DATABASE_URL ?? "postgres://intentwatch:intentwatch@localhost:5432/intentwatch",
  },
});
