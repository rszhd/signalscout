/**
 * The budget guard: what a monitor has spent this month, and whether it may
 * spend more.
 *
 * Correctness-critical: budget guard. docs/testing.md names the failure —
 * money is spent past a cap, silently, while nobody is watching — and
 * `budget.test.ts` was written before this file.
 *
 * Three decisions shape it.
 *
 * **The guard runs before the poll.** A page is billed when it is fetched, so
 * a check after the call has already spent the money. `worker/collect.ts`
 * calls `enforceBudget` before it reaches a source.
 *
 * **A cap is a stop line, not a forecast.** This code cannot know what the
 * next poll will cost: the connector decides how many records a query
 * collects. So a monitor may overshoot its cap by up to one poll, and the
 * ticket that tells a person the cost *before* the query runs is US-014. That
 * is why `remainingMicros` never goes below zero — a negative remainder would
 * be reporting the overshoot as though the cap had been meant to allow it.
 *
 * **Every figure here is an estimate.** We multiply the units a connector
 * reported by the price that connector declares — the platform and the
 * provider together, because two providers fetching one platform bill
 * differently — and the model's own estimate
 * on top. The provider's invoice is authoritative and ours is not: Bright
 * Data's first 5,000 records each month are free and this arithmetic does not
 * know it, a provider's billing month may not be ours, and a call that failed
 * on the wire may have been billed without reporting a unit. docs/costs.md
 * says so to the user, and every screen carries the word "estimated".
 */
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import {
  apiUsage,
  budgets,
  type ExhaustedBehaviour,
  modelCalls,
  monitors,
  type Provider,
  type Source,
} from "../db/schema.js";
import { pauseMonitor } from "../monitors/monitors.js";

/** What one monitor spent since the start of the month, in micro-dollars. */
export interface MonitorSpend {
  /** Every connector's reads, priced by that connector's own `pricePerUnitMicros`. */
  readonly sourceMicros: number;
  /**
   * Classification and query generation, from `model_calls`. US-008's
   * embeddings are recorded through the same table and land in this number
   * without a change here.
   */
  readonly modelMicros: number;
  readonly totalMicros: number;
  /** The moment the figures are counted from, so a screen can say "since". */
  readonly since: Date;
}

/** A monitor's cap, as the `budgets` row holds it. */
export interface MonitorBudget {
  readonly monthlyCapMicros: number;
  readonly onExhausted: ExhaustedBehaviour;
}

/**
 * Everything the guard decided and the screen shows, from one reading.
 *
 * The guard and the monitor list read the same function, so the sentence a
 * person sees is the sentence that stopped the poll, and neither can drift
 * from the other.
 */
export interface BudgetState {
  readonly spend: MonitorSpend;
  /** Null when this monitor has no cap. */
  readonly capMicros: number | null;
  /** Null when there is no cap. Never negative: see the header. */
  readonly remainingMicros: number | null;
  readonly exhausted: boolean;
  readonly onExhausted: ExhaustedBehaviour | null;
  /** One sentence for the log and the screen. Null while there is room. */
  readonly reason: string | null;
}

/**
 * A micro-dollar amount as a person reads it.
 *
 * Up to four decimal places, because ten Reddit records cost $0.015 and a page
 * that rounded that to $0.02 could not be reconciled against anything. Both
 * providers price in US dollars, so the currency is not a setting.
 */
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

export function formatMicros(micros: number): string {
  return money.format(micros / 1_000_000);
}

/**
 * The first moment of the month `now` falls in, in UTC.
 *
 * Computed here rather than by Postgres, unlike the poll schedule's `now()`.
 * Two workers with slightly wrong clocks would disagree about what is due to
 * the second, which matters; they cannot disagree about which month it is.
 * Passing the moment in is also what lets a test assert that last month's
 * spend is excluded.
 */
export function monthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** The UTC calendar day, as the `api_usage.day` column stores it. */
function dayOf(moment: Date): string {
  return moment.toISOString().slice(0, 10);
}

/** `sum()` comes back from the driver as a string, because these columns are `bigint`. */
function toMicros(value: unknown): number {
  return Number(value ?? 0);
}

export interface RecordSourceUsageInput {
  /**
   * Null for a call made before any monitor existed — US-014's cost test.
   * The row is on the bill and on no monitor's cap, which is what the column
   * says and what docs/costs.md tells the user.
   */
  readonly monitorId: string | null;
  /** The platform. What was fetched. */
  readonly source: Source;
  /** The provider. Who fetched it, whose bill it lands on, and whose price. */
  readonly provider: Provider;
  /** What the connector reported as `SearchResult.unitsConsumed`. Never a post count. */
  readonly units: number;
  /**
   * The connector's declared price: the platform and the provider together.
   *
   * Never the platform's, because there is no such number. Bright Data prices
   * a Reddit record and ScrapeCreators will not price the same record the
   * same, so a caller that read a price off a platform would put one
   * provider's arithmetic on every provider's bill.
   */
  readonly pricePerUnitMicros: number;
  readonly now?: Date;
}

