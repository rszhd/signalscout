/**
 * Projects, against real Postgres. US-045.
 *
 * The claims worth asserting here are all about what a project does *not* do.
 * It holds four answers a monitor copies, and the copy is the whole design:
 * `monitors.version` is what makes US-012's verdicts comparable, so a project
 * edit that reached an existing monitor would discard every verdict already
 * given against the old version. Two cases below exist to keep that true, and
 * they are the ones to read before anyone makes projects a link.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { monitors, projects } from "../db/schema.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from "./projects.js";

const userId = "user-1";

const answers = {
  name: "Acme QA",
  product: "A test runner for small teams",
  idealCustomer: "Small SaaS teams with no dedicated QA",
  problem: "Their end to end tests break on every UI change",
  signals: ["problem", "recommendation_request"] as const,
};

let database: TestDatabase;
let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  database = await createTestDatabase("projects");
  ({ db, close } = createDatabase(database.url));
}, 60_000);

afterAll(async () => {
  await close?.();
  await database?.drop();
});

beforeEach(async () => {
  await db.delete(monitors);
  await db.delete(projects);
});

async function insertMonitorIn(projectId: string | null, name = "A monitor") {
  const [row] = await db
    .insert(monitors)
    .values({
      userId,
      name,
      product: answers.product,
      idealCustomer: answers.idealCustomer,
      problem: answers.problem,
      signals: [...answers.signals],
      sources: ["reddit"],
      ...(projectId ? { projectId } : {}),
    })
    .returning({ id: monitors.id, version: monitors.version });

  if (!row) throw new Error("the monitor was not inserted");
  return row;
}

describe("creating a project", () => {
  it("keeps the four answers and the name", async () => {
    const project = await createProject(db, userId, answers);

    expect(project.name).toBe("Acme QA");
    expect(project.product).toBe("A test runner for small teams");
    expect(project.idealCustomer).toBe("Small SaaS teams with no dedicated QA");
    expect(project.problem).toBe("Their end to end tests break on every UI change");
    expect(project.signals).toEqual(["problem", "recommendation_request"]);
    expect(project.monitorCount).toBe(0);
  });

  it("refuses an answer that is only whitespace", async () => {
    // A project whose product is a space is worse than no project: it prefills
    // a monitor with nothing and looks like it worked.
    await expect(createProject(db, userId, { ...answers, product: "   " })).rejects.toThrow(
      /product/,
    );
  });

  it("trims what it stores, so two projects do not differ by a space", async () => {
    const project = await createProject(db, userId, { ...answers, name: "  Acme QA  " });

    expect(project.name).toBe("Acme QA");
  });
});

describe("listing projects", () => {
  it("counts the monitors made from each one", async () => {
    const acme = await createProject(db, userId, answers);
    await createProject(db, userId, { ...answers, name: "Beta" });

    await insertMonitorIn(acme.id, "one");
    await insertMonitorIn(acme.id, "two");
    await insertMonitorIn(null, "loose");

    const listed = await listProjects(db, userId);
    const byName = Object.fromEntries(listed.map((p) => [p.name, p.monitorCount]));

    expect(byName).toEqual({ "Acme QA": 2, Beta: 0 });
  });

  it("shows another person's projects to nobody", async () => {
    await createProject(db, "someone-else", answers);

    expect(await listProjects(db, userId)).toEqual([]);
    expect(
      await getProject(db, userId, (await listProjects(db, "someone-else"))[0]?.id ?? ""),
    ).toBeNull();
  });
});

describe("editing a project", () => {
  it("changes only the fields it carries", async () => {
    // US-022's bug, on a new table: a PATCH with one field erased every field
    // it did not carry, because the body schema filled the absent keys.
    const project = await createProject(db, userId, answers);

    const edited = await updateProject(db, userId, project.id, { name: "Acme QA (EU)" });

    expect(edited?.name).toBe("Acme QA (EU)");
    expect(edited?.product).toBe(answers.product);
    expect(edited?.problem).toBe(answers.problem);
    expect(edited?.signals).toEqual([...answers.signals]);
  });

  /**
   * The decision this ticket exists to make, asserted rather than described.
   *
   * A monitor's four answers are its own copy. If this ever changes, US-012's
   * verdicts stop being comparable across an edit nobody made to the monitor.
   */
  it("does not touch a monitor made from it, and does not move its version", async () => {
    const project = await createProject(db, userId, answers);
    const monitor = await insertMonitorIn(project.id);

    await updateProject(db, userId, project.id, {
      product: "Something else entirely",
      problem: "A different problem",
    });

    const [after] = await db.select().from(monitors).where(eq(monitors.id, monitor.id));

    expect(after?.product).toBe(answers.product);
    expect(after?.problem).toBe(answers.problem);
    expect(after?.version).toBe(monitor.version);
  });

  it("answers null for a project that is not this person's", async () => {
    const theirs = await createProject(db, "someone-else", answers);

    expect(await updateProject(db, userId, theirs.id, { name: "Mine now" })).toBeNull();
  });
});

describe("deleting a project", () => {
  it("leaves the monitors made from it, with their answers", async () => {
    const project = await createProject(db, userId, answers);
    const monitor = await insertMonitorIn(project.id);

    expect(await deleteProject(db, userId, project.id)).toBe(true);

    const [after] = await db.select().from(monitors).where(eq(monitors.id, monitor.id));

    // The monitor survives, unfiled rather than deleted. Its answers are its
    // own, so nothing it needs went with the project.
    expect(after?.projectId).toBeNull();
    expect(after?.product).toBe(answers.product);
  });

  it("says so when there was nothing to delete", async () => {
    expect(await deleteProject(db, userId, "00000000-0000-0000-0000-000000000000")).toBe(false);
  });
});
