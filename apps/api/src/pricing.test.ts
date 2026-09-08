/**
 * The pricing route: the arithmetic that makes four billable units comparable.
 *
 * The screen half is asserted in `apps/web/src/Pricing.test.tsx`. What this
 * file owns is whether the numbers are right, and whether the three kinds of
 * number stay apart — a declared price, our estimate over it, and money the
 * deployment has already spent.
 */
import type { ConnectorDefinition, Database } from "@signalscout/core";
import {
  apiUsage,
  createDatabase,
  createLogger,
  fakeSourceDefinition,
  feedback,
  loadEnv,
  matches,
  monitors,
  posts,
  sourceProviders,
} from "@signalscout/core";
import { createTestDatabase, type TestDatabase } from "@signalscout/core/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { comparedPosts, formatMicros } from "./pricing.js";
import { buildServer } from "./server.js";
import { asOwner, asUser, testOwner as pageOwner } from "./testing.js";

/**
 * Two providers for one platform, priced in different units.
 *
 * This is the case the page exists for, and the numbers are the real ones:
 * SocialCrawl bills a credit and gets two LinkedIn posts for it; Apify bills
 * the post itself. $8.12 per thousand credits against $2.00 per thousand posts
 * is not a comparison anybody can do in their head.
 */
function socialCrawlLinkedIn(): ConnectorDefinition {
  return fakeSourceDefinition({
    id: "linkedin",
    displayName: "LinkedIn",
    providerId: "socialcrawl",
    providerName: "SocialCrawl",
    credentialFields: [{ name: "apiKey", label: "SocialCrawl API key", secret: true }],
    pricePerUnitMicros: 8118,
    billableUnit: "credit",
    postsPerUnit: 2,
    maxUnitsPerQueryPoll: 2,
    discovery: ["keyword"],
  });
}

function apifyLinkedIn(): ConnectorDefinition {
  return fakeSourceDefinition({
    id: "linkedin",
    displayName: "LinkedIn",
    providerId: "apify",
    providerName: "Apify",
    credentialFields: [{ name: "apiToken", label: "Apify API token", secret: true }],
    pricePerUnitMicros: 2000,
    billableUnit: "post",
    postsPerUnit: 1,
    maxUnitsPerQueryPoll: 25,
  });
}

/** A connector nobody has measured a yield for. */
function unmeasured(): ConnectorDefinition {
  return fakeSourceDefinition({
    id: "x",
    displayName: "X",
    providerId: "socialcrawl",
    providerName: "SocialCrawl",
    credentialFields: [{ name: "apiKey", label: "SocialCrawl API key", secret: true }],
    pricePerUnitMicros: 8118,
    billableUnit: "credit",
    maxUnitsPerQueryPoll: 2,
  });
}

interface PricingBody {
  comparedPosts: number;
  thinSample: number;
  verdicts: number;
  platforms: {
    id: string;
    comparable: boolean;
    connectors: {
      providerId: string;
      billableUnit: string;
      pricePerUnit: { micros: number; display: string };
      postsPerUnit: number | null;
      estimatedPerComparedPosts: { micros: number; display: string } | null;
      ceilingPerQueryPoll: { micros: number };
      connected: boolean;
      inUse: boolean;
      spent: { units: number; cost: { micros: number } };
      can: { keyword: boolean; channel: boolean; replies: boolean; commentLinks: boolean | null };
      returned: {
        posts: number;
        matches: number;
        matchRate: number | null;
        medianAgeHours: number | null;
        costPerMatch: { micros: number } | null;
        thin: boolean;
      };
    }[];
  }[];
}

const logger = createLogger({ level: "silent", name: "test" });

