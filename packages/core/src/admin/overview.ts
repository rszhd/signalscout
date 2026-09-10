/**
 * The admin view: who registered on a day, and how big each account is.
 *
 * The first question an operator of a hosted instance asks is whether anyone
 * is signing up and whether they stay. This answers the first half and the
 * cheapest half of the second: a count of what each account made.
 *
 * **Every match counts, hidden ones included.** The inbox figure is the size
 * of the account's work, not what is left on screen after the reconciliation
 * job hid a deleted post. A number that moved because a stranger deleted a
 * post would be a number about the platforms rather than about the account.
 *
 * The day is UTC, because the database stores instants and a server in a
 * container has no other timezone to mean. `?date=` on the route selects one.
 */
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { matches, monitors, projects, users } from "../db/schema.js";

/** One account created on the day, and how much it holds. */
export interface Registration {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly createdAt: Date;
  readonly projects: number;
  readonly monitors: number;
  readonly matches: number;
}

export interface RegistrationsReport {
  /** The UTC day the report covers, as `YYYY-MM-DD`. */
  readonly date: string;
  readonly users: readonly Registration[];
  readonly totals: {
    readonly users: number;
    readonly projects: number;
    readonly monitors: number;
    readonly matches: number;
  };
}

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The half-open instant range a `YYYY-MM-DD` day covers, in UTC.
 *
 * Half-open because a day that ended `<= end` would count an account created
 * at exactly midnight into two days. `end` is the next midnight, exclusive.
 */
export function utcDayBounds(day: string): { start: Date; end: Date } {
  if (!dayPattern.test(day)) {
    throw new Error("The day must be written as YYYY-MM-DD.");
  }

  const start = new Date(`${day}T00:00:00.000Z`);

  if (Number.isNaN(start.getTime())) {
    throw new Error("That is not a real date.");
  }

  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/** The addresses `ADMIN_EMAILS` names, lowercased and without blanks. */
export function adminEmails(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((one) => one.trim().toLowerCase())
    .filter((one) => one !== "");
}

/**
 * Whether this address is an admin.
 *
 * Compared case-insensitively, because an email address is and a person who
 * typed `Owner@…` into one place and `owner@…` into another means one person.
 * An empty list answers false for everybody, which is the safe default.
 */
export function isAdminEmail(email: string, admins: readonly string[]): boolean {
  return admins.includes(email.trim().toLowerCase());
}

/**
 * Every account created on `day`, with its counts.
 *
 * One query with `count(distinct …)`, because the three left joins multiply:
 * a project join times a monitor join would count a project once per monitor.
 * `distinct` is what makes each count the thing it names.
 */
export async function registrationsOn(db: Database, day: string): Promise<RegistrationsReport> {
  const { start, end } = utcDayBounds(day);

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      emailVerified: users.emailVerified,
      createdAt: users.createdAt,
      projects: sql<number>`count(distinct ${projects.id})`.mapWith(Number),
      monitors: sql<number>`count(distinct ${monitors.id})`.mapWith(Number),
      matches: sql<number>`count(distinct ${matches.id})`.mapWith(Number),
    })
    .from(users)
    .leftJoin(projects, eq(projects.userId, users.id))
    .leftJoin(monitors, eq(monitors.userId, users.id))
    .leftJoin(matches, eq(matches.monitorId, monitors.id))
    .where(and(gte(users.createdAt, start), lt(users.createdAt, end)))
    .groupBy(users.id)
    .orderBy(asc(users.createdAt));

  const totals = rows.reduce(
    (sum, row) => ({
      users: sum.users + 1,
      projects: sum.projects + row.projects,
      monitors: sum.monitors + row.monitors,
      matches: sum.matches + row.matches,
    }),
    { users: 0, projects: 0, monitors: 0, matches: 0 },
  );

  return { date: day, users: rows, totals };
}
