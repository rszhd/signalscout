/**
 * Correctness-critical: three of the five surfaces in docs/testing.md meet in
 * this schema, and each is a database constraint rather than code.
 *
 * - Cursor and deduplication — `UNIQUE (source, external_id)` on posts. An X
 *   read costs $0.005, so a re-read window is a charge, not a duplicate row.
 * - Classification schema — the score and intent-type checks on matches. An
 *   out-of-range score must be rejected, not stored as if it were a verdict.
 * - Deletion reconciliation — `last_verified_at` and `hidden` on matches. The
 *   reconciliation job needs somewhere to record what it checked.
 *
 * The assertions here were written before the schema, and each guard is
 * separated from its absence: a value that must pass sits next to the value
 * that must fail, so a dropped constraint turns a test red.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { createDatabase } from "./client.js";
import * as schema from "./schema.js";

let database: TestDatabase;
let sql: Awaited<ReturnType<typeof openPool>>;

async function openPool() {
  const { pool, close } = createDatabase(database.url);
  return { query: pool.query.bind(pool), close };
}

beforeAll(async () => {
  database = await createTestDatabase("schema");
  sql = await openPool();
}, 60_000);

afterAll(async () => {
  await sql?.close();
  await database?.drop();
});

/** The one row a query must have returned. A different count is a failed test, not a crash. */
function only<Row>(rows: Row[]): Row {
  expect(rows).toHaveLength(1);
  const [row] = rows;
  if (!row) throw new Error("expected exactly one row");
  return row;
}

/** A monitor with the four answers filled in. Returns its id. */
async function insertMonitor(overrides: Record<string, unknown> = {}): Promise<string> {
  const values = {
    user_id: "user-1",
    name: `Journeys ${++sequence}`,
    product: "An AI browser agent that runs repetitive manual QA flows.",
    ideal_customer: "Small SaaS teams with 2-20 developers and no dedicated QA.",
    problem: "Repetitive manual regression testing and brittle Playwright suites.",
    signals: ["recommendation_request", "alternative_search"],
    ...overrides,
  };
  const columns = Object.keys(values);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const result = await sql.query<{ id: string }>(
    `INSERT INTO monitors (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING id`,
    Object.values(values),
  );
  return only(result.rows).id;
}

/** Unique per call, so a helper that inserts twice does not trip the constraint under test. */
let sequence = 0;

/** A post as the Reddit connector would store one. Returns its id. */
async function insertPost(overrides: Record<string, unknown> = {}): Promise<string> {
  const values = {
    source: "reddit",
    external_id: `t3_seq${++sequence}`,
    url: "https://reddit.com/r/SaaS/comments/abc123",
    author: "u/bootstrapped_ben",
    channel: "r/SaaS",
    title: "How are small teams handling regression testing?",
    excerpt: "We're only three developers and manually check signup before every release.",
    posted_at: new Date("2026-09-04T10:00:00Z"),
    ...overrides,
  };
  const columns = Object.keys(values);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const result = await sql.query<{ id: string }>(
    `INSERT INTO posts (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING id`,
    Object.values(values),
  );
  return only(result.rows).id;
}

/** A classified match. Returns its id. */
async function insertMatch(overrides: Record<string, unknown> = {}): Promise<string> {
  const values = {
    monitor_id: overrides.monitor_id ?? (await insertMonitor()),
    post_id: overrides.post_id ?? (await insertPost()),
    score: 94,
    relevance: 98,
    problem_fit: 98,
    icp_fit: 91,
    intent: 94,
    urgency: 88,
    intent_type: "recommendation_request",
    reasons: ["Small SaaS team", "Explicit manual-testing pain"],
    ...overrides,
  };
  const columns = Object.keys(values);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const result = await sql.query<{ id: string }>(
    `INSERT INTO matches (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING id`,
    Object.values(values),
  );
  return only(result.rows).id;
}

describe("posts", () => {
  it("refuses the same post from the same source twice", async () => {
    await insertPost({ external_id: "t3_duplicate" });

    await expect(insertPost({ external_id: "t3_duplicate" })).rejects.toThrow(
      /duplicate key value/,
    );
  });

  it("accepts the same external id from a different source", async () => {
    await insertPost({ source: "reddit", external_id: "shared-id" });

    await expect(insertPost({ source: "x", external_id: "shared-id" })).resolves.toEqual(
      expect.any(String),
    );
  });

  it("stores a post with no embedding, because a filtered-out post never earns one", async () => {
    const id = await insertPost({ external_id: "t3_noembedding" });

    const result = await sql.query<{ embedding: string | null }>(
      "SELECT embedding FROM posts WHERE id = $1",
      [id],
    );

    expect(only(result.rows).embedding).toBeNull();
  });

  it("refuses a source PLAN.md's first version does not build", async () => {
    await expect(insertPost({ source: "mastodon" })).rejects.toThrow(/violates check constraint/);
  });

  it("stores and returns a pgvector embedding", async () => {
    const embedding = Array.from({ length: 1536 }, (_, index) => index / 1536);
    const id = await insertPost({
      external_id: "t3_embedded",
      embedding: `[${embedding.join(",")}]`,
    });

    const result = await sql.query<{ dimensions: number }>(
      "SELECT vector_dims(embedding) AS dimensions FROM posts WHERE id = $1",
      [id],
    );

    expect(only(result.rows).dimensions).toBe(1536);
  });
});