describe("the pricing route", () => {
  let database: TestDatabase;
  let db: Database;
  let close: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    database = await createTestDatabase("api_pricing");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(apiUsage);
    await db.delete(sourceProviders);
  });

  async function read(
    sources: ConnectorDefinition[],
    environment: Record<string, string | undefined> = {},
  ): Promise<PricingBody> {
    const app = await buildServer({
      session: asOwner,
      env: loadEnv({ DATABASE_URL: database.url }),
      logger,
      db,
      sources,
      environment,
      queryGenerator: null,
    });

    try {
      const response = await app.inject({ method: "GET", url: "/api/pricing" });
      expect(response.statusCode).toBe(200);
      return response.json() as PricingBody;
    } finally {
      await app.close();
    }
  }

  it("prices every connector for the same number of posts", async () => {
    // The whole feature. 50 posts at 2 per credit is 25 credits, which is
    // 202,950 micro-dollars; 50 posts at 1 per post is 100,000. Those two are
    // comparable where 8,118 and 2,000 are not.
    const body = await read([socialCrawlLinkedIn(), apifyLinkedIn()]);
    const [linkedin] = body.platforms;

    expect(body.comparedPosts).toBe(comparedPosts);
    expect(linkedin?.connectors.map((one) => one.estimatedPerComparedPosts?.micros)).toEqual([
      202_950, 100_000,
    ]);
  });

  it("rounds the estimate up, never down", async () => {
    // A provider quoted cheaper than it is would be chosen for a reason that
    // is not true. Seven posts a request over fifty posts is 7.14 requests,
    // and the eighth is bought whole.
    const body = await read([
      fakeSourceDefinition({
        id: "reddit",
        displayName: "Reddit",
        providerId: "scrapecreators",
        providerName: "ScrapeCreators",
        credentialFields: [{ name: "apiKey", label: "key", secret: true }],
        pricePerUnitMicros: 1880,
        billableUnit: "request",
        postsPerUnit: 7,
        maxUnitsPerQueryPoll: 2,
      }),
    ]);

    const estimate = body.platforms[0]?.connectors[0]?.estimatedPerComparedPosts?.micros;

    expect(estimate).toBe(Math.ceil((50 / 7) * 1880));
    expect(estimate).toBeGreaterThan((50 / 7) * 1880);
  });

  it("says nothing rather than guessing when no yield was measured", async () => {
    // Inventing a yield is the one dishonest thing this page could do: the
    // whole comparison rests on it, and a made-up number would look exactly
    // like a measured one.
    const body = await read([unmeasured()]);
    const connector = body.platforms[0]?.connectors[0];

    expect(connector?.postsPerUnit).toBeNull();
    expect(connector?.estimatedPerComparedPosts).toBeNull();
  });

  it("formats every figure to four decimal places", async () => {
    // docs/costs.md: ten Reddit records cost $0.0150, and a page rounding that
    // to two cents could not be reconciled against a provider's dashboard.
    const body = await read([apifyLinkedIn()]);

    expect(body.platforms[0]?.connectors[0]?.pricePerUnit.display).toBe("$0.0020");
    expect(formatMicros(15_000)).toBe("$0.0150");
  });

  it("marks a platform with two providers as comparable, and one without as not", async () => {
    const both = await read([socialCrawlLinkedIn(), apifyLinkedIn()]);
    expect(both.platforms[0]?.comparable).toBe(true);

    const alone = await read([apifyLinkedIn()]);
    expect(alone.platforms[0]?.comparable).toBe(false);
  });

  it("counts the ceiling one query can cost in one poll", async () => {
    // What the budget guard would allow for a single query, which is the other
    // figure a person choosing a provider needs: 25 posts at 2,000 each.
    const body = await read([apifyLinkedIn()]);

    expect(body.platforms[0]?.connectors[0]?.ceilingPerQueryPoll.micros).toBe(50_000);
  });
});

