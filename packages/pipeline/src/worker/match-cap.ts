/**
 * The match cap of a walk: which cap applies, and whether the walk has
 * reached it. US-490.
 *
 * A walk is one collection. Its first walk may have a different cap from every
 * later walk, so the answer needs the walk and the monitor's earliest poll.
 * No walk means no cap, as before.
 */
import { and, asc, count, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { matches, pollRuns } from "../db/schema.js";

export interface MatchCaps {
  /** The cap of a monitor's first walk. Unset: the first walk takes `matchesPerCollection`. */
  readonly firstMatchesPerCollection?: number | undefined;
  /** The cap of every walk, or of every later one when the first has its own. Unset: no cap. */
  readonly matchesPerCollection?: number | undefined;
}

/**
 * The matches a walk has made so far.
 *
 * A match is counted from the start of its walk's first poll, so every job of
 * one collection shares one count. A job with no walk counts only its own.
 */
export async function matchesInWalk(
  db: Database,
  monitorId: string,
  walkId: string | undefined,
): Promise<number> {
  if (!walkId) return 0;
  const [start] = await db
    .select({ at: sql<Date | null>`min(${pollRuns.startedAt})` })
    .from(pollRuns)
    .where(and(eq(pollRuns.monitorId, monitorId), eq(pollRuns.walkId, walkId)));
  if (!start?.at) return 0;
  const [row] = await db
    .select({ n: count() })
    .from(matches)
    .where(and(eq(matches.monitorId, monitorId), sql`${matches.createdAt} >= ${start.at}`));
  return Number(row?.n ?? 0);
}

/**
 * Whether a job's posts come from the monitor's first collection.
 *
 * A collection is a walk: every poll job of it, a resumed page included,
 * carries one `walk_id`, and so does every classify job it leads to, replies
 * too. The first walk is the one on the monitor's earliest poll row. A job
 * with no walk is not the first. `poll_runs` keeps a monitor's newest 200
 * rows, so after that many polls the earliest row left is a later walk's,
 * whose jobs finished long before.
 */
export async function isFirstWalk(
  db: Database,
  monitorId: string,
  walkId: string | undefined,
): Promise<boolean> {
  if (!walkId) return false;
  const [earliest] = await db
    .select({ walkId: pollRuns.walkId })
    .from(pollRuns)
    .where(eq(pollRuns.monitorId, monitorId))
    .orderBy(asc(pollRuns.startedAt))
    .limit(1);
  return earliest?.walkId === walkId;
}

/** The cap for this walk, or undefined for none. No walk id: undefined. */
export async function capForWalk(
  db: Database,
  monitorId: string,
  walkId: string | undefined,
  caps: MatchCaps,
): Promise<number | undefined> {
  if (!walkId) return undefined;
  // Unset, the first walk keeps the one cap, as it did before US-490.
  const first = caps.firstMatchesPerCollection ?? caps.matchesPerCollection;
  // One cap is the same on every walk, so the first walk's row is not needed.
  if (first === caps.matchesPerCollection) return first;
  return (await isFirstWalk(db, monitorId, walkId)) ? first : caps.matchesPerCollection;
}

/** True when this walk has a cap and already has that many matches. */
export async function walkHasItsMatches(
  db: Database,
  monitorId: string,
  walkId: string | undefined,
  caps: MatchCaps,
): Promise<boolean> {
  if (!walkId) return false;
  const cap = await capForWalk(db, monitorId, walkId, caps);
  if (cap === undefined) return false;
  return (await matchesInWalk(db, monitorId, walkId)) >= cap;
}

/** Throws unless each set cap is a whole number of 1 or more. */
export function validateMatchCaps(caps: MatchCaps): void {
  for (const name of ["firstMatchesPerCollection", "matchesPerCollection"] as const) {
    const value = caps[name];
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
      throw new RangeError(`${name} must be a whole number of 1 or more, not ${value}`);
    }
  }
}
