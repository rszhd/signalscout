import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { runMigrations } from "../db/migrate.js";

/**
 * Test databases are real Postgres, never an in-memory stand-in. See
 * docs/testing.md: the two pieces this project leans on hardest, pgvector
 * distance and pg-boss claiming a job, are exactly what a fake gets wrong.
 */
const defaultUrl = "postgres://intentwatch:intentwatch@localhost:5432/intentwatch";

export interface TestDatabase {
  url: string;
  name: string;
  drop: () => Promise<void>;
}

function baseUrl(): URL {
  return new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? defaultUrl);
}

async function connectToMaintenanceDatabase(): Promise<Client> {
  const url = baseUrl();
  url.pathname = "/postgres";

  const client = new Client({ connectionString: url.toString() });

  try {
    await client.connect();
  } catch (cause) {
    throw new Error(
      `Cannot reach Postgres at ${url.host}. Start it with \`pnpm db:up\` and try again.`,
      { cause },
    );
  }

  return client;
}

/**
 * Create an empty database with a name nobody else uses, apply every
 * migration, and hand back its URL. One per test file, dropped afterwards.
 */
export async function createTestDatabase(label: string): Promise<TestDatabase> {
  const name = `iw_test_${label.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_${randomBytes(4).toString("hex")}`;
  const admin = await connectToMaintenanceDatabase();

  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }

  const url = baseUrl();
  url.pathname = `/${name}`;
  const databaseUrl = url.toString();

  await runMigrations(databaseUrl);

  return {
    url: databaseUrl,
    name,
    drop: async () => {
      const cleanup = await connectToMaintenanceDatabase();
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}
