import { describe, expect, it } from "vitest";
import { createLogger } from "../../logger.js";
import { unreachableFetch } from "../../testing/network.js";
import type { SearchRequest, SourceRuntime } from "../types.js";
import { fakePosts } from "./fixtures.js";
import { createFakeSource } from "./index.js";

const silent = createLogger({ level: "silent", name: "fake-source-test" });

/**
 * A clock a test moves by hand. A wait in milliseconds is a race; moving the
 * clock is an ordering. docs/testing.md, *Two diagnostics*.
 */
function testRuntime(startedAt = new Date("2026-09-04T12:00:00.000Z")) {
  let clock = startedAt;
  const slept: number[] = [];

  const runtime: SourceRuntime = {
    fetch: unreachableFetch,
    now: () => clock,
    sleep: (milliseconds) => {
      slept.push(milliseconds);
      clock = new Date(clock.getTime() + milliseconds);
      return Promise.resolve();
    },
    logger: silent,
  };

  return {
    runtime,
    slept,
    advance: (milliseconds: number) => {
      clock = new Date(clock.getTime() + milliseconds);
    },
  };
}

const credentials = { token: "any-token" };

function request(overrides: Partial<SearchRequest> = {}): SearchRequest {
  return {
    query: { queries: ["playwright"], channels: [] },
    credentials,
    ...overrides,
  };
}

describe("the fake source returns posts and no network call", () => {
  it("returns every fixture post and says the query is finished", async () => {
    const { runtime } = testRuntime();
    const source = createFakeSource(runtime);

    const result = await source.search(request());

    expect(result.posts.map((post) => post.externalId)).toEqual([
      "fake-1",
      "fake-2",
      "fake-3",
      "fake-4",
      "fake-5",
    ]);
    expect(result.next).toEqual({ status: "done" });
  });

  it("cannot reach the network even if a connector tried", async () => {
    const { runtime } = testRuntime();

    await expect(runtime.fetch("https://oauth.reddit.com/search")).rejects.toThrow(
      /No test reaches Reddit/,
    );
  });

  it("drops posts older than `since`", async () => {
    const { runtime } = testRuntime();
    const source = createFakeSource(runtime);

    const result = await source.search(
      request({
        query: { queries: [], channels: [], since: new Date("2026-08-03T09:00:00.000Z") },
      }),
    );

    // Strictly newer: the post posted at exactly `since` was already seen.
    expect(result.posts.map((post) => post.externalId)).toEqual(["fake-4", "fake-5"]);
  });
});

describe("the fake source hands back a partial page", () => {
  it("returns fewer posts than asked for and still says there is more", async () => {
    const { runtime } = testRuntime();
    const source = createFakeSource(runtime, { pageSize: 2 });

    const result = await source.search(request({ limit: 10 }));

    // A caller that stops when it gets fewer posts than it asked for loses
    // everything after this page. The cursor is the only correct signal.
    expect(result.posts).toHaveLength(2);
    expect(result.next).toEqual({ status: "ready", cursor: "2" });
  });

  it("pages to the end without repeating or dropping a post", async () => {
    const { runtime } = testRuntime();
    const source = createFakeSource(runtime, { pageSize: 2 });

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;

    for (;;) {
      const result = await source.search(request({ cursor }));
      seen.push(...result.posts.map((post) => post.externalId));
      pages += 1;

      if (result.next.status === "done") break;
      if (result.next.status === "wait") throw new Error("unexpected wait");
      cursor = result.next.cursor;
      if (pages > 10) throw new Error("the cursor never reached the end");
    }

    expect(pages).toBe(3);
    expect(seen).toEqual(["fake-1", "fake-2", "fake-3", "fake-4", "fake-5"]);
  });

  it("refuses a cursor it did not issue", async () => {
    const { runtime } = testRuntime();
    const source = createFakeSource(runtime, { pageSize: 2 });

    await expect(source.search(request({ cursor: "page-2" }))).rejects.toThrow(
      /was not issued by this source/,
    );
    await expect(source.search(request({ cursor: "99" }))).rejects.toThrow(
      /was not issued by this source/,
    );
  });
});