describe("monitors", () => {
  it("keeps the four answers and the generated queries in separate columns", async () => {
    const id = await insertMonitor({ name: "Regeneration" });

    await sql.query(
      `UPDATE monitors
          SET generated_queries = $2, generated_subreddits = $3
        WHERE id = $1`,
      [
        id,
        JSON.stringify([{ source: "reddit", query: "manual QA regression testing" }]),
        ["SaaS", "webdev"],
      ],
    );

    const result = await sql.query<{
      product: string;
      generated_queries: { source: string; query: string }[];
      generated_subreddits: string[];
    }>("SELECT product, generated_queries, generated_subreddits FROM monitors WHERE id = $1", [id]);

    expect(only(result.rows).product).toBe(
      "An AI browser agent that runs repetitive manual QA flows.",
    );
    expect(only(result.rows).generated_queries).toEqual([
      { source: "reddit", query: "manual QA regression testing" },
    ]);
    expect(only(result.rows).generated_subreddits).toEqual(["SaaS", "webdev"]);
  });

  it("starts with no generated queries, so a new monitor is not silently searchable", async () => {
    const id = await insertMonitor({ name: "Fresh" });

    const result = await sql.query<{ generated_queries: unknown[] }>(
      "SELECT generated_queries FROM monitors WHERE id = $1",
      [id],
    );

    expect(only(result.rows).generated_queries).toEqual([]);
  });
});

describe("matches", () => {
  it("accepts the ends of the score range", async () => {
    await expect(insertMatch({ score: 0, intent: 0 })).resolves.toEqual(expect.any(String));
    await expect(insertMatch({ score: 100, intent: 100 })).resolves.toEqual(expect.any(String));
  });

  it.each(["score", "relevance", "problem_fit", "icp_fit", "intent", "urgency"])(
    "refuses a %s above 100",
    async (column) => {
      await expect(insertMatch({ [column]: 101 })).rejects.toThrow(/violates check constraint/);
    },
  );

  it.each(["score", "relevance", "problem_fit", "icp_fit", "intent", "urgency"])(
    "refuses a negative %s",
    async (column) => {
      await expect(insertMatch({ [column]: -1 })).rejects.toThrow(/violates check constraint/);
    },
  );

  it.each([
    "none",
    "problem",
    "recommendation_request",
    "alternative_search",
    "competitor_complaint",
    "comparison",
    "purchase",
    "hiring",
  ])("accepts the intent type %s from PLAN.md", async (intentType) => {
    await expect(insertMatch({ intent_type: intentType })).resolves.toEqual(expect.any(String));
  });

  it("refuses an intent type PLAN.md does not list", async () => {
    await expect(insertMatch({ intent_type: "curious" })).rejects.toThrow(
      /violates check constraint/,
    );
  });

  it("counts a new match as verified now, so no row ever holds a null verification", async () => {
    const before = new Date();
    const id = await insertMatch();

    const result = await sql.query<{
      last_verified_at: Date;
      hidden: boolean;
      read_at: Date | null;
    }>("SELECT last_verified_at, hidden, read_at FROM matches WHERE id = $1", [id]);

    expect(only(result.rows).last_verified_at.getTime()).toBeGreaterThanOrEqual(
      before.getTime() - 1000,
    );
    expect(only(result.rows).hidden).toBe(false);
    expect(only(result.rows).read_at).toBeNull();
  });

  it("keeps the score and the reason when a deleted post is hidden", async () => {
    const id = await insertMatch();

    await sql.query("UPDATE matches SET hidden = true, last_verified_at = now() WHERE id = $1", [
      id,
    ]);

    const result = await sql.query<{ hidden: boolean; score: number; reasons: string[] }>(
      "SELECT hidden, score, reasons FROM matches WHERE id = $1",
      [id],
    );

    expect(only(result.rows)).toMatchObject({
      hidden: true,
      score: 94,
      reasons: ["Small SaaS team", "Explicit manual-testing pain"],
    });
  });

  it("matches one post to one monitor once", async () => {
    const monitorId = await insertMonitor();
    const postId = await insertPost({ external_id: "t3_onceonly" });

    await insertMatch({ monitor_id: monitorId, post_id: postId });

    await expect(insertMatch({ monitor_id: monitorId, post_id: postId })).rejects.toThrow(
      /duplicate key value/,
    );
  });

  it("matches one post to two monitors, because a post is shared", async () => {
    const postId = await insertPost({ external_id: "t3_shared" });

    await insertMatch({ monitor_id: await insertMonitor(), post_id: postId });

    await expect(
      insertMatch({ monitor_id: await insertMonitor(), post_id: postId }),
    ).resolves.toEqual(expect.any(String));
  });
});

