/**
 * US-476: the partial posts the filter kept are read whole before the
 * classifier, through the real forum connector over captured pages.
 */
import { readFileSync } from "node:fs";
import {
  type CompleteRequest,
  type ConnectorDefinition,
  createBrightDataForum,
  createLogger,
  createSourceRegistry,
  createSourceRuntime,
  type SocialSource,
} from "@signalscout/engine";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import {
  apiUsage,
  budgets,
  filterDrops,
  matches,
  monitors,
  pollRuns,
  posts,
} from "../db/schema.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { createCompleteStep } from "./complete.js";
import type { MatchCaps } from "./match-cap.js";
import type { ClassifyPayload } from "./queues.js";
import { classifyQueue } from "./queues.js";
import type { StepContext } from "./steps.js";
import { insertMonitor } from "./testing.js";

const fixtures = new URL("../../../engine/src/sources/forums/fixtures/", import.meta.url);
const threadPage = readFileSync(new URL("xenforo2-thread.html", fixtures), "utf8");
const thread = "https://forums.macrumors.com/threads/m6-imac.2493064/";
const walkId = "11111111-1111-4111-8111-111111111111";
const refused = "Residential Failed (bad_endpoint): Requested site is not available";
const logger = createLogger({ level: "silent", name: "complete-test" });

let database: TestDatabase;
let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  database = await createTestDatabase("worker_complete");
  ({ db, close } = createDatabase(database.url));
}, 60_000);

afterAll(async () => {
  await close?.();
  await database?.drop();
});

/** A step over a Bright Data that answers `page` for every address, and what it sent on. */
function harness(page: string, definition?: ConnectorDefinition, caps: MatchCaps = {}) {
  const asked: string[] = [];
  const fetch: typeof globalThis.fetch = async (_endpoint, init) => {
    asked.push((JSON.parse(String(init?.body)) as { url: string }).url);
    return new Response(page, { status: 200 });
  };
  const registry = createSourceRegistry({
    definitions: [definition ?? createBrightDataForum()],
    runtime: createSourceRuntime({ fetch, logger }),
  });
  const step = createCompleteStep({
    registry,
    credentialsFor: () => ({ apiKey: "bd-key", unlockerZone: "web_unlocker1" }),
    ...caps,
  });
  const sent: { queue: string; payload: ClassifyPayload }[] = [];
  const boss = {
    send: async (queue: string, payload: ClassifyPayload) => {
      sent.push({ queue, payload });
      return null;
    },
  } as unknown as StepContext["boss"];
  const run = (monitorId: string, postIds: string[]) =>
    step({ monitorId, postIds, walkId }, { db, boss, logger } as StepContext);
  return { asked, sent, run };
}

/** A forum connector that records each completion call, whole. */
function recordingConnector(calls: CompleteRequest[]): ConnectorDefinition {
  const platform = { id: "forum", displayName: "Forum" };
  const provider = {
    id: "brightdata",
    displayName: "Bright Data",
    credentialFields: [{ name: "apiKey", label: "API key", secret: true }],
  };
  const descriptor = {
    platform,
    provider,
    billableUnit: "page",
    pricePerUnitMicros: 1_500,
    maxUnitsPerQueryPoll: 20,
  };
  return {
    ...descriptor,
    create: (): SocialSource => ({
      ...descriptor,
      validateCredentials: async () => ({ valid: true }),
      search: async () => {
        throw new Error("the complete step does not search");
      },
      completePosts: async function* (request) {
        calls.push(request);
        for (const post of request.posts) {
          yield {
            status: "complete" as const,
            post: {
              externalId: post.url,
              url: post.url,
              text: "the whole post",
              postedAt: new Date("2026-10-28T18:05:14.000Z"),
            },
            unitsConsumed: 1,
          };
        }
      },
    }),
  };
}

async function forumMonitor(): Promise<string> {
  return insertMonitor(database, {
    sources: ["forum"],
    generatedQueries: { forum: ["https://f.example/feed"] },
  });
}

async function startWalk(monitorId: string, matchPostId?: string): Promise<void> {
  await db.insert(pollRuns).values({
    monitorId,
    userId: "user-1",
    walkId,
    outcome: "collected",
    startedAt: new Date(Date.now() - 60_000),
  });
  if (!matchPostId) return;
  await db.insert(matches).values({
    monitorId,
    postId: matchPostId,
    score: 80,
    relevance: 80,
    problemFit: 80,
    icpFit: 80,
    intent: 80,
    urgency: 50,
    intentType: "problem",
    reasons: ["A person describing the problem."],
  });
}

async function insertPost(
  externalId: string,
  partial: { since?: Date } | null,
  url = thread,
): Promise<string> {
  const [row] = await db
    .insert(posts)
    .values({
      source: "forum",
      externalId,
      url,
      channel: "forums.macrumors.com",
      title: "M6 iMac",
      excerpt: "I ordered my M6 iMac this morning and...",
      postedAt: new Date("2026-10-31T03:00:00.000Z"),
      textPartial: partial !== null,
      partialSince: partial?.since ?? null,
    })
    .returning({ id: posts.id });
  if (!row) throw new Error("The post was not inserted.");
  return row.id;
}

