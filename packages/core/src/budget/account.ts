/**
 * What one account has spent of the instance's money this month, and whether it
 * may spend more. US-129.
 *
 * Correctness-critical, and it is the budget guard's failure shape one level
 * up: money spent past a cap, silently, at 02:00 — except that the money is
 * ours rather than the customer's. US-128 let an account poll and classify on
 * the keys in this instance's `.env`, and nothing bounded it. This is the bound.
 *
 * **It is a different cap from `budgets`, with a different owner, and both
 * apply.** A monitor's cap is what the customer chose to spend and they may
 * raise it. This one is what the deployment will lend, and no screen and no
 * route can move it. The lower of the two stops the poll, and the sentence says
 * which — "you have spent your budget" and "this plan's month is used up" send
 * a person to two different places.
 *
 * **Nothing here knows what a plan is.** The caller passes a cap or null, and
 * null means this account is spending its own money — a bring-your-own-keys
 * account, or any account at all on a self-hosted instance. Keeping the plan
 * out is what stops this file growing a second copy of `billing/plan.ts`.
 *
 * **Both ledgers, and the model half is why `model_calls.user_id` exists.**
 * Three of the calls that table records have no monitor to reach an owner
 * through — writing a monitor's queries, drafting a project, drafting a reply —
 * and each is repeatable from a screen. Summing through `monitors` would leave
 * exactly the repeatable ones uncounted.
 */
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { apiUsage, modelCalls } from "../db/schema.js";
import { formatMicros, monthStart } from "./budget.js";

/**
 * What one account may spend of ours in a month, when nothing says otherwise.
 *
 * **$25, and it is a fuse rather than an allowance.** US-129 set it at $15,
 * which was below what the plan then sold — so it would have blown inside a
 * month somebody paid for, and the person would have read a sentence blaming
 * them for spending too much. US-133 moved it above the capacity: US-134's
 * worst case is about $9 of fetching and $3 of model, and twice that leaves
 * room for the model half nobody has measured while still stopping a runaway.
 *
 * It is the deployment's number and no screen shows it. What a customer is
 * sold is `billing/capacity.ts` — monitors, queries, a schedule and a platform
 * list — and if this ever blows it is a bug, a provider quirk or a retry
 * storm, none of which are the customer's doing.
 */
export const defaultAccountCapMicros = 25_000_000;

export interface AccountCapEnvironment {
  readonly ACCOUNT_MONTHLY_CAP_MICROS?: string | undefined;
}

/**
 * The cap this deployment lends, in micro-dollars.
 *
 * Micro-dollars because every other money figure in this repository is, and a
 * second unit is how two numbers about one bill stop agreeing. A value that is
 * not a non-negative number is refused rather than ignored: a typo that read as
 * zero would stop every monitor on the plan, and one that read as the default
 * would lend a number nobody chose.
 */
export function accountCapFrom(env: AccountCapEnvironment): number {
  const raw = env.ACCOUNT_MONTHLY_CAP_MICROS;
  if (raw === undefined || raw.trim() === "") return defaultAccountCapMicros;

  const value = Number(raw);

  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `ACCOUNT_MONTHLY_CAP_MICROS is "${raw}", which is not a number of micro-dollars.\n` +
        `Leave it unset for the default of ${formatMicros(defaultAccountCapMicros)} a month, ` +
        "or set it to a whole number of micro-dollars: 15000000 is $15.\n",
    );
  }

  return value;
}

/** What one account spent since the start of the month, in micro-dollars. */
export interface AccountSpend {
  readonly sourceMicros: number;
  readonly modelMicros: number;
  readonly totalMicros: number;
  /** The moment the figures are counted from, so a screen can say "since". */
  readonly since: Date;
}

export interface AccountBudgetState {
  readonly spend: AccountSpend;
  /** Null when this account spends its own money and no cap applies. */
  readonly capMicros: number | null;
  /** Null when there is no cap. Never negative, for `budgetState`'s reason. */
  readonly remainingMicros: number | null;
  readonly exhausted: boolean;
  /** One sentence for the log and the screen. Null while there is room. */
  readonly reason: string | null;
}

/** `sum()` comes back from the driver as a string: these columns are `bigint`. */
function toMicros(value: unknown): number {
  return Number(value ?? 0);
}

/** The UTC calendar day, as `api_usage.day` stores it. */
function dayOf(moment: Date): string {
  return moment.toISOString().slice(0, 10);
}

/**
 * One account's whole month, both halves.
 *
 * Every row is counted, including the ones no monitor owns: a cost test run
 * from the form and a query written for a monitor that was never created are
 * both on the bill. That is the difference from `monitorSpend`, which counts
 * only what a monitor caused — and the difference is deliberate, because the
 * question here is what the account cost us rather than what a monitor cost.
 */
