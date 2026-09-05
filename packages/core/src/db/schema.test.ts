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
 * `model_calls`, `api_usage` and `budgets` carry a fourth: the budget guard.
 * What a monitor spent is added up from those tables, so a deleted post must
 * not take the record of what reading it cost with it, and a charge must not
 * be able to be recorded twice for one day.
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

/** One day's usage at one source. Returns its id. */
async function insertUsage(overrides: Record<string, unknown> = {}): Promise<string> {
  const values = {
    monitor_id: overrides.monitor_id ?? (await insertMonitor()),
    source: "reddit",
    provider: "brightdata",
    day: "2026-03-14",
    units: 10,
    estimated_cost_micros: 15_000,
    ...overrides,
  };
  const columns = Object.keys(values);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const result = await sql.query<{ id: string }>(
    `INSERT INTO api_usage (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING id`,
    Object.values(values),
  );
  return only(result.rows).id;
}

/** One monitor's cap. Returns the monitor it belongs to. */
async function insertBudget(overrides: Record<string, unknown> = {}): Promise<string> {
  const values = {
    monitor_id: overrides.monitor_id ?? (await insertMonitor()),
    monthly_cap_micros: 5_000_000,
    on_exhausted: "pause",
    ...overrides,
  };
  const columns = Object.keys(values);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const result = await sql.query<{ monitor_id: string }>(
    `INSERT INTO budgets (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING monitor_id`,
    Object.values(values),
  );
  return only(result.rows).monitor_id;
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

  it("keeps the provider out of the deduplication key", async () => {
    // The same Reddit post fetched through two providers is one post. A key
    // that read the provider would make it two rows, and the second one a
    // second classification, a second embedding and a second charge for the
    // same conversation.
    await insertPost({ external_id: "t3_two_providers", provider: "brightdata" });

    await expect(
      insertPost({ external_id: "t3_two_providers", provider: "scrapecreators" }),
    ).rejects.toThrow(/duplicate key value/);
  });

  it("stores a post whose provider we cannot say", async () => {
    // Every row written before US-024. Null means "we cannot say", never "no
    // provider".
    const id = await insertPost({ external_id: "t3_unattributed", provider: null });

    const result = await sql.query<{ provider: string | null }>(
      "SELECT provider FROM posts WHERE id = $1",
      [id],
    );

    expect(only(result.rows).provider).toBeNull();
  });

  it("refuses a provider this build has no connector for", async () => {
    await expect(insertPost({ external_id: "t3_bad", provider: "mastodon" })).rejects.toThrow(
      /posts_provider_known/,
    );
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

  it("starts at the permissive default threshold", async () => {
    const monitorId = await insertMonitor();

    const row = only(
      (
        await sql.query<{ min_score: number }>("SELECT min_score FROM monitors WHERE id = $1", [
          monitorId,
        ])
      ).rows,
    );

    expect(row.min_score).toBe(30);
  });

  it("accepts the ends of the threshold range and refuses either side", async () => {
    await expect(insertMonitor({ min_score: 0 })).resolves.toEqual(expect.any(String));
    await expect(insertMonitor({ min_score: 100 })).resolves.toEqual(expect.any(String));
    await expect(insertMonitor({ min_score: 101 })).rejects.toThrow(/violates check constraint/);
    await expect(insertMonitor({ min_score: -1 })).rejects.toThrow(/violates check constraint/);
  });

  it("starts with the pre-filter on and its similarity bar low", async () => {
    const monitorId = await insertMonitor();

    const row = only(
      (
        await sql.query<{ pre_filter_enabled: boolean; similarity_threshold: number }>(
          "SELECT pre_filter_enabled, similarity_threshold FROM monitors WHERE id = $1",
          [monitorId],
        )
      ).rows,
    );

    // On, because the filter is what keeps the model bill low. Low, because a
    // threshold that drops a good lead leaves no trace anybody can read.
    expect(row.pre_filter_enabled).toBe(true);
    expect(row.similarity_threshold).toBeCloseTo(0.15, 5);
  });

  it("accepts the ends of the similarity range and refuses either side", async () => {
    // Zero is "keep everything the keyword stage kept", which is how a person
    // turns the second stage off without turning the first one off.
    await expect(insertMonitor({ similarity_threshold: 0 })).resolves.toEqual(expect.any(String));
    await expect(insertMonitor({ similarity_threshold: 1 })).resolves.toEqual(expect.any(String));
    await expect(insertMonitor({ similarity_threshold: 1.2 })).rejects.toThrow(
      /violates check constraint/,
    );
    await expect(insertMonitor({ similarity_threshold: -0.1 })).rejects.toThrow(
      /violates check constraint/,
    );
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

describe("model calls", () => {
  /** One recorded call to a model. Returns its id. */
  async function insertModelCall(overrides: Record<string, unknown> = {}): Promise<string> {
    const values = {
      monitor_id: overrides.monitor_id ?? (await insertMonitor()),
      post_id: overrides.post_id ?? (await insertPost()),
      provider: "anthropic",
      model: "claude-haiku-4-5",
      outcome: "scored",
      monitor_version: 1,
      input_tokens: 900,
      output_tokens: 120,
      latency_ms: 1_400,
      estimated_cost_micros: 1_500,
      ...overrides,
    };
    const columns = Object.keys(values);
    const placeholders = columns.map((_, index) => `$${index + 1}`);
    const result = await sql.query<{ id: string }>(
      `INSERT INTO model_calls (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING id`,
      Object.values(values),
    );
    return only(result.rows).id;
  }

  it.each(["scored", "rejected", "failed"])("records a call that ended as %s", async (outcome) => {
    await expect(insertModelCall({ outcome })).resolves.toEqual(expect.any(String));
  });

  it.each(["classification", "query_generation", "embedding"])(
    "records a call made for %s",
    async (purpose) => {
      // Three kinds of call and three prices. A bill that could not tell them
      // apart could not answer "what was my key spent on".
      await expect(insertModelCall({ purpose })).resolves.toEqual(expect.any(String));
    },
  );

  it("refuses a purpose no caller has", async () => {
    await expect(insertModelCall({ purpose: "summarising" })).rejects.toThrow(
      /violates check constraint/,
    );
  });

  it("refuses an outcome the classifier cannot produce", async () => {
    await expect(insertModelCall({ outcome: "maybe" })).rejects.toThrow(
      /violates check constraint/,
    );
  });

  /**
   * BUG-003. The classify step skips a post it has already scored by reading
   * this column, so a classification written without one is a call that will
   * be made and paid for again on the next poll. The constraint is here rather
   * than only in the writer because the cost of forgetting is silent.
   */
  it("refuses a classification that does not say which version it answered", async () => {
    await expect(
      insertModelCall({ purpose: "classification", monitor_version: null }),
    ).rejects.toThrow(/violates check constraint/);
  });

  /** A call no version describes: the queries are written before the monitor. */
  it("records a query generation with no version and no monitor", async () => {
    await expect(
      insertModelCall({ purpose: "query_generation", monitor_id: null, monitor_version: null }),
    ).resolves.toEqual(expect.any(String));
  });

  /**
   * The bill outlives the row. A user asking what their key was spent on must
   * get an answer after the post has been deleted, so the foreign key sets
   * null rather than cascading.
   */
  it("keeps the record when the post it read is deleted", async () => {
    const postId = await insertPost();
    const callId = await insertModelCall({ post_id: postId });

    await sql.query("DELETE FROM posts WHERE id = $1", [postId]);

    const row = only(
      (
        await sql.query<{ post_id: string | null; estimated_cost_micros: number }>(
          "SELECT post_id, estimated_cost_micros FROM model_calls WHERE id = $1",
          [callId],
        )
      ).rows,
    );

    expect(row.post_id).toBeNull();
    expect(row.estimated_cost_micros).toBe(1_500);
  });

  /** Null is "we cannot say what this cost". Zero would be a claim. */
  it("holds no cost for a model whose price nobody configured", async () => {
    const callId = await insertModelCall({ estimated_cost_micros: null });

    const row = only(
      (
        await sql.query<{ estimated_cost_micros: number | null }>(
          "SELECT estimated_cost_micros FROM model_calls WHERE id = $1",
          [callId],
        )
      ).rows,
    );

    expect(row.estimated_cost_micros).toBeNull();
  });
});

describe("filter drops", () => {
  /** One post the pre-filter kept from the model. Returns its id. */
  async function insertDrop(overrides: Record<string, unknown> = {}): Promise<string> {
    const values = {
      monitor_id: overrides.monitor_id ?? (await insertMonitor()),
      post_id: overrides.post_id ?? (await insertPost()),
      stage: "embedding",
      similarity: 0.08,
      ...overrides,
    };
    const columns = Object.keys(values);
    const placeholders = columns.map((_, index) => `$${index + 1}`);
    const result = await sql.query<{ id: string }>(
      `INSERT INTO filter_drops (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING id`,
      Object.values(values),
    );
    return only(result.rows).id;
  }

  it.each(["keyword", "embedding"])("records a drop made by the %s stage", async (stage) => {
    await expect(insertDrop({ stage })).resolves.toEqual(expect.any(String));
  });

  it("refuses a stage the pre-filter does not have", async () => {
    await expect(insertDrop({ stage: "vibes" })).rejects.toThrow(/violates check constraint/);
  });

  /** Nothing was embedded at the keyword stage, so nothing was measured. */
  it("holds no similarity for a keyword drop", async () => {
    const id = await insertDrop({ stage: "keyword", similarity: null });

    const row = only(
      (
        await sql.query<{ similarity: number | null }>(
          "SELECT similarity FROM filter_drops WHERE id = $1",
          [id],
        )
      ).rows,
    );

    expect(row.similarity).toBeNull();
  });

  it("refuses a similarity no cosine distance can produce", async () => {
    await expect(insertDrop({ similarity: 1.4 })).rejects.toThrow(/violates check constraint/);
  });

  /**
   * A poll returns posts it has returned before. One row per post per monitor
   * is what makes the counter on the monitor list a count of posts.
   */
  it("holds one drop per post per monitor", async () => {
    const monitorId = await insertMonitor();
    const postId = await insertPost();

    await insertDrop({ monitor_id: monitorId, post_id: postId });

    await expect(insertDrop({ monitor_id: monitorId, post_id: postId })).rejects.toThrow(
      /duplicate key value/,
    );
  });

  it("lets two monitors each drop the same post", async () => {
    const postId = await insertPost();

    await insertDrop({ post_id: postId });
    await expect(insertDrop({ post_id: postId })).resolves.toEqual(expect.any(String));
  });

  /**
   * Unlike `model_calls`, this row is evidence about a post and not about a
   * bill. When the post goes, the evidence has nothing left to describe.
   */
  it("forgets the drop when the post it describes is deleted", async () => {
    const postId = await insertPost();
    await insertDrop({ post_id: postId });

    await sql.query("DELETE FROM posts WHERE id = $1", [postId]);

    const result = await sql.query("SELECT id FROM filter_drops WHERE post_id = $1", [postId]);
    expect(result.rows).toHaveLength(0);
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
  // The monitor and its version are read from the match rather than passed
  // in, so a case here cannot record a verdict against a monitor the match
  // does not belong to. `feedback.ts` reads them the same way.
  async function insertVerdict(matchId: string, userId: string, verdict: string) {
    const result = await sql.query<{ id: string }>(
      `INSERT INTO feedback (match_id, monitor_id, monitor_version, user_id, verdict)
       SELECT match.id, match.monitor_id, monitor.version, $2, $3
       FROM matches match
       JOIN monitors monitor ON monitor.id = match.monitor_id
       WHERE match.id = $1
       RETURNING id`,
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
/** A collection started at a source and not yet read. Returns its id. */
async function insertContinuation(overrides: Record<string, unknown> = {}): Promise<string> {
  const values = {
    monitor_id: overrides.monitor_id ?? (await insertMonitor()),
    source: "reddit",
    provider: "brightdata",
    cursor: "keyword|s_abc123|0",
    resume_after: new Date("2026-09-05T10:00:30.000Z"),
    ...overrides,
  };
  const columns = Object.keys(values);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const result = await sql.query<{ id: string }>(
    `INSERT INTO source_continuations (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING id`,
    Object.values(values),
  );
  return only(result.rows).id;
}

describe("source continuations", () => {
  it("holds one collection in flight per monitor and source", async () => {
    // The constraint is the guarantee. Two workers polling the same monitor at
    // once is a state this product expects, and the second one must not be
    // able to record a second collection for a query already collecting.
    const monitorId = await insertMonitor();

    await insertContinuation({ monitor_id: monitorId, cursor: "keyword|s_first|0" });

    await expect(
      insertContinuation({ monitor_id: monitorId, cursor: "keyword|s_second|0" }),
    ).rejects.toThrow(/duplicate key value/);
  });

  it("lets one monitor wait on a collection at each of its sources", async () => {
    const monitorId = await insertMonitor();

    await insertContinuation({ monitor_id: monitorId, source: "reddit" });

    await expect(insertContinuation({ monitor_id: monitorId, source: "x" })).resolves.toEqual(
      expect.any(String),
    );
  });

  it("lets two providers each collect the same source for one monitor", async () => {
    // A snapshot id belongs to the provider that issued it. Without the
    // provider in the key one of the two collections overwrites the other's
    // cursor, and the records behind it are money spent on nothing.
    const monitorId = await insertMonitor();

    await insertContinuation({ monitor_id: monitorId, provider: "brightdata" });

    await expect(
      insertContinuation({ monitor_id: monitorId, provider: "scrapecreators" }),
    ).resolves.toEqual(expect.any(String));
  });

  it("refuses a source the schema cannot store posts for", async () => {
    await expect(insertContinuation({ source: "mastodon" })).rejects.toThrow(
      /source_continuations_source_known/,
    );
  });

  it("refuses a provider this build has no connector for", async () => {
    await expect(insertContinuation({ provider: "mastodon" })).rejects.toThrow(
      /source_continuations_provider_known/,
    );
  });

  it("counts no resumes until one happens", async () => {
    const id = await insertContinuation();
    const row = only(
      (
        await sql.query<{ attempts: number }>(
          "SELECT attempts FROM source_continuations WHERE id = $1",
          [id],
        )
      ).rows,
    );

    expect(row.attempts).toBe(0);
  });

  it("forgets the collection when the monitor it belongs to is deleted", async () => {
    // Nothing may resume a collection for a monitor that is gone. The row
    // would otherwise name a monitor the poll step cannot load.
    const monitorId = await insertMonitor();
    await insertContinuation({ monitor_id: monitorId });

    await sql.query("DELETE FROM monitors WHERE id = $1", [monitorId]);

    const remaining = await sql.query("SELECT id FROM source_continuations WHERE monitor_id = $1", [
      monitorId,
    ]);

    expect(remaining.rows).toHaveLength(0);
  });
});

describe("usage and budgets", () => {
  it("holds one row per monitor, source and day, so a poll adds rather than inserts", async () => {
    // The guard sums this table before every poll. A row per page would make
    // that sum grow without limit inside one month.
    const monitorId = await insertMonitor();

    await insertUsage({ monitor_id: monitorId, day: "2026-03-14" });

    await expect(insertUsage({ monitor_id: monitorId, day: "2026-03-14" })).rejects.toThrow(
      /duplicate key value/,
    );
  });

  it("keeps a second day and a second source apart", async () => {
    const monitorId = await insertMonitor();

    await insertUsage({ monitor_id: monitorId, day: "2026-03-14", source: "reddit" });

    await expect(
      insertUsage({ monitor_id: monitorId, day: "2026-03-15", source: "reddit" }),
    ).resolves.toEqual(expect.any(String));
    await expect(
      insertUsage({ monitor_id: monitorId, day: "2026-03-14", source: "x" }),
    ).resolves.toEqual(expect.any(String));
  });

  it("keeps two providers on one source and day apart", async () => {
    // `units` is comparable only inside one connector, and two providers do
    // not bill the same unit at the same price. One row for both would be
    // adding records to post reads.
    const monitorId = await insertMonitor();

    await insertUsage({ monitor_id: monitorId, day: "2026-03-14", provider: "brightdata" });

    await expect(
      insertUsage({ monitor_id: monitorId, day: "2026-03-14", provider: "scrapecreators" }),
    ).resolves.toEqual(expect.any(String));
  });

  it("refuses a source the schema cannot store posts for", async () => {
    await expect(insertUsage({ source: "mastodon" })).rejects.toThrow(/api_usage_source_known/);
  });

  it("refuses a provider this build has no connector for", async () => {
    await expect(insertUsage({ provider: "mastodon" })).rejects.toThrow(/api_usage_provider_known/);
  });

  it("refuses a negative charge, which is a bug and never a refund", async () => {
    await expect(insertUsage({ units: -1 })).rejects.toThrow(/api_usage_units_non_negative/);
    await expect(insertUsage({ estimated_cost_micros: -1 })).rejects.toThrow(
      /api_usage_cost_non_negative/,
    );
  });

  it("holds an amount an integer column could not, because micros are small", async () => {
    // Two thousand one hundred and forty-eight dollars is past a 32-bit
    // integer of micro-dollars. A month can cost that, and the total has to be
    // able to say so.
    const id = await insertUsage({ estimated_cost_micros: 3_000_000_000 });
    const row = only(
      (
        await sql.query<{ estimated_cost_micros: string }>(
          "SELECT estimated_cost_micros FROM api_usage WHERE id = $1",
          [id],
        )
      ).rows,
    );

    expect(Number(row.estimated_cost_micros)).toBe(3_000_000_000);
  });

  it("holds one cap per monitor, because two caps would disagree", async () => {
    const monitorId = await insertMonitor();

    await insertBudget({ monitor_id: monitorId });

    await expect(insertBudget({ monitor_id: monitorId })).rejects.toThrow(/duplicate key value/);
  });

  it("allows a cap of nothing, and refuses one below it", async () => {
    // "This monitor may spend nothing" is a real thing to ask for. A negative
    // cap is not.
    await expect(insertBudget({ monthly_cap_micros: 0 })).resolves.toEqual(expect.any(String));
    await expect(insertBudget({ monthly_cap_micros: -1 })).rejects.toThrow(
      /budgets_cap_non_negative/,
    );
  });

  it("refuses a behaviour the product has no button for", async () => {
    await expect(insertBudget({ on_exhausted: "delete_everything" })).rejects.toThrow(
      /budgets_on_exhausted_known/,
    );
  });

  it("forgets the usage and the cap when the monitor is deleted", async () => {
    // Unlike `model_calls`, which survives its post. A monitor that is gone
    // has no bill page to read, and nothing else joins to these rows.
    const monitorId = await insertMonitor();

    await insertUsage({ monitor_id: monitorId });
    await insertBudget({ monitor_id: monitorId });
    await sql.query("DELETE FROM monitors WHERE id = $1", [monitorId]);

    expect(
      (await sql.query("SELECT id FROM api_usage WHERE monitor_id = $1", [monitorId])).rows,
    ).toHaveLength(0);
    expect(
      (await sql.query("SELECT monitor_id FROM budgets WHERE monitor_id = $1", [monitorId])).rows,
    ).toHaveLength(0);
  });
});

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
          .values({
            matchId: match.id,
            monitorId: monitor.id,
            monitorVersion: monitor.version,
            userId: "user-1",
            verdict: "good",
          })
          .returning(),
      );

      expect(monitor.generatedQueries).toEqual([
        { source: "reddit", query: "manual regression testing" },
      ]);
      expect(post.embedding).toHaveLength(schema.embeddingDimensions);
      expect(match.hidden).toBe(false);
      expect(match.readAt).toBeNull();
      expect(match.lastVerifiedAt).toBeInstanceOf(Date);
      expect(monitor.version).toBe(1);
      expect(verdict.monitorVersion).toBe(1);
      expect(verdict.supersededAt).toBeNull();
    } finally {
      await close();
    }
  });
});