describe("what the deployment has really spent", () => {
  let database: TestDatabase;
  let db: Database;
  let close: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    database = await createTestDatabase("api_pricing_spend");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(apiUsage);
  });

  it("adds up `api_usage` per pair, across every day and monitor", async () => {
    // Money already gone, and the only figure on the page that is not a
    // projection. All time rather than this month: a provider somebody
    // switched away from last month must not show as free.
    await db.insert(apiUsage).values([
      {
        userId: pageOwner,
        source: "linkedin",
        provider: "apify",
        day: "2026-09-06",
        units: 10,
        estimatedCostMicros: 20_000,
      },
      {
        userId: pageOwner,
        source: "linkedin",
        provider: "apify",
        day: "2026-09-07",
        units: 26,
        estimatedCostMicros: 52_000,
      },
      {
        userId: pageOwner,
        source: "linkedin",
        provider: "socialcrawl",
        day: "2026-09-05",
        units: 10,
        estimatedCostMicros: 81_180,
      },
    ]);

    const app = await buildServer({
      session: asOwner,
      env: loadEnv({ DATABASE_URL: database.url }),
      logger,
      db,
      sources: [socialCrawlLinkedIn(), apifyLinkedIn()],
      environment: {},
      queryGenerator: null,
    });

    try {
      const body = (await app.inject({ method: "GET", url: "/api/pricing" })).json() as PricingBody;
      const spent = Object.fromEntries(
        (body.platforms[0]?.connectors ?? []).map((one) => [one.providerId, one.spent]),
      );

      expect(spent.apify).toEqual({ units: 36, cost: { micros: 72_000, display: "$0.0720" } });
      expect(spent.socialcrawl?.cost.micros).toBe(81_180);
    } finally {
      await app.close();
    }
  });

  it("reports nothing spent as zero rather than leaving it out", async () => {
    const app = await buildServer({
      session: asOwner,
      env: loadEnv({ DATABASE_URL: database.url }),
      logger,
      db,
      sources: [apifyLinkedIn()],
      environment: {},
      queryGenerator: null,
    });

    try {
      const body = (await app.inject({ method: "GET", url: "/api/pricing" })).json() as PricingBody;

      expect(body.platforms[0]?.connectors[0]?.spent).toEqual({
        units: 0,
        cost: { micros: 0, display: "$0.0000" },
      });
    } finally {
      await app.close();
    }
  });
});