export async function accountSpend(
  db: Database,
  userId: string,
  now: Date = new Date(),
): Promise<AccountSpend> {
  const since = monthStart(now);

  const [sourceRows, modelRows] = await Promise.all([
    db
      .select({ micros: sql<string>`sum(${apiUsage.estimatedCostMicros})` })
      .from(apiUsage)
      .where(and(eq(apiUsage.userId, userId), gte(apiUsage.day, dayOf(since)))),
    /**
     * A null `estimated_cost_micros` is a call whose price is not configured.
     * `sum` skips nulls, which is the answer we want: null means "we cannot
     * say", and counting it as anything else would put a number nothing
     * measured against somebody's cap.
     */
    db
      .select({ micros: sql<string>`sum(${modelCalls.estimatedCostMicros})` })
      .from(modelCalls)
      .where(and(eq(modelCalls.userId, userId), gte(modelCalls.createdAt, since))),
  ]);

  const sourceMicros = toMicros(sourceRows[0]?.micros);
  const modelMicros = toMicros(modelRows[0]?.micros);

  return { sourceMicros, modelMicros, totalMicros: sourceMicros + modelMicros, since };
}

/** The rule, over a reading already taken. */
export function accountBudgetState(
  spend: AccountSpend,
  capMicros: number | null,
): AccountBudgetState {
  if (capMicros === null) {
    return { spend, capMicros: null, remainingMicros: null, exhausted: false, reason: null };
  }

  // At the cap, not past it: an account standing exactly on it has nothing
  // left, and the next poll is billed before anything checks again.
  const exhausted = spend.totalMicros >= capMicros;

  return {
    spend,
    capMicros,
    remainingMicros: Math.max(0, capMicros - spend.totalMicros),
    exhausted,
    /**
     * A different sentence from the monitor guard's, and the difference is the
     * repair. A monitor's budget is raised by the person reading the message;
     * this one is not raised by anybody, so the sentence must not invite
     * somebody to go looking for a control that does not exist.
     *
     * **It names no figure, since US-133.** This cap is the deployment's fuse
     * and it sits above the capacity the plan sells, so an account that
     * reaches it did nothing wrong: what the customer bought is a number of
     * monitors and queries, not a number of dollars, and printing our internal
     * limit as though it were their allowance is the mistake US-133 was
     * written to undo. The operator's own figures are in the log line at the
     * refusal, which is where somebody can act on them.
     */
    reason: exhausted
      ? "Paused for this month. Collecting and scoring start again when the month does, " +
        "and nothing you set caused this — if it keeps happening, tell us."
      : null,
  };
}

/** What the account has spent, what it may spend, and whether it may poll. */
export async function checkAccountBudget(
  db: Database,
  userId: string,
  capMicros: number | null,
  now: Date = new Date(),
): Promise<AccountBudgetState> {
  // No cap is every self-hosted instance and every account spending its own
  // money, so it must not cost a query.
  if (capMicros === null) {
    const since = monthStart(now);
    return accountBudgetState({ sourceMicros: 0, modelMicros: 0, totalMicros: 0, since }, null);
  }

  return accountBudgetState(await accountSpend(db, userId, now), capMicros);
}

/**
 * Which of these accounts have spent their month, in one read.
 *
 * For the scheduler, which asks about every account at once and must not read a
 * row per monitor to find out. The rule is not written twice in SQL the way
 * entitlement's is, and the reason it does not have to be: only accounts on the
 * plan have a cap, there are few of them, and the caller already holds the list.
 * Entitlement's second form exists because a row per monitor could not be read
 * into TypeScript first; this one can.
 */
export async function accountsOverCap(
  db: Database,
  userIds: readonly string[],
  capMicros: number,
  now: Date = new Date(),
): Promise<string[]> {
  if (userIds.length === 0) return [];

  const since = monthStart(now);
  const ids = [...userIds];

  const [sourceRows, modelRows] = await Promise.all([
    db
      .select({
        userId: apiUsage.userId,
        micros: sql<string>`sum(${apiUsage.estimatedCostMicros})`,
      })
      .from(apiUsage)
      .where(and(inArray(apiUsage.userId, ids), gte(apiUsage.day, dayOf(since))))
      .groupBy(apiUsage.userId),
    db
      .select({
        userId: modelCalls.userId,
        micros: sql<string>`sum(${modelCalls.estimatedCostMicros})`,
      })
      .from(modelCalls)
      .where(and(inArray(modelCalls.userId, ids), gte(modelCalls.createdAt, since)))
      .groupBy(modelCalls.userId),
  ]);

  const totals = new Map<string, number>();

  for (const row of [...sourceRows, ...modelRows]) {
    if (!row.userId) continue;
    totals.set(row.userId, (totals.get(row.userId) ?? 0) + toMicros(row.micros));
  }

  return ids.filter((id) => (totals.get(id) ?? 0) >= capMicros);
}