/**
 * Add one call's units and cost to the monitor's row for that source and day.
 *
 * Written after every page rather than once per poll. A poll that throws on
 * its third page was billed for the first two, and a ledger that lost them
 * would let the next poll spend that money again inside the same cap.
 *
 * A call billed nothing is still written. A row of zeros is how "this monitor
 * polled and was charged nothing" stays distinguishable from "this monitor
 * never polled", and Bright Data's trigger call is exactly that shape.
 */
export async function recordSourceUsage(
  db: Pick<Database, "insert">,
  {
    monitorId,
    source,
    provider,
    units,
    pricePerUnitMicros,
    now = new Date(),
  }: RecordSourceUsageInput,
): Promise<void> {
  const estimatedCostMicros = units * pricePerUnitMicros;

  await db
    .insert(apiUsage)
    .values({ monitorId, source, provider, day: dayOf(now), units, estimatedCostMicros })
    .onConflictDoUpdate({
      target: [apiUsage.monitorId, apiUsage.source, apiUsage.provider, apiUsage.day],
      set: {
        units: sql`${apiUsage.units} + ${units}`,
        estimatedCostMicros: sql`${apiUsage.estimatedCostMicros} + ${estimatedCostMicros}`,
        updatedAt: sql`now()`,
      },
    });
}

/**
 * Both halves of the spend, for every monitor named, or for all of them.
 *
 * Summed across connectors on purpose. `units` is comparable only inside one
 * connector, and the cost column is what makes two of them add up — which is
 * the whole reason the price is multiplied in when the row is written and not
 * when it is read.
 */
async function readSpend(
  db: Database,
  since: Date,
  monitorIds?: readonly string[],
): Promise<Map<string, { sourceMicros: number; modelMicros: number }>> {
  const totals = new Map<string, { sourceMicros: number; modelMicros: number }>();
  const only = monitorIds ? monitorIds : undefined;

  const entry = (id: string) => {
    const existing = totals.get(id);
    if (existing) return existing;

    const created = { sourceMicros: 0, modelMicros: 0 };
    totals.set(id, created);
    return created;
  };

  const sourceRows = await db
    .select({
      monitorId: apiUsage.monitorId,
      micros: sql<string>`sum(${apiUsage.estimatedCostMicros})`,
    })
    .from(apiUsage)
    .where(
      and(
        gte(apiUsage.day, dayOf(since)),
        ...(only ? [inArray(apiUsage.monitorId, [...only])] : []),
      ),
    )
    .groupBy(apiUsage.monitorId);

  for (const row of sourceRows) {
    // A cost test run before its monitor existed carries no monitor id. It is
    // on the bill and on no monitor, the same as a query generated from the
    // form, so no monitor's cap counts it.
    if (row.monitorId) entry(row.monitorId).sourceMicros = toMicros(row.micros);
  }

  /**
   * A null `estimated_cost_micros` is a call whose price is not configured.
   * `sum` skips nulls, which is the answer we want: null means "we cannot
   * say", and counting it as anything else would put a number nothing
   * measured on a bill page.
   */
  const modelRows = await db
    .select({
      monitorId: modelCalls.monitorId,
      micros: sql<string>`sum(${modelCalls.estimatedCostMicros})`,
    })
    .from(modelCalls)
    .where(
      and(
        gte(modelCalls.createdAt, since),
        ...(only ? [inArray(modelCalls.monitorId, [...only])] : []),
      ),
    )
    .groupBy(modelCalls.monitorId);

  for (const row of modelRows) {
    // A query generated before its monitor existed carries no monitor id. It
    // is on the bill and it is on no monitor, which is what US-010's route
    // says when it writes the row.
    if (row.monitorId) entry(row.monitorId).modelMicros = toMicros(row.micros);
  }

  return totals;
}

export async function monitorSpend(
  db: Database,
  monitorId: string,
  now: Date = new Date(),
): Promise<MonitorSpend> {
  const since = monthStart(now);
  const totals = (await readSpend(db, since, [monitorId])).get(monitorId);

  return {
    sourceMicros: totals?.sourceMicros ?? 0,
    modelMicros: totals?.modelMicros ?? 0,
    totalMicros: (totals?.sourceMicros ?? 0) + (totals?.modelMicros ?? 0),
    since,
  };
}

/**
 * Every monitor's spend in one read, for the screen that lists them.
 *
 * A monitor that spent nothing is in the map with zeros rather than missing.
 * A caller that had to remember the difference is a caller that will one day
 * show a blank where a zero belongs.
 */
