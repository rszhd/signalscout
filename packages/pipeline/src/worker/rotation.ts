/**
 * Which searches one poll runs, when a monitor's searches take turns
 * across the hour. US-289.
 *
 * A hosted plan sells search credits a day, and a project with three
 * searches on a 24-a-day plan was polled every three hours: every search
 * together, then nothing. The owner wants the inbox to move every hour.
 * Rotation finds no lead sooner on average — a search checked at 10:00,
 * 13:00 and 16:00 sees the same posts as one checked at 11:00, 14:00 and
 * 17:00 — but something new every hour is the point, and it spreads load.
 *
 * **The unit is one search on one platform.** The collect step keeps its
 * "seen up to" window and its paging state per unit for a monitor that
 * takes turns, so a search that sits out an hour does not lose the posts
 * written meanwhile. A Reddit monitor's channels are a unit of their own.
 *
 * **A credit balance, not a slot.** Each poll adds the hour's credits. The
 * next unit in turn runs while the balance is above zero — the first may
 * take it negative, and repays it over the following hours — and each
 * further one only while the balance covers it. Over a day that spends
 * exactly the credits an hour whatever the shapes; a slot that refused a
 * unit heavier than the hour would never run LinkedIn on a one-credit
 * plan, and one that always ran it would overspend. The balance is capped
 * at one full turn, so a monitor paused for a week runs one turn on resume.
 *
 * **Off unless the application sets it.** `pollCreditsPerHour` null means
 * every search on every platform, every poll — what every monitor does
 * today. The weights come from the application too, as `creditWeights` on
 * `startWorker`: the pipeline has no plans and no prices of its own.
 */
import type { Source } from "../db/schema.js";

export type CreditWeights = Partial<Record<Source, number>>;

/** One thing a poll can run on its own: a search on a platform, or a platform's channels. */
export interface Unit {
  readonly source: string;
  /** The search, or the empty string for the platform's channels — or for everything, when nothing takes turns. */
  readonly query: string;
}

export interface RotationState {
  /** The units, in the monitor's order: platforms as listed, each platform's searches as listed. */
  readonly units: readonly Unit[];
  readonly weights: CreditWeights;
  readonly creditsPerHour: number;
  readonly balance: number;
  readonly cursor: number;
}

export interface Turn {
  /** The units this poll runs, in the order they run. */
  readonly units: readonly Unit[];
  readonly balance: number;
  readonly cursor: number;
}

/** What one unit costs: the platform's weight. A channels unit costs one. */
export function unitWeight(unit: Unit, weights: CreditWeights): number {
  return weights[unit.source as Source] ?? 1;
}

/** The key a unit's window and paging state are kept under. */
export function unitKey(unit: Unit): string {
  return `${unit.source}\u0000${unit.query}`;
}

/**
 * A monitor's units, in turn order: every search on every platform it
 * watches, and a channels unit for a platform that browses some.
 */
export function unitsOf(
  sources: readonly string[],
  queriesOn: (source: string) => readonly string[],
  channelsOn: (source: string) => readonly string[],
): Unit[] {
  const units: Unit[] = [];
  for (const source of sources) {
    for (const query of queriesOn(source)) units.push({ source, query });
    if (channelsOn(source).length > 0) units.push({ source, query: "" });
  }
  return units;
}

/**
 * The next turn. Pure, so the collect step can persist what comes back
 * before it asks any source, and a test can walk a day of polls in a loop.
 */
export function nextTurn(state: RotationState): Turn {
  const { units, weights, creditsPerHour } = state;
  if (units.length === 0) return { units: [], balance: state.balance, cursor: 0 };

  const fullTurn = units.reduce((total, unit) => total + unitWeight(unit, weights), 0);

  // The hour's credits, capped at one full turn: what was not spent while
  // paused is not owed.
  let balance = Math.min(state.balance + creditsPerHour, Math.max(creditsPerHour, fullTurn));
  let cursor = state.cursor % units.length;
  const chosen: Unit[] = [];

  for (let i = 0; i < units.length; i += 1) {
    const unit = units[cursor] as Unit;
    const weight = unitWeight(unit, weights);
    const first = chosen.length === 0;

    if (first ? balance <= 0 : balance < weight) break;

    chosen.push(unit);
    balance -= weight;
    cursor = (cursor + 1) % units.length;
  }

  return { units: chosen, balance, cursor };
}
