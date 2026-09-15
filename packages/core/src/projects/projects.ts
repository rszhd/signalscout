/**
 * A project: a business, so its answers are typed once. US-045.
 *
 * The product, the ideal customer, the problem and the signals describe a
 * business. The queries, the platforms, the schedule and the budget describe a
 * search. This module owns the first four; `monitors.ts` owns the rest.
 *
 * **A monitor takes a copy and is not bound to it.** That decision is the
 * whole shape of this file, and the reason is `monitors.version`: US-012
 * records every verdict against the version that earned it, so a project the
 * monitors *followed* would re-version all of them on one edit and throw away
 * the comparability of every verdict already given. Editing a project changes
 * what the next monitor starts from. It changes nothing that already exists,
 * and `projectAnswers` exists so a screen can say so honestly.
 *
 * What this must not become is on PLAN.md's NOT list: a project is a name and
 * four answers, not a workspace with members and stages.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { monitors, projectCreations, projects, type Signal } from "../db/schema.js";

/** The four the classifier reads, plus the name a person files them under. */
export interface ProjectAnswers {
  readonly name: string;
  readonly product: string;
  readonly idealCustomer: string;
  readonly problem: string;
  readonly signals: readonly Signal[];
}

export interface Project extends ProjectAnswers {
  readonly id: string;
  readonly userId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** How many monitors were created from it. Grouping, not ownership. */
  readonly monitorCount: number;
}

/**
 * The signals are optional, and absent means none.
 *
 * The project form no longer asks for them: a signal says what one search
 * looks for, so it is chosen per monitor. Older projects keep theirs and the
 * monitor form still starts from them, so the column stays.
 */
export type CreateProjectInput = Omit<ProjectAnswers, "signals"> & {
  readonly signals?: readonly Signal[];
};

/**
 * Every field optional, and absent means "leave it".
 *
 * The same rule US-022 had to fix on monitors: a `PATCH` carrying one field
 * must not erase the rest, and a body schema that fills absent keys with
 * defaults is how that happens.
 */
export interface UpdateProjectInput {
  readonly name?: string;
  readonly product?: string;
  readonly idealCustomer?: string;
  readonly problem?: string;
  readonly signals?: readonly Signal[];
}

function trimmed(value: string, field: string): string {
  const out = value.trim();
  if (out === "") throw new Error(`A project needs a ${field}.`);
  return out;
}

export async function createProject(
  db: Database,
  userId: string,
  input: CreateProjectInput,
): Promise<Project> {
  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(projects)
      .values({
        userId,
        name: trimmed(input.name, "name"),
        product: trimmed(input.product, "product"),
        idealCustomer: trimmed(input.idealCustomer, "ideal customer"),
        problem: trimmed(input.problem, "problem"),
        signals: [...(input.signals ?? [])],
      })
      .returning();

    if (!created) throw new Error("The project was not created.");

    // The ledger a trial's total is counted from. US-146. Written with the
    // project so the two cannot disagree, and never deleted from.
    await tx.insert(projectCreations).values({ userId, projectId: created.id });

    return created;
  });

  return { ...row, signals: row.signals as Signal[], monitorCount: 0 };
}

/**
 * How many projects this account has ever made, deleted ones included. US-146.
 *
 * Read from the ledger and not from `projects`, which forgets a deleted one —
 * and forgetting is what the trial's limit exists to prevent.
 */
export async function countProjectCreations(db: Database, userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projectCreations)
    .where(eq(projectCreations.userId, userId));

  return row?.count ?? 0;
}

/**
 * Every project, newest first, each with the number of monitors under it.
 *
 * The count is here rather than on a second call because every screen that
 * lists projects wants it: it is what turns a list of names into something a
 * person can act on, and it is the number an edit warning would be wrong to
 * show — those monitors keep their own answers.
 */
export async function listProjects(db: Database, userId: string): Promise<Project[]> {
  const rows = await db
    .select({
      id: projects.id,
      userId: projects.userId,
      name: projects.name,
      product: projects.product,
      idealCustomer: projects.idealCustomer,
      problem: projects.problem,
      signals: projects.signals,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      // A join and a group rather than a correlated subquery: the subquery
      // form rendered without binding the outer row and counted zero for
      // every project, which a test caught before any screen did.
      monitorCount: sql<number>`count(${monitors.id})::int`,
    })
    .from(projects)
    .leftJoin(monitors, eq(monitors.projectId, projects.id))
    .where(eq(projects.userId, userId))
    .groupBy(projects.id)
    .orderBy(desc(projects.createdAt));

  return rows.map((row) => ({ ...row, signals: row.signals as Signal[] }));
}

export async function getProject(
  db: Database,
  userId: string,
  id: string,
): Promise<Project | null> {
  const found = await listProjects(db, userId);
  return found.find((project) => project.id === id) ?? null;
}

export async function updateProject(
  db: Database,
  userId: string,
  id: string,
  input: UpdateProjectInput,
): Promise<Project | null> {
  const [row] = await db
    .update(projects)
    .set({
      ...(input.name === undefined ? {} : { name: trimmed(input.name, "name") }),
      ...(input.product === undefined ? {} : { product: trimmed(input.product, "product") }),
      ...(input.idealCustomer === undefined
        ? {}
        : { idealCustomer: trimmed(input.idealCustomer, "ideal customer") }),
      ...(input.problem === undefined ? {} : { problem: trimmed(input.problem, "problem") }),
      ...(input.signals === undefined ? {} : { signals: [...input.signals] }),
      updatedAt: new Date(),
    })
    .where(and(eq(projects.id, id), eq(projects.userId, userId)))
    .returning({ id: projects.id });

  if (!row) return null;

  /**
   * No monitor is touched, and that is the feature rather than an omission.
   *
   * A monitor's four answers are its own copy, so nothing here can move
   * `monitors.version` and nothing here can invalidate a verdict.
   */
  return await getProject(db, userId, id);
}

/**
 * Delete a project, and the monitors made from it. US-145.
 *
 * US-045 left the monitors in place, unfiled, because their answers are their
 * own. Two later rules turned that into a trap: every address names a project
 * (US-076), so an unfiled monitor is reachable from no screen, and the plan
 * counts monitors across the account (US-133), so it still polls, still
 * spends, and still fills the slot. The monitors go first, in the same
 * transaction, and what hangs off each one cascades from it. The `set null`
 * on `monitors.project_id` stays for a monitor made with no project at all.
 *
 * Returns whether a project went, so a route can answer 404 rather than
 * pretending.
 */
export async function deleteProject(db: Database, userId: string, id: string): Promise<boolean> {
  return await db.transaction(async (tx) => {
    // Ownership is checked before anything goes, and the monitors go before
    // the project: the other order would `set null` them first and then find
    // nothing to delete.
    const [owned] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, userId)));
    if (!owned) return false;

    await tx.delete(monitors).where(eq(monitors.projectId, id));
    await tx.delete(projects).where(eq(projects.id, id));

    return true;
  });
}
