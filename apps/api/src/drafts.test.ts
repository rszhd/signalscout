/**
 * The draft route and the prompt library.
 *
 * The screen half is asserted in `apps/web/src/ReplyDraft.test.tsx`, and the
 * prompt's wording in `packages/pipeline/src/ai/reply.test.ts`. What this file
 * owns is the route's promises: that a saved prompt actually reaches the
 * model, that a monitor at its cap refuses to spend, that a draft is recorded
 * on the bill, and that a prompt belongs to the account rather than to
 * whoever asked for it.
 *
 * **No test reaches a model.** The drafter is not stubbed here because the
 * route builds its own; the tests that would need one assert the refusals
 * instead, and `vitest.config.ts` blanks `AI_API_KEY` so a machine with a key
 * exported cannot spend one by accident.
 */
import type { Database } from "@signalscout/pipeline";
import {
  budgets,
  createDatabase,
  createLogger,
  createReplyPrompt,
  listReplyPrompts,
  matches,
  modelCalls,
  monitors,
  posts,
  replyPrompts,
} from "@signalscout/pipeline";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { unclaimedUserId } from "./auth/user.js";
import { loadEnv } from "./config/env.js";
import { buildServer } from "./server.js";
import { asOwner, asUser, createTestDatabase, type TestDatabase } from "./testing.js";

const logger = createLogger({ level: "silent", name: "test" });