export async function spendByMonitor(
  db: Database,
  now: Date = new Date(),
): Promise<Map<string, MonitorSpend>> {
  const since = monthStart(now);
  const totals = await readSpend(db, since);
  const ids = await db.select({ id: monitors.id }).from(monitors);
  const spend = new Map<string, MonitorSpend>();

  for (const { id } of ids) {
    const found = totals.get(id);
    const sourceMicros = found?.sourceMicros ?? 0;
    const modelMicros = found?.modelMicros ?? 0;

    spend.set(id, { sourceMicros, modelMicros, totalMicros: sourceMicros + modelMicros, since });
  }

  return spend;
}

/** Which provider last collected one platform for one monitor, and when. */
export interface LastCollection {
  readonly source: Source;
  readonly provider: Provider;
  readonly at: Date;
}

/**
 * The last collection per platform, per monitor, read from the ledger.
 *
 * US-026 needs it: once a person can change which provider fetches a platform,
 * the monitor list has to be able to say which one actually did, and when. The
 * ledger is the honest place to read it from — a row is written as each page
 * comes back, so its `updated_at` is the moment money was last spent on that
 * pair rather than the moment a poll was scheduled.
 *
 * Rows with no monitor are skipped. Those are US-014's cost tests, which are
 * on the bill and on no monitor.
 */
export async function lastCollections(db: Database): Promise<Map<string, LastCollection[]>> {
  const rows = await db
    .select({
      monitorId: apiUsage.monitorId,
      source: apiUsage.source,
      provider: apiUsage.provider,
      at: apiUsage.updatedAt,
    })
    .from(apiUsage)
    .orderBy(apiUsage.updatedAt);

  const latest = new Map<string, LastCollection[]>();

  for (const row of rows) {
    if (!row.monitorId) continue;

    // Ascending, so a later row replaces an earlier one for the same platform.
    const found = latest.get(row.monitorId) ?? [];
    const entry: LastCollection = { source: row.source, provider: row.provider, at: row.at };
    const at = found.findIndex((one) => one.source === row.source);

    if (at === -1) found.push(entry);
    else found[at] = entry;

    latest.set(row.monitorId, found);
  }

  return latest;
}

/**
 * Every monitor's budget state in one read, for the screen that lists them.
 *
 * The same `budgetState` the guard applies, so the sentence a person reads on
 * the monitor list is the sentence that refused the poll. A list route that
 * recomputed the rule itself would be a second copy of it, and the copy that
 * drifts is always the one a person is looking at.
 */
export async function budgetStates(
  db: Database,
  now: Date = new Date(),
): Promise<Map<string, BudgetState>> {
  const spend = await spendByMonitor(db, now);
  const rows = await db.select().from(budgets);
  const caps = new Map(
    rows.map((row) => [
      row.monitorId,
      { monthlyCapMicros: row.monthlyCapMicros, onExhausted: row.onExhausted },
    ]),
  );

  return new Map(
    [...spend].map(([monitorId, totals]) => [
      monitorId,
      budgetState(totals, caps.get(monitorId) ?? null),
    ]),
  );
}

export async function getBudget(
  db: Database,
  monitorId: string,
): Promise<MonitorBudget | undefined> {
  const [row] = await db.select().from(budgets).where(eq(budgets.monitorId, monitorId)).limit(1);
  if (!row) return undefined;

  return { monthlyCapMicros: row.monthlyCapMicros, onExhausted: row.onExhausted };
}

/** Set the cap, or replace the one that is there. One monitor, one cap. */
export async function setBudget(
  db: Database,
  monitorId: string,
  budget: MonitorBudget,
): Promise<MonitorBudget> {
  await db
    .insert(budgets)
    .values({ monitorId, ...budget })
    .onConflictDoUpdate({
      target: budgets.monitorId,
      set: { ...budget, updatedAt: sql`now()` },
    });

  return budget;
}

/**
 * Remove the cap. The usage rows stay.
 *
 * Deleting the recorded spend with the cap would erase the answer to "what did
 * this month cost", which is the question the ledger exists for.
 */
export async function clearBudget(db: Database, monitorId: string): Promise<boolean> {
  const removed = await db
    .delete(budgets)
    .where(eq(budgets.monitorId, monitorId))
    .returning({ monitorId: budgets.monitorId });

  return removed.length > 0;
}

/**
 * The rule, with nothing to read and nothing to write.
 *
 * Separate from the database so the guard and the screen apply one rule, and
 * so the rule itself is asserted against literals rather than against rows.
 */
