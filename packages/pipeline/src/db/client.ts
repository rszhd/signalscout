import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export type Database = ReturnType<typeof createDatabase>["db"];

/**
 * The handle inside `db.transaction`, which is not the same type as the pool
 * handle above.
 *
 * `Queryable` is what a helper takes when its caller may be either. The
 * classify step needs one: BUG-003 made the model-call row the record of what
 * has been scored, so that row and the match it produces have to be written
 * together or not at all.
 */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Queryable = Database | Transaction;

/**
 * How many connections one pool may hold, when something says.
 *
 * `pg` and `pg-boss` both default to ten, which is right for the two
 * long-lived processes this product runs and wrong for a test suite. `pnpm
 * test` creates a database per test file and runs the files in parallel:
 * fifty-five files wanting ten connections each — twenty, in a file that also
 * starts a queue — ask a server configured for one hundred, and one file loses
 * with "sorry, too many clients already". The failing file moves between runs
 * and every one of them passes alone, so it reads as a flaky test rather than
 * as what it is.
 *
 * `vitest.config.ts` sets this, the way it blanks the model keys: a property
 * of the setup rather than of the code each test happens to call. Nothing sets
 * it in production, where ten is the number we want.
 *
 * With this cap and `maxWorkers: 6` beside it, a full run peaks at 57
 * connections of the 100 — measured on 2026-09-06, not assumed.
 *
 * Spread it into the options rather than passing a number, so an unset
 * variable leaves each library on its own default instead of on ours.
 */
export function poolOptions(): { max?: number } {
  const configured = Number(process.env.DATABASE_POOL_SIZE);

  return Number.isInteger(configured) && configured > 0 ? { max: configured } : {};
}

export interface DatabaseOptions {
  /**
   * Told when a connection this pool is not using fails. Optional, because a
   * one-off script has nowhere useful to say it; the listener is attached
   * either way, and that is the part that matters.
   */
  onError?: (error: Error) => void;
}

/**
 * Open a connection pool and the Drizzle handle over it.
 *
 * The caller owns the pool and must `close()` it. Nothing here opens a
 * connection on import, so a test file can hold several databases at once.
 */
export function createDatabase(databaseUrl: string, { onError }: DatabaseOptions = {}) {
  const pool = new Pool({ connectionString: databaseUrl, ...poolOptions() });

  /**
   * `pg` emits this on an IDLE client, so no query is waiting to receive it.
   * With no listener here Node treats it as an unhandled error and ends the
   * process — the API and the worker both die, having served every request
   * correctly up to that moment.
   *
   * It arrives whenever Postgres closes a connection we are not using: a
   * restart, a failover, an administrator running `pg_terminate_backend`, a
   * connection pooler timing an idle session out. None of those is a reason
   * for this process to stop. The pool opens a replacement on its own, so
   * there is nothing to repair here — only something to catch.
   */
  pool.on("error", (error) => onError?.(error));

  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    close: () => pool.end(),
  };
}