describe("completing the partial posts the filter kept", () => {
  it("reads a partial post whole, bills the page, and sends the whole batch on", async () => {
    const monitorId = await forumMonitor();
    const partialId = await insertPost("forums.macrumors.com:2493064", {});
    const wholeId = await insertPost(
      "forums.macrumors.com:1",
      null,
      "https://forums.macrumors.com/threads/x.1/",
    );
    const { asked, sent, run } = harness(threadPage);

    await run(monitorId, [partialId, wholeId]);

    expect(asked).toEqual([thread]);
    const [post] = await db.select().from(posts).where(eq(posts.id, partialId));
    expect(post).toMatchObject({
      textPartial: false,
      partialSince: null,
      postedAt: new Date("2026-10-28T18:05:14.000Z"),
    });
    expect(post?.excerpt.length).toBeGreaterThan(40);
    expect(sent).toEqual([
      {
        queue: classifyQueue,
        payload: { monitorId, postIds: [partialId, wholeId], walkId },
      },
    ]);
    const usage = await db.select().from(apiUsage).where(eq(apiUsage.monitorId, monitorId));
    expect(usage).toMatchObject([{ source: "forum", provider: "brightdata", units: 1 }]);
  });

  it("drops a thread its page shows started before the poll's window", async () => {
    const monitorId = await forumMonitor();
    const oldId = await insertPost("forums.macrumors.com:2493064-old", {
      since: new Date("2026-10-29T00:00:00.000Z"),
    });
    const { sent, run } = harness(threadPage);

    await run(monitorId, [oldId]);

    expect(sent[0]?.payload.postIds).toEqual([]);
    const drops = await db
      .select()
      .from(filterDrops)
      .where(and(eq(filterDrops.monitorId, monitorId), eq(filterDrops.postId, oldId)));
    expect(drops.map((drop) => drop.stage)).toEqual(["old_thread"]);
  });

  it("sends a post on as it is when no page comes back", async () => {
    const monitorId = await forumMonitor();
    const id = await insertPost("forums.macrumors.com:2493064-refused", {});
    const { sent, run } = harness(refused);

    await run(monitorId, [id]);

    const [post] = await db.select().from(posts).where(eq(posts.id, id));
    expect(post?.textPartial).toBe(true);
    expect(sent[0]?.payload.postIds).toEqual([id]);
  });

  it("reads no page when the walk already has its matches, and sends the batch on", async () => {
    const monitorId = await forumMonitor();
    const id = await insertPost("forums.macrumors.com:2493064-match-cap", {});
    await startWalk(monitorId, id);
    const calls: CompleteRequest[] = [];
    const { asked, sent, run } = harness(threadPage, recordingConnector(calls), {
      firstMatchesPerCollection: 1,
      matchesPerCollection: 1,
    });

    await run(monitorId, [id]);

    expect(calls).toEqual([]);
    expect(asked).toEqual([]);
    expect(sent[0]?.payload.postIds).toEqual([id]);
    const [post] = await db.select().from(posts).where(eq(posts.id, id));
    expect(post?.textPartial).toBe(true);
  });

  it("reads the page of a monitor with no match cap, though the walk has its matches", async () => {
    const monitorId = await forumMonitor();
    const id = await insertPost("forums.macrumors.com:2493064-no-cap", {});
    await startWalk(monitorId, id);
    const calls: CompleteRequest[] = [];
    const { run } = harness(threadPage, recordingConnector(calls), {
      firstMatchesPerCollection: 1,
      matchesPerCollection: 1,
      noMatchCap: async (asked) => asked === monitorId,
    });

    await run(monitorId, [id]);

    expect(calls).toHaveLength(1);
  });

  it("reads a partial post as before when the walk has no matches yet", async () => {
    const monitorId = await forumMonitor();
    const id = await insertPost("forums.macrumors.com:2493064-under-cap", {});
    await startWalk(monitorId);
    const calls: CompleteRequest[] = [];
    const { sent, run } = harness(threadPage, recordingConnector(calls), {
      firstMatchesPerCollection: 1,
      matchesPerCollection: 1,
    });

    await run(monitorId, [id]);

    expect(calls).toHaveLength(1);
    // The monitor rides on the request, for a connector that tells its costs. US-503.
    expect(calls[0]?.monitorId).toBe(monitorId);
    expect(sent[0]?.payload.postIds).toEqual([id]);
  });

  it("asks for nothing at the budget cap, and still sends the batch on", async () => {
    const monitorId = await forumMonitor();
    const id = await insertPost("forums.macrumors.com:2493064-capped", {});
    const [monitor] = await db.select().from(monitors).where(eq(monitors.id, monitorId));
    await db.insert(budgets).values({ monitorId, monthlyCapMicros: 1_000, onExhausted: "pause" });
    await db.insert(apiUsage).values({
      userId: monitor?.userId ?? "user-1",
      monitorId,
      source: "forum",
      provider: "brightdata",
      day: new Date().toISOString().slice(0, 10),
      units: 1,
      estimatedCostMicros: 5_000,
    });
    const { asked, sent, run } = harness(threadPage);

    await run(monitorId, [id]);

    expect(asked).toEqual([]);
    expect(sent[0]?.payload.postIds).toEqual([id]);
  });

  it("asks for nothing when no post in the batch is partial", async () => {
    const monitorId = await forumMonitor();
    const id = await insertPost("forums.macrumors.com:2493064-whole", null);
    const { asked, sent, run } = harness(threadPage);

    await run(monitorId, [id]);

    expect(asked).toEqual([]);
    expect(sent[0]?.payload.postIds).toEqual([id]);
  });

  it("reads two partial posts of one source in one call", async () => {
    const monitorId = await forumMonitor();
    const first = await insertPost("forums.macrumors.com:2493064-a", {});
    const second = await insertPost("forums.macrumors.com:2493064-b", {});
    const calls: CompleteRequest[] = [];
    const { sent, run } = harness(threadPage, recordingConnector(calls));

    await run(monitorId, [first, second]);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.posts.map((post) => post.url)).toEqual([thread, thread]);
    expect(sent[0]?.payload.postIds).toEqual([first, second]);
  });
});