describe("the fake source reports what it spent", () => {
  it("bills one call for a page of five posts, the way Reddit does", async () => {
    const { runtime } = testRuntime();
    const source = createFakeSource(runtime, { unitsPerCall: 1, unitsPerPost: 0 });

    const result = await source.search(request());

    expect(result.posts).toHaveLength(5);
    expect(result.unitsConsumed).toBe(1);
  });

  it("bills five reads for the same five posts, the way X does", async () => {
    const { runtime } = testRuntime();
    const source = createFakeSource(runtime, {
      unitsPerCall: 0,
      unitsPerPost: 1,
      billableUnit: "post read",
      pricePerUnitMicros: 5000,
    });

    const result = await source.search(request());

    // The same page, the same post count, a different charge. This is why the
    // caller cannot work the cost out from `posts.length`.
    expect(result.posts).toHaveLength(5);
    expect(result.unitsConsumed).toBe(5);
    expect(result.unitsConsumed * source.pricePerUnitMicros).toBe(25_000);
  });
});

describe("the fake source runs out of allowance", () => {
  it("reports a wait, spends nothing, and serves again once the window passes", async () => {
    const clock = testRuntime();
    const source = createFakeSource(clock.runtime, {
      callsBeforeRateLimit: 1,
      rateLimitWindowMs: 60_000,
      pageSize: 2,
    });

    const first = await source.search(request());
    expect(first.posts).toHaveLength(2);
    expect(first.next).toEqual({ status: "ready", cursor: "2" });

    const limited = await source.search(request({ cursor: "2" }));
    expect(limited.posts).toEqual([]);
    expect(limited.unitsConsumed).toBe(0);
    expect(limited.next).toEqual({
      status: "wait",
      retryAfter: new Date("2026-09-04T12:01:00.000Z"),
      cursor: "2",
    });

    clock.advance(60_000);

    const resumed = await source.search(request({ cursor: "2" }));
    expect(resumed.posts.map((post) => post.externalId)).toEqual(["fake-3", "fake-4"]);
  });

  it("backs off inside the connector when it is built to, and the caller never sees a wait", async () => {
    const clock = testRuntime();
    const source = createFakeSource(clock.runtime, {
      callsBeforeRateLimit: 1,
      rateLimitWindowMs: 60_000,
      backOff: "sleep",
      pageSize: 2,
    });

    await source.search(request());
    const second = await source.search(request({ cursor: "2" }));

    // The caller reads a normal page. It never learns that this source has an
    // allowance, and it never reads a rate limit header.
    expect(second.posts.map((post) => post.externalId)).toEqual(["fake-3", "fake-4"]);
    expect(second.next).toEqual({ status: "ready", cursor: "4" });
    expect(clock.slept).toEqual([60_000]);
  });
});

describe("the fake source validates credentials", () => {
  it("accepts a token and rejects a missing one with a reason", async () => {
    const { runtime } = testRuntime();
    const source = createFakeSource(runtime);

    expect(await source.validateCredentials({ token: "abc" })).toEqual({ valid: true });
    expect(await source.validateCredentials({})).toEqual({
      valid: false,
      reason: "Missing Token.",
    });
  });

  it("rejects a token it was not told to accept", async () => {
    const { runtime } = testRuntime();
    const source = createFakeSource(runtime, { validCredentials: { token: "right" } });

    expect(await source.validateCredentials({ token: "wrong" })).toEqual({
      valid: false,
      reason: "Token is not accepted.",
    });
  });

  it("refuses to search with credentials it would have rejected", async () => {
    const { runtime } = testRuntime();
    const source = createFakeSource(runtime);

    await expect(source.search(request({ credentials: {} }))).rejects.toThrow(/Missing Token/);
  });
});

describe("the fake source records what it was asked", () => {
  it("keeps every search in order", async () => {
    const { runtime } = testRuntime();
    const source = createFakeSource(runtime, { pageSize: 2 });

    await source.search(request());
    await source.search(request({ cursor: "2" }));

    expect(source.calls.map((call) => call.cursor)).toEqual([undefined, "2"]);
  });

  it("stops before doing anything when the caller has already given up", async () => {
    const { runtime } = testRuntime();
    const source = createFakeSource(runtime);
    const controller = new AbortController();
    controller.abort();

    await expect(source.search(request({ signal: controller.signal }))).rejects.toThrow();
  });
});

describe("the fixtures", () => {
  it("carry PLAN.md's four worked examples, so the labelled set and the pipeline agree", () => {
    const texts = fakePosts.map((post) => post.text);

    expect(texts).toContain("Playwright is awesome.");
    expect(texts).toContain("Our Playwright tests break whenever the UI changes.");
    expect(texts).toContain(
      "Our Playwright suite is becoming impossible to maintain. Is there something easier?",
    );
  });

  it("gives every post a distinct external id", () => {
    const ids = fakePosts.map((post) => post.externalId);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
