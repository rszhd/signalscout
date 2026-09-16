import { loadEnv } from "../config/env.js";
import { runAppMigrations } from "./migrate.js";

const env = loadEnv();

await runAppMigrations(env.DATABASE_URL);

process.stdout.write(`migrations applied to ${new URL(env.DATABASE_URL).pathname.slice(1)}\n`);