export function budgetState(spend: MonitorSpend, budget: MonitorBudget | null): BudgetState {
  if (!budget) {
    return {
      spend,
      capMicros: null,
      remainingMicros: null,
      exhausted: false,
      onExhausted: null,
      reason: null,
    };
  }

  // At the cap, not past it. A monitor standing exactly on its cap has no
  // money left, and the next poll is billed before anything checks again.
  const exhausted = spend.totalMicros >= budget.monthlyCapMicros;

  return {
    spend,
    capMicros: budget.monthlyCapMicros,
    remainingMicros: Math.max(0, budget.monthlyCapMicros - spend.totalMicros),
    exhausted,
    onExhausted: budget.onExhausted,
    /**
     * The sentence a person reads, and it names both halves on purpose.
     *
     * It said "Polling stopped" until 2026-09-06, when BUG-004 taught the
     * classify step to stop mid-batch. Two things stop at a cap now, and only
     * one of them is obvious: the poll collects nothing further, and posts
     * already collected and already paid for are not read. A person told only
     * that polling stopped would not know that raising the cap buys them
     * something they have already bought.
     */
    reason: exhausted
      ? `Stopped at the budget: this monitor has spent an estimated ${formatMicros(
          spend.totalMicros,
        )} of its ${formatMicros(budget.monthlyCapMicros)} monthly budget. It is not ` +
        "collecting, and posts it already collected are not being scored. Raise the cap " +
        "to start both again."
      : null,
  };
}

/** What the monitor has spent, what it may spend, and whether it may poll. */
export async function checkBudget(
  db: Database,
  monitorId: string,
  now: Date = new Date(),
): Promise<BudgetState> {
  const [spend, budget] = await Promise.all([
    monitorSpend(db, monitorId, now),
    getBudget(db, monitorId),
  ]);

  return budgetState(spend, budget ?? null);
}

/**
 * Check the budget and apply what the monitor asked for when it is gone.
 *
 * `pause` stops the scheduler from queueing any further poll, so the monitor
 * goes quiet until a person raises the cap and resumes it. `notify` leaves it
 * running and this guard refuses each poll in turn, so the monitor starts
 * collecting again by itself when next month's spend resets. That difference
 * is the whole reason the column has two values.
 *
 * The notification itself is US-016's, which has no delivery yet. The reason
 * reaches a person through the monitor list until it does.
 */
export async function enforceBudget(
  db: Database,
  monitorId: string,
  now: Date = new Date(),
): Promise<BudgetState> {
  const state = await checkBudget(db, monitorId, now);

  if (state.exhausted && state.onExhausted === "pause") {
    await pauseMonitor(db, monitorId);
  }

  return state;
}

/**
 * How many model calls may pass between two readings of the ledger.
 *
 * A reading per call would be a query per call, which doubles the round trips
 * of the cheapest stage in the pipeline. A reading per batch would be wrong the
 * moment two workers share a monitor. This is the compromise, and the number is
 * small because the thing being bounded is money.
 */
const recheckEvery = 20;

export interface SpendMeter {
  /** True once the cap is reached. Ask before every call, not after. */
  exhausted(): Promise<boolean>;
  /** Record what one call cost. An unpriced call counts as nothing, honestly. */
  spent(micros: number | undefined): void;
  /** The state as last read, for a log line or a message to a person. */
  readonly state: BudgetState;
}

/**
 * A running budget check for a loop that spends per item.
 *
 * BUG-004. `enforceBudget` answers "may this work start", which is the right
 * question for a poll: one poll buys one bounded set of pages. It is the wrong
 * question for a batch of 123 classifications, because the cap can be crossed
 * between the first item and the last, and nothing was asking.
 *
 * So this reads the ledger once, then subtracts what the loop reports as it
 * goes, and re-reads every `recheckEvery` calls so a second worker's spend on
 * the same monitor is noticed rather than assumed away. The re-read is what
 * makes the estimate converge on the truth instead of drifting from it.
 *
 * A monitor with no cap is never exhausted and never re-reads, so an uncapped
 * deployment pays one query for the whole batch.
 */
export async function createSpendMeter(
  db: Database,
  monitorId: string,
  now: Date = new Date(),
): Promise<SpendMeter> {
  let state = await checkBudget(db, monitorId, now);
  let sinceRead = 0;
  let spentSinceRead = 0;

  return {
    get state() {
      return state;
    },

    spent(micros) {
      // Undefined means the model has no configured price. It is counted as
      // nothing rather than guessed, which is the same rule the ledger follows
      // and the reason an unpriced deployment is not protected by this at all.
      spentSinceRead += micros ?? 0;
      sinceRead += 1;
    },

    async exhausted() {
      if (state.capMicros === null) return false;

      if (sinceRead >= recheckEvery) {
        state = await checkBudget(db, monitorId, new Date());
        sinceRead = 0;
        spentSinceRead = 0;
      }

      if (state.exhausted) return true;

      // Between readings, the estimate is what the ledger said plus what this
      // loop has spent since. Erring towards stopping early is the safe
      // direction: a person can see an unfinished batch and raise the cap.
      return spentSinceRead >= (state.remainingMicros ?? 0);
    },
  };
}
