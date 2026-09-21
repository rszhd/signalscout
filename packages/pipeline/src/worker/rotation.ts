/**
 * Which platforms one poll runs, when a monitor's platforms take turns
 * across the hour. US-289.
 *
 * A hosted plan sells search credits a day, and a project with three
 * searches on a 24-a-day plan was polled every three hours: every search
 * together, then nothing. The owner wants the inbox to move every hour.
 * Rotation finds no lead sooner on average — a search checked at 10:00,
 * 13:00 and 16:00 sees the same posts as one checked at 11:00, 14:00 and
 * 17:00 — but something new every hour is the point, and it spreads load.
 *
 * **By platform, not by search.** The collect step keeps its "seen up to"
 * window and its paging state per platform, so a platform runs with all its
 * searches or not at all, and both tables stay as they are. Per-search
 * rotation is the refinement that would re-key them.
 *
 * **A credit balance, not a slot.** Each poll adds the hour's credits. The
 * next platform in turn runs while the balance is above zero — the first
 * may take it negative, and repays it over the following hours — and each
 * further one only while the balance covers it. Over a day that spends
 * exactly the credits an hour whatever the shapes; a slot that refused a
 * platform heavier than the hour would never run LinkedIn on a one-credit
 * plan, and one that always ran it would overspend. The balance is capped
 * at one full turn, so a monitor paused for a week runs one turn on resume.
 *
 * **Off unless the application sets it.** `pollCreditsPerHour` null means
 * every platform, every poll — what every monitor does today. The weights
 * come from the application too, as `creditWeights` on `startWorker`: the
 * pipeline has no plans and no prices of its own.
 */
import type { Source } from "../db/schema.js";

export type CreditWeights = Partial<Record<Source, number>>;

export interface RotationState {
  /** The platforms, in the monitor's order. */
  readonly sources: readonly string[];
  /** How many searches each platform holds; a platform absent holds none. */
  readonly searchesOn: (source: string) => number;
  readonly weights: CreditWeights;
  readonly creditsPerHour: number;
  readonly balance: number;
  readonly cursor: number;
}

export interface Turn {
  /** The platforms this poll runs, in the order they run. */
  readonly sources: readonly string[];
  readonly balance: number;
  readonly cursor: number;
}

/** What one turn of a platform costs: its searches, times the platform's weight. */
export function platformWeight(source: string, searches: number, weights: CreditWeights): number {
  return Math.max(1, searches) * (weights[source as Source] ?? 1);
}

/**
 * The next turn. Pure, so the collect step can persist what comes back
 * before it asks any source, and a test can walk a day of polls in a loop.
 */
export function nextTurn(state: RotationState): Turn {
  const { sources, searchesOn, weights, creditsPerHour } = state;
  if (sources.length === 0) return { sources: [], balance: state.balance, cursor: 0 };

  const cost = (source: string) => platformWeight(source, searchesOn(source), weights);
  const fullTurn = sources.reduce((total, source) => total + cost(source), 0);

  // The hour's credits, capped at one full turn: what was not spent while
  // paused is not owed.
  let balance = Math.min(state.balance + creditsPerHour, Math.max(creditsPerHour, fullTurn));
  let cursor = state.cursor % sources.length;
  const chosen: string[] = [];

  for (let i = 0; i < sources.length; i += 1) {
    const source = sources[cursor] as string;
    const weight = cost(source);
    const first = chosen.length === 0;

    if (first ? balance <= 0 : balance < weight) break;

    chosen.push(source);
    balance -= weight;
    cursor = (cursor + 1) % sources.length;
  }

  return { sources: chosen, balance, cursor };
}