describe("feedback", () => {
  async function insertVerdict(matchId: string, userId: string, verdict: string) {
    const result = await sql.query<{ id: string }>(
      "INSERT INTO feedback (match_id, user_id, verdict) VALUES ($1, $2, $3) RETURNING id",
      [matchId, userId, verdict],
    );
    return only(result.rows).id;
  }

  it("records the verdict, the user, the match and the time", async () => {
    const matchId = await insertMatch();
    const before = new Date();

    const id = await insertVerdict(matchId, "user-1", "good");

    const result = await sql.query<{
      match_id: string;
      user_id: string;
      verdict: string;
      created_at: Date;
      superseded_at: Date | null;
    }>("SELECT match_id, user_id, verdict, created_at, superseded_at FROM feedback WHERE id = $1", [
      id,
    ]);

    expect(only(result.rows)).toMatchObject({
      match_id: matchId,
      user_id: "user-1",
      verdict: "good",
      superseded_at: null,
    });
    expect(only(result.rows).created_at.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });

  it("refuses a verdict PLAN.md's two buttons cannot produce", async () => {
    const matchId = await insertMatch();

    await expect(insertVerdict(matchId, "user-1", "maybe")).rejects.toThrow(
      /violates check constraint/,
    );
  });

  it("holds one current verdict per match per user", async () => {
    const matchId = await insertMatch();
    await insertVerdict(matchId, "user-1", "good");

    await expect(insertVerdict(matchId, "user-1", "not_relevant")).rejects.toThrow(
      /duplicate key value/,
    );
  });

  it("records a changed verdict rather than overwriting the first", async () => {
    const matchId = await insertMatch();
    const firstId = await insertVerdict(matchId, "user-1", "good");

    await sql.query("UPDATE feedback SET superseded_at = now() WHERE id = $1", [firstId]);
    await insertVerdict(matchId, "user-1", "not_relevant");

    const result = await sql.query<{ verdict: string; superseded: boolean }>(
      `SELECT verdict, superseded_at IS NOT NULL AS superseded
         FROM feedback WHERE match_id = $1 ORDER BY created_at`,
      [matchId],
    );

    expect(result.rows).toEqual([
      { verdict: "good", superseded: true },
      { verdict: "not_relevant", superseded: false },
    ]);
  });

  it("lets two users each hold a verdict on the same match", async () => {
    const matchId = await insertMatch();
    await insertVerdict(matchId, "user-1", "good");

    await expect(insertVerdict(matchId, "user-2", "not_relevant")).resolves.toEqual(
      expect.any(String),
    );
  });

  it("drops the feedback when the match it describes is deleted", async () => {
    const matchId = await insertMatch();
    await insertVerdict(matchId, "user-1", "good");

    await sql.query("DELETE FROM matches WHERE id = $1", [matchId]);

    const result = await sql.query("SELECT id FROM feedback WHERE match_id = $1", [matchId]);
    expect(result.rows).toHaveLength(0);
  });
});

/**
 * The migration is generated from the Drizzle schema, so the two agree today.
 * This holds them together: a hand edit to either side that the other does not
 * follow turns this red, rather than failing at the first real insert.
 */
describe("the Drizzle schema and the tables agree", () => {
  it("writes and reads a monitor, a post, a match and a verdict", async () => {
    const { db, close } = createDatabase(database.url);

    try {
      const monitor = only(
        await db
          .insert(schema.monitors)
          .values({
            userId: "user-1",
            name: "Journeys",
            product: "An AI browser agent that runs repetitive manual QA flows.",
            idealCustomer: "Small SaaS teams with 2-20 developers.",
            problem: "Brittle Playwright suites.",
            signals: ["recommendation_request"],
            generatedQueries: [{ source: "reddit", query: "manual regression testing" }],
            generatedSubreddits: ["SaaS"],
          })
          .returning(),
      );

      const post = only(
        await db
          .insert(schema.posts)
          .values({
            source: "x",
            externalId: "1234567890",
            url: "https://x.com/maria_builds/status/1234567890",
            author: "@maria_builds",
            excerpt: "Our E2E suite is red after every frontend change.",
            postedAt: new Date("2026-09-04T09:00:00Z"),
            embedding: Array.from({ length: schema.embeddingDimensions }, () => 0.5),
          })
          .returning(),
      );

      const match = only(
        await db
          .insert(schema.matches)
          .values({
            monitorId: monitor.id,
            postId: post.id,
            score: 91,
            relevance: 96,
            problemFit: 96,
            icpFit: 87,
            intent: 91,
            urgency: 78,
            intentType: "alternative_search",
            reasons: ["Founder at a SaaS", "Current tool frustration"],
          })
          .returning(),
      );

      const verdict = only(
        await db
          .insert(schema.feedback)
          .values({ matchId: match.id, userId: "user-1", verdict: "good" })
          .returning(),
      );

      expect(monitor.generatedQueries).toEqual([
        { source: "reddit", query: "manual regression testing" },
      ]);
      expect(post.embedding).toHaveLength(schema.embeddingDimensions);
      expect(match.hidden).toBe(false);
      expect(match.readAt).toBeNull();
      expect(match.lastVerifiedAt).toBeInstanceOf(Date);
      expect(verdict.supersededAt).toBeNull();
    } finally {
      await close();
    }
  });
});