describe("what each pair returned", () => {
  let database: TestDatabase;
  let db: Database;
  let close: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    database = await createTestDatabase("api_pricing_returns");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  it("reports no rate for a pair that has collected nothing", async () => {
    // 0 of 0 is not zero per cent. A rate here would read as a measurement of
    // a provider nobody has used.
    const app = await buildServer({
      session: asOwner,
      env: loadEnv({ DATABASE_URL: database.url }),
      logger,
      db,
      sources: [apifyLinkedIn()],
      environment: {},
      queryGenerator: null,
    });

    try {
      const body = (await app.inject({ method: "GET", url: "/api/pricing" })).json() as PricingBody;
      const returned = body.platforms[0]?.connectors[0]?.returned;

      expect(returned).toEqual({
        posts: 0,
        matches: 0,
        matchRate: null,
        medianAgeHours: null,
        costPerMatch: null,
        thin: false,
      });
    } finally {
      await app.close();
    }
  });

  it("reports what a connector can find, from its own declaration", async () => {
    const app = await buildServer({
      session: asOwner,
      env: loadEnv({ DATABASE_URL: database.url }),
      logger,
      db,
      sources: [socialCrawlLinkedIn()],
      environment: {},
      queryGenerator: null,
    });

    try {
      const body = (await app.inject({ method: "GET", url: "/api/pricing" })).json() as PricingBody;

      expect(body.platforms[0]?.connectors[0]?.can).toEqual({
        keyword: true,
        channel: false,
        replies: false,
        // Absent on the connector means nobody checked, and null is how the
        // page is told to say "unproven" rather than "no".
        commentLinks: null,
      });
    } finally {
      await app.close();
    }
  });

  it("counts the verdicts, so the page can say how far to trust a match", async () => {
    const app = await buildServer({
      session: asOwner,
      env: loadEnv({ DATABASE_URL: database.url }),
      logger,
      db,
      sources: [apifyLinkedIn()],
      environment: {},
      queryGenerator: null,
    });

    try {
      const body = (await app.inject({ method: "GET", url: "/api/pricing" })).json() as PricingBody;

      expect(body.verdicts).toBe(0);
      expect(body.thinSample).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
});

/**
 * What a brand-new account sees on this page. BUG-009.
 *
 * Reported from a running instance: a person who had just registered and
 * created nothing was shown match and spend figures. They were somebody else's.
 *
 * US-067 scoped the *keys* on this route and left three reads unscoped beside
 * them — the spend, the posts-and-matches, and the verdict count. That is the
 * shape of this whole class of bug: the route was edited, the obvious half was
 * fixed, and the numbers underneath kept answering for the instance.
 */
describe("what one account sees of another's numbers", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  const owner = "account-1";
  const newcomer = "account-2";

  beforeAll(async () => {
    database = await createTestDatabase("pricing_scope");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  /** One monitor, one post it matched, one verdict on it, and the bill. */
  async function seedFor(userId: string) {
    const [monitor] = await db
      .insert(monitors)
      .values({
        userId,
        name: `${userId}'s monitor`,
        product: "A test runner",
        idealCustomer: "QA leads",
        problem: "Flaky tests",
        sources: ["linkedin"],
      })
      .returning({ id: monitors.id });

    const [post] = await db
      .insert(posts)
      .values({
        source: "linkedin",
        provider: "socialcrawl",
        externalId: `urn:${userId}`,
        url: `https://linkedin.com/feed/update/${userId}`,
        excerpt: "Our end-to-end suite fails at random.",
        postedAt: new Date(),
      })
      .returning({ id: posts.id });

    const [match] = await db
      .insert(matches)
      .values({
        monitorId: monitor?.id ?? "",
        postId: post?.id ?? "",
        score: 71,
        relevance: 90,
        problemFit: 98,
        icpFit: 91,
        intent: 94,
        urgency: 70,
        intentType: "problem",
        reasons: ["A QA lead with no automation"],
      })
      .returning({ id: matches.id });

    await db.insert(feedback).values({
      matchId: match?.id ?? "",
      monitorId: monitor?.id ?? "",
      monitorVersion: 1,
      userId,
      verdict: "good",
    });

    await db.insert(apiUsage).values({
      userId,
      monitorId: monitor?.id ?? "",
      source: "linkedin",
      provider: "socialcrawl",
      day: "2026-09-08",
      units: 10,
      estimatedCostMicros: 81_180,
    });
  }

  async function pricingAs(userId: string) {
    const app = await buildServer({
      session: asUser(userId),
      env: loadEnv({ DATABASE_URL: database.url }),
      logger,
      db,
      sources: [socialCrawlLinkedIn()],
      environment: {},
      queryGenerator: null,
    });

    try {
      return (await app.inject({ method: "GET", url: "/api/pricing" })).json();
    } finally {
      await app.close();
    }
  }

  it("shows an account that has created nothing that it has nothing", async () => {
    await seedFor(owner);

    const mine = await pricingAs(owner);
    const theirs = await pricingAs(newcomer);

    const minePair = mine.platforms[0].connectors[0];
    const theirsPair = theirs.platforms[0].connectors[0];

    // The owner sees their own run.
    expect(minePair.returned.posts).toBe(1);
    expect(minePair.returned.matches).toBe(1);
    expect(minePair.spent.units).toBe(10);
    expect(mine.verdicts).toBe(1);

    // The newcomer sees none of it. Every one of these was the owner's number
    // before BUG-009 was fixed.
    expect(theirsPair.returned.posts).toBe(0);
    expect(theirsPair.returned.matches).toBe(0);
    expect(theirsPair.spent.units).toBe(0);
    expect(theirs.verdicts).toBe(0);
  });
});
