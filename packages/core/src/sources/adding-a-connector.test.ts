/**
 * The claim in docs/sources.md is that a new connector costs one folder and
 * one line in the registry, and that nothing which consumes a source has to
 * learn about it.
 *
 * This file is that claim, written as code. `exampleSource` below is a whole
 * connector, written from the document and from nothing else. `drain` and
 * `costMicros` are the two things a caller does with any source: page it to
 * the end, and total what it spent. Neither names a source.
 */
import { describe, expect, it } from "vitest";
import { createLogger } from "../logger.js";
import { unreachableFetch } from "../testing/network.js";
import { fakeSourceDefinition } from "./fake/index.js";
import { createSourceRegistry } from "./registry.js";
import type { CandidatePost, SocialSource, SourceDefinition, SourceRuntime } from "./types.js";

const runtime: SourceRuntime = {
  fetch: unreachableFetch,
  now: () => new Date("2026-09-04T12:00:00.000Z"),
  sleep: () => Promise.resolve(),
  logger: createLogger({ level: "silent", name: "example-source-test" }),
};

// --- everything below the line is what a contributor writes -----------------

const examplePosts: readonly CandidatePost[] = [
  {
    externalId: "example-1",
    url: "https://example.test/1",
    text: "Our deploy script is held together with hope.",
    postedAt: new Date("2026-08-10T09:00:00.000Z"),
  },
  {
    externalId: "example-2",
    url: "https://example.test/2",
    text: "Does anyone have a better way to run smoke tests after a release?",
    postedAt: new Date("2026-08-11T09:00:00.000Z"),
  },
];

const exampleSourceDefinition: SourceDefinition = {
  id: "example",
  displayName: "Example",
  billableUnit: "post read",
  pricePerUnitMicros: 5000,
  credentialFields: [{ name: "apiKey", label: "API key", secret: true }],

  create(_runtime): SocialSource {
    return {
      ...exampleSourceDefinition,

      validateCredentials: (credentials) =>
        Promise.resolve(
          credentials.apiKey ? { valid: true } : { valid: false, reason: "Missing API key." },
        ),

      search: (request) => {
        const offset = request.cursor ? Number(request.cursor) : 0;
        const page = examplePosts.slice(offset, offset + 1);
        const nextOffset = offset + page.length;

        return Promise.resolve({
          posts: page,
          unitsConsumed: page.length,
          next:
            nextOffset < examplePosts.length
              ? { status: "ready" as const, cursor: String(nextOffset) }
              : { status: "done" as const },
        });
      },
    };
  },
};

// --- everything below is generic: it never names a source ------------------

interface Drained {
  readonly posts: readonly CandidatePost[];
  readonly unitsConsumed: number;
}

/** Page a source to the end. This is what US-007's collector will do. */
async function drain(source: SocialSource, credentials: Record<string, string>): Promise<Drained> {
  const posts: CandidatePost[] = [];
  let unitsConsumed = 0;
  let cursor: string | undefined;

  for (let page = 0; page < 20; page += 1) {
    const result = await source.search({
      query: { queries: ["deploy"], channels: [] },
      credentials,
      cursor,
      limit: 100,
    });

    posts.push(...result.posts);
    unitsConsumed += result.unitsConsumed;

    if (result.next.status === "done") return { posts, unitsConsumed };
    if (result.next.status === "wait") throw new Error("this test does not exercise waiting");
    cursor = result.next.cursor;
  }

  throw new Error("a source never finished paging");
}

/** What a page cost, from the descriptor alone. This is US-013's arithmetic. */
function costMicros(source: SocialSource, unitsConsumed: number): number {
  return source.pricePerUnitMicros * unitsConsumed;
}

describe("adding a connector touches the registry and one new folder", () => {
  const registry = createSourceRegistry({
    definitions: [fakeSourceDefinition({ pageSize: 2 }), exampleSourceDefinition],
    runtime,
  });

  it("registers beside the others with one line", () => {
    expect(registry.ids()).toEqual(["fake", "example"]);
  });

  it("is paged by caller code that does not know it exists", async () => {
    const drained = await drain(registry.get("example"), { apiKey: "key" });

    expect(drained.posts.map((post) => post.externalId)).toEqual(["example-1", "example-2"]);
  });

  it("prices itself, so the budget guard needs no case for it", async () => {
    const example = await drain(registry.get("example"), { apiKey: "key" });
    const fake = await drain(registry.get("fake"), { token: "token" });

    // Two post reads at $0.005. The number comes from the connector's own
    // descriptor, not from a table of prices in the worker.
    expect(costMicros(registry.get("example"), example.unitsConsumed)).toBe(10_000);
    // The fake bills a free call per page and returned five posts over three
    // pages, so the same generic arithmetic gives nothing.
    expect(fake.unitsConsumed).toBe(3);
    expect(costMicros(registry.get("fake"), fake.unitsConsumed)).toBe(0);
  });

  it("describes its own credentials, so the settings form needs no case for it", () => {
    expect(registry.get("example").credentialFields).toEqual([
      { name: "apiKey", label: "API key", secret: true },
    ]);
    expect(registry.get("fake").credentialFields).toEqual([
      { name: "token", label: "Token", secret: true },
    ]);
  });
});
