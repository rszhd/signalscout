/**
 * How far forward a monitor's collection reaches, per platform. BUG-017.
 *
 * This is the window a **new** walk is opened with. It is deliberately not
 * `monitors.last_polled_at`: that mark says when a job last ran, which the poll
 * interval needs, and it moves on every resume of a walk that is still paging.
 * Reading it as a window handed each new walk a gap-between-polls of history —
 * one minute on the production instance — and forty searches were then bought
 * against it and thrown away.
 *
 * A row is written when a walk **finishes**, holding the moment that walk
 * *started*. Erring early is the safe direction: `posts` is deduplicated, so a
 * window that is too wide costs a page and loses nothing, where one that is too
 * narrow drops posts with no trace.
 */
import { eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { type Source, sourceCoverage } from "../db/schema.js";

/** Every platform's mark for one monitor. Absent means "we have never finished a walk". */
export async function coverageFor(db: Database, monitorId: string): Promise<Map<string, Date>> {
  const rows = await db
    .select({ source: sourceCoverage.source, coveredThrough: sourceCoverage.coveredThrough })
    .from(sourceCoverage)
    .where(eq(sourceCoverage.monitorId, monitorId));

  return new Map(rows.map((row) => [row.source as string, row.coveredThrough]));
}

/**
 * Mark one platform covered to the moment the finished walk began.
 *
 * Never moves backwards. A resume that outlived a later walk — or a clock that
 * disagrees with itself across two processes — must not widen the window again
 * and buy a month of history at a provider that charges by the page.
 */
export async function recordCoverage(
  db: Database,
  monitorId: string,
  source: Source,
  coveredThrough: Date,
): Promise<void> {
  await db
    .insert(sourceCoverage)
    .values({ monitorId, source, coveredThrough })
    .onConflictDoUpdate({
      target: [sourceCoverage.monitorId, sourceCoverage.source],
      set: {
        coveredThrough: sql`greatest(${sourceCoverage.coveredThrough}, ${coveredThrough})`,
        updatedAt: sql`now()`,
      },
    });
}
