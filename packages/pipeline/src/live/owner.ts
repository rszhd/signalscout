/**
 * Whose rows a live script writes.
 *
 * The pipeline owns no users table — US-153 gave it to the application — but
 * a live script runs against a real instance, where that table exists. It is
 * read here with one raw query rather than through the application's schema,
 * because the pipeline must not import the application. The first account is
 * the owner, and no account at all means the rows are still unclaimed.
 */
import { sql } from "drizzle-orm";
import { unclaimedUserId } from "../config/signup.js";
import type { Database } from "../db/client.js";

export async function ownerUserId(db: Database): Promise<string> {
  const { rows } = await db.execute<{ id: string }>(
    sql`select id from users order by created_at asc limit 1`,
  );

  return rows[0]?.id ?? unclaimedUserId;
}

/** The address a live notification goes to: the owner's, read the same way. */
export async function ownerEmail(db: Database, owner: string): Promise<string | undefined> {
  const { rows } = await db.execute<{ email: string | null }>(
    sql`select email from users where id = ${owner}`,
  );

  return rows[0]?.email ?? undefined;
}
