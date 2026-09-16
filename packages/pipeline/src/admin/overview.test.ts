/**
 * The admin overview, against real Postgres. US-111.
 *
 * The counts are the whole point and they are the part a unit test cannot
 * reach: three left joins multiply, and a count that forgot `distinct` would
 * report a project once per monitor. That is why the first case below gives an
 * account two projects and two monitors and asserts the numbers separately.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { matches, monitors, posts, projects, users } from "../db/schema.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { adminEmails, isAdminEmail, registrationsOn, utcDayBounds } from "./overview.js";

let database: TestDatabase;
let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  database = await createTestDatabase("admin_overview");
  ({ db, close } = createDatabase(database.url));
}, 60_000);

afterAll(async () => {
  await close?.();
  await database?.drop();
});

beforeEach(async () => {
  // Order matters: children before parents. A cascade would do it, but users
  // carries no foreign key on purpose (US-017), so nothing cascades from it.
  await db.delete(matches);
  await db.delete(posts);
  await db.delete(monitors);
  await db.delete(projects);
  await db.delete(users);
});

const day = "2026-09-10";

async function addUser(id: string, createdAt: Date): Promise<void> {
  await db.insert(users).values({
    id,
    name: `Person ${id}`,
    email: `${id}@example.test`,
    createdAt,
  });
}

async function addProject(userId: string, name: string): Promise<void> {
  await db.insert(projects).values({
    userId,
    name,
    product: "A test runner",
    idealCustomer: "Small teams",
    problem: "Flaky tests",
  });
}

async function addMonitor(userId: string, name: string): Promise<string> {
  const [row] = await db
    .insert(monitors)
    .values({
      userId,
      name,
      product: "A test runner",
      idealCustomer: "Small teams",
      problem: "Flaky tests",
    })
    .returning();

  if (!row) throw new Error("The monitor was not inserted.");
  return row.id;
}

async function addMatch(monitorId: string, externalId: string, hidden = false): Promise<void> {
  const [post] = await db
    .insert(posts)
    .values({
      source: "reddit",
      externalId,
      url: `https://reddit.test/${externalId}`,
      excerpt: "A post about flaky tests",
      postedAt: new Date("2026-09-10T09:00:00.000Z"),
    })
    .returning();

  if (!post) throw new Error("The post was not inserted.");

  await db.insert(matches).values({
    monitorId,
    postId: post.id,
    score: 70,
    relevance: 70,
    problemFit: 70,
    icpFit: 70,
    intent: 70,
    urgency: 70,
    intentType: "problem",
    reasons: ["a reason"],
    hidden,
  });
}

describe("the day a report covers", () => {
  it("is the UTC half-open range, so midnight belongs to one day only", () => {
    const { start, end } = utcDayBounds(day);

    expect(start.toISOString()).toBe("2026-09-10T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-11T00:00:00.000Z");
  });

  it("refuses a day that is not written as YYYY-MM-DD", () => {
    expect(() => utcDayBounds("10-09-2026")).toThrow();
  });
});

describe("who is an admin", () => {
  it("splits, trims and lowercases the list", () => {
    expect(adminEmails(" Owner@Example.com , second@example.com ,,")).toEqual([
      "owner@example.com",
      "second@example.com",
    ]);
  });

  it("answers false for everybody when the list is empty", () => {
    expect(adminEmails(undefined)).toEqual([]);
    expect(isAdminEmail("owner@example.com", [])).toBe(false);
  });

  it("matches an address whatever its case", () => {
    expect(isAdminEmail("Owner@Example.com", ["owner@example.com"])).toBe(true);
  });
});

describe("the accounts created on a day", () => {
  it("lists today's accounts with their projects, monitors and matches", async () => {
    await addUser("today", new Date("2026-09-10T08:00:00.000Z"));
    await addProject("today", "Acme QA");
    await addProject("today", "Northwind");
    const monitor = await addMonitor("today", "Flaky tests");
    await addMatch(monitor, "t3_one");
    await addMatch(monitor, "t3_two", true);

    const report = await registrationsOn(db, day);

    expect(report.date).toBe(day);
    expect(report.users).toHaveLength(1);
    expect(report.users[0]).toMatchObject({
      id: "today",
      email: "today@example.test",
      projects: 2,
      monitors: 1,
      matches: 2,
    });
  });

  it("leaves out an account created on another day", async () => {
    await addUser("yesterday", new Date("2026-09-09T23:59:59.000Z"));
    await addUser("today", new Date("2026-09-10T00:00:00.000Z"));

    const report = await registrationsOn(db, day);

    expect(report.users.map((one) => one.id)).toEqual(["today"]);
  });

  it("counts an account with nothing in it as zero, not as absent", async () => {
    await addUser("empty", new Date("2026-09-10T12:00:00.000Z"));

    const report = await registrationsOn(db, day);

    expect(report.users[0]).toMatchObject({ id: "empty", projects: 0, monitors: 0, matches: 0 });
  });

  it("adds the day's accounts into one set of totals", async () => {
    await addUser("one", new Date("2026-09-10T01:00:00.000Z"));
    await addUser("two", new Date("2026-09-10T02:00:00.000Z"));
    await addProject("one", "Acme QA");
    const monitor = await addMonitor("two", "Flaky tests");
    await addMatch(monitor, "t3_three");

    const report = await registrationsOn(db, day);

    expect(report.totals).toEqual({ users: 2, projects: 1, monitors: 1, matches: 1 });
  });
});