describe("the saved reply prompts", () => {
  let database: TestDatabase;
  let db: Database;
  let close: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    database = await createTestDatabase("api_drafts");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(replyPrompts);
  });

  async function server() {
    return await buildServer({
      session: asOwner,
      env: loadEnv({ DATABASE_URL: database.url }),
      logger,
      db,
      queryGenerator: null,
    });
  }

  it("saves a prompt and lists it back", async () => {
    const app = await server();

    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/reply-prompts",
        payload: { name: "Short and plain", instruction: "No exclamation marks." },
      });

      expect(created.statusCode).toBe(201);

      const listed = await app.inject({ method: "GET", url: "/api/reply-prompts" });
      const body = listed.json() as { prompts: { name: string; instruction: string }[] };

      expect(body.prompts).toHaveLength(1);
      expect(body.prompts[0]?.name).toBe("Short and plain");
    } finally {
      await app.close();
    }
  });

  it("keeps several, because a person replies differently in different rooms", async () => {
    const app = await server();

    try {
      for (const name of ["Short", "Longer", "Technical"]) {
        const answer = await app.inject({
          method: "POST",
          url: "/api/reply-prompts",
          payload: { name, instruction: `Write in the ${name} voice.` },
        });
        expect(answer.statusCode).toBe(201);
      }

      const body = (await app.inject({ method: "GET", url: "/api/reply-prompts" })).json() as {
        prompts: { name: string }[];
      };

      // Ordered by name, case-insensitively, because this is a list somebody
      // chooses from rather than a history.
      expect(body.prompts.map((prompt) => prompt.name)).toEqual(["Longer", "Short", "Technical"]);
    } finally {
      await app.close();
    }
  });

  it("refuses a second prompt with the same name, rather than making it unique", async () => {
    // Two prompts called the same thing are a person choosing blind.
    const app = await server();

    try {
      await app.inject({
        method: "POST",
        url: "/api/reply-prompts",
        payload: { name: "Plain", instruction: "One." },
      });

      const again = await app.inject({
        method: "POST",
        url: "/api/reply-prompts",
        payload: { name: "plain", instruction: "Two." },
      });

      expect(again.statusCode).toBe(409);
      expect((again.json() as { message: string }).message).toContain("already have a prompt");
    } finally {
      await app.close();
    }
  });

  it("edits one field without erasing the other", async () => {
    // US-022 fixed exactly this on monitors: a PATCH carrying one field must
    // not erase the rest.
    const app = await server();
    const saved = await createReplyPrompt(db, unclaimedUserId, {
      name: "Plain",
      instruction: "No exclamation marks.",
    });

    try {
      const answer = await app.inject({
        method: "PATCH",
        url: `/api/reply-prompts/${saved.id}`,
        payload: { instruction: "No exclamation marks, and ask one question back." },
      });

      expect(answer.statusCode).toBe(200);

      const [after] = await listReplyPrompts(db, unclaimedUserId);
      expect(after?.name).toBe("Plain");
      expect(after?.instruction).toBe("No exclamation marks, and ask one question back.");
    } finally {
      await app.close();
    }
  });

  it("deletes one, and says so when there is nothing to delete", async () => {
    const app = await server();
    const saved = await createReplyPrompt(db, unclaimedUserId, {
      name: "Plain",
      instruction: "One.",
    });

    try {
      expect(
        (await app.inject({ method: "DELETE", url: `/api/reply-prompts/${saved.id}` })).statusCode,
      ).toBe(204);

      expect(await listReplyPrompts(db, unclaimedUserId)).toHaveLength(0);

      expect(
        (await app.inject({ method: "DELETE", url: `/api/reply-prompts/${saved.id}` })).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("refuses a blank name or a blank instruction", async () => {
    // A blank name is unchoosable and a blank instruction is not an
    // instruction. The database refuses both too.
    const app = await server();

    try {
      for (const payload of [
        { name: "", instruction: "Something." },
        { name: "Something", instruction: "" },
      ]) {
        const answer = await app.inject({ method: "POST", url: "/api/reply-prompts", payload });
        expect(answer.statusCode).toBe(400);
      }
    } finally {
      await app.close();
    }
  });
});

describe("drafting without a model", () => {
  let database: TestDatabase;
  let db: Database;
  let close: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    database = await createTestDatabase("api_drafts_nomodel");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  it("says so rather than failing, because a draft is a button not a boot check", async () => {
    // `vitest.config.ts` blanks AI_API_KEY for the whole suite, so this is the
    // state every test machine is in — and the state a self-hoster who has not
    // set a key is in.
    const app = await buildServer({
      session: asOwner,
      env: loadEnv({ DATABASE_URL: database.url }),
      logger,
      db,
      queryGenerator: null,
    });

    try {
      const answer = await app.inject({
        method: "POST",
        url: "/api/matches/8d2b4a1e-3f5c-4c7a-9e11-2b6d0c4f7a31/draft",
        payload: {},
      });

      expect(answer.statusCode).toBe(503);
      expect((answer.json() as { message: string }).message).toContain("No model is configured");
    } finally {
      await app.close();
    }
  });
});

/**
 * BUG-330. A draft's prompt carries the monitor's product, buyer and problem,
 * and the post, so drafting on somebody else's match hands their brief to
 * whoever asked, and the call counts against their cap. Another account gets
 * the answer an unknown id gets.
 *
 * The monitor sits at a zero cap, so the owner's request stops at the budget
 * and no case here reaches a model.
 */
describe("drafting on another account's match", () => {
  let database: TestDatabase;
  let db: Database;
  let close: (() => Promise<void>) | undefined;
  let matchId: string;

  beforeAll(async () => {
    database = await createTestDatabase("api_drafts_scope");
    ({ db, close } = createDatabase(database.url));

    const [monitor] = await db
      .insert(monitors)
      .values({
        userId: "the-owner",
        name: "Theirs",
        product: "A test runner that records browser flows",
        idealCustomer: "Small SaaS teams with no QA engineer",
        problem: "End-to-end tests break when the UI changes",
        signals: ["problem"],
        sources: ["reddit"],
      })
      .returning({ id: monitors.id });
    const [post] = await db
      .insert(posts)
      .values({
        source: "reddit",
        externalId: "scope-1",
        url: "https://reddit.com/r/SaaS/comments/scope-1",
        excerpt: "How are small teams handling regression testing?",
        postedAt: new Date(),
      })
      .returning({ id: posts.id });
    if (!monitor || !post) throw new Error("The rows were not inserted.");

    const [match] = await db
      .insert(matches)
      .values({
        monitorId: monitor.id,
        postId: post.id,
        score: 90,
        relevance: 90,
        problemFit: 90,
        icpFit: 90,
        intent: 90,
        urgency: 50,
        intentType: "problem",
        reasons: ["Asks for a tool"],
      })
      .returning({ id: matches.id });
    if (!match) throw new Error("The match was not inserted.");
    matchId = match.id;

    await db
      .insert(budgets)
      .values({ monitorId: monitor.id, monthlyCapMicros: 0, onExhausted: "notify" });
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  async function draftAs(userId: string) {
    const app = await buildServer({
      session: asUser(userId),
      // A key the route can build a drafter from. Nothing is called with it:
      // the owner stops at the cap and a stranger at the lookup.
      env: loadEnv({
        DATABASE_URL: database.url,
        AI_PROVIDER: "openai",
        AI_API_KEY: "not-a-real-key",
      }),
      logger,
      db,
      queryGenerator: null,
    });

    try {
      return await app.inject({
        method: "POST",
        url: `/api/matches/${matchId}/draft`,
        payload: {},
      });
    } finally {
      await app.close();
    }
  }

  it("reaches the owner's own monitor", async () => {
    expect((await draftAs("the-owner")).statusCode).toBe(402);
  });

  it("is refused to another account as if the match did not exist", async () => {
    const answer = await draftAs("a-stranger");

    expect(answer.statusCode).toBe(404);
    expect(await db.select().from(modelCalls)).toEqual([]);
  });
});
