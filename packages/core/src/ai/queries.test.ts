/**
 * The query generator, driven with a stubbed model.
 *
 * No test here reaches a provider. The stub returns the JSON shape a real
 * model would return, which is our own shape rather than someone else's wire
 * format, so writing it is honest. What it cannot say is whether a real model
 * writes good queries: that answer needs `capture:queries`, and until somebody
 * runs it the generator has never met a model.
 *
 * The rules asserted below are cost rules, not tidiness. A Boolean query is
 * matched literally by Bright Data's keyword search and finds nothing, which
 * looks exactly like a quiet week. Two queries that mean the same thing
 * collect the same posts twice, and every post collected is billed.
 */
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import type { AiConfig } from "./config.js";
import type { MonitorProfile } from "./prompt.js";
import { createQueryGenerator, queryPlanSchema } from "./queries.js";

const monitor: MonitorProfile = {
  product: "A test runner that records browser flows instead of coding them",
  idealCustomer: "Small SaaS teams with no dedicated QA engineer",
  problem: "End-to-end tests break whenever the UI changes",
  signals: ["recommendation_request", "problem"],
};

/** A plan a model could plausibly write for the monitor above. */
const goodPlan = {
  queries: [
    "playwright tests break every release",
    "how do small teams handle regression testing",
    "tired of manually testing signup and checkout",
    "alternative to maintaining e2e tests",
  ],
  subreddits: ["SaaS", "webdev", "QualityAssurance"],
};

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    apiKey: "test-key",
    timeoutMs: 5_000,
    ...overrides,
  };
}

function modelReturning(value: unknown) {
  return new MockLanguageModelV4({
    provider: "test",
    modelId: "test-model",
    doGenerate: async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(value) }],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage: {
        inputTokens: { total: 400, noCache: 400, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 90, text: 90, reasoning: 0 },
      },
      warnings: [],
    }),
  });
}

function modelThrowing(error: unknown) {
  return new MockLanguageModelV4({
    provider: "test",
    modelId: "test-model",
    doGenerate: async () => {
      throw error;
    },
  });
}

/** What the schema does with one plan, without a model in the way. */
function parse(plan: unknown) {
  return queryPlanSchema.safeParse(plan);
}

function withQueries(...queries: string[]) {
  return { ...goodPlan, queries };
}

describe("what a query may be", () => {
  it("accepts a plain phrase", () => {
    expect(parse(goodPlan).success).toBe(true);
  });

  it("accepts a phrase that happens to contain the word and", () => {
    // Lower-case "and" is how people write. Refusing it would refuse half the
    // good queries to catch a Boolean operator nobody typed.
    const result = parse(
      withQueries(
        "manually testing signup and checkout",
        "regression testing takes too long",
        "our e2e suite is unmaintainable",
      ),
    );

    expect(result.success).toBe(true);
  });

  it("refuses a Boolean operator", () => {
    // Bright Data matches the string it is given, so this query finds nothing
    // and reports it as no results rather than as a mistake.
    expect(parse(withQueries("playwright AND flaky", "a b c", "d e f")).success).toBe(false);
  });

  it("refuses quotes and brackets", () => {
    expect(parse(withQueries('"exact phrase" testing', "a b c", "d e f")).success).toBe(false);
    expect(parse(withQueries("(playwright or cypress) slow", "a b c", "d e f")).success).toBe(
      false,
    );
  });

  it("refuses a field operator", () => {
    expect(parse(withQueries("subreddit:saas manual testing", "a b c", "d e f")).success).toBe(
      false,
    );
  });

  it("refuses a single word", () => {
    // One word is a category, and a category collects the whole site. On a
    // metered source that is the bill, not the noise.
    expect(parse(withQueries("testing", "a b c", "d e f")).success).toBe(false);
  });

  it("refuses two queries that differ only in case", () => {
    expect(
      parse(withQueries("flaky end to end tests", "Flaky End To End Tests", "a b c")).success,
    ).toBe(false);
  });

  it("refuses a plan with fewer than three queries", () => {
    // One query is a keyword alert, which PLAN.md says is not this product.
    expect(parse(withQueries("flaky e2e tests", "manual qa before release")).success).toBe(false);
  });
});

describe("what a subreddit may be", () => {
  function subredditsOf(plan: unknown): string[] {
    const result = parse(plan);
    return result.success ? result.data.subreddits : [];
  }

  it("strips an r/ prefix, because the connector builds the URL itself", () => {
    expect(subredditsOf({ ...goodPlan, subreddits: ["r/SaaS"] })).toEqual(["SaaS"]);
  });

  it("strips a full Reddit URL", () => {
    expect(subredditsOf({ ...goodPlan, subreddits: ["https://www.reddit.com/r/webdev/"] })).toEqual(
      ["webdev"],
    );
  });

  it("accepts an empty list", () => {
    // "I am not confident about any" is a better answer than an invented name.
    expect(parse({ ...goodPlan, subreddits: [] }).success).toBe(true);
  });

  it("refuses a name that is not a subreddit name", () => {
    expect(parse({ ...goodPlan, subreddits: ["small SaaS teams"] }).success).toBe(false);
  });
});

describe("a model that answers", () => {
  it("returns the queries and the subreddits", async () => {
    const generator = createQueryGenerator({ config: config(), model: modelReturning(goodPlan) });

    const outcome = await generator.generate(monitor);

    expect(outcome.status).toBe("generated");
    if (outcome.status !== "generated") return;

    expect(outcome.plan.queries).toEqual(goodPlan.queries);
    expect(outcome.plan.subreddits).toEqual(goodPlan.subreddits);
  });

  it("records what the call cost", async () => {
    const generator = createQueryGenerator({ config: config(), model: modelReturning(goodPlan) });

    const outcome = await generator.generate(monitor);

    expect(outcome.call.inputTokens).toBe(400);
    expect(outcome.call.outputTokens).toBe(90);
    // Claude Haiku 4.5 is $1 per million input and $5 per million output.
    // 400 x $1/1e6 + 90 x $5/1e6 = $0.00085, which is 850 micros.
    expect(outcome.call.estimatedCostMicros).toBe(850);
  });
});

describe("a model that answers badly", () => {
  it("rejects a plan the schema refuses rather than storing it", async () => {
    const generator = createQueryGenerator({
      config: config(),
      model: modelReturning(withQueries("qa", "testing", "software")),
    });

    const outcome = await generator.generate(monitor);

    expect(outcome.status).toBe("rejected");
    expect(outcome).not.toHaveProperty("plan");
  });

  it("rejects prose that is not JSON at all", async () => {
    const generator = createQueryGenerator({
      config: config(),
      model: modelReturning("Here are some ideas for search queries you could try."),
    });

    expect((await generator.generate(monitor)).status).toBe("rejected");
  });
});

describe("a model that cannot be reached", () => {
  it("reports a provider error as failed, not as a bad answer", async () => {
    // The two need different answers from a person: `rejected` points at the
    // prompt, `failed` points at the key, the network or the provider.
    const generator = createQueryGenerator({
      config: config(),
      model: modelThrowing(
        new APICallError({
          message: "rate limit exceeded",
          url: "https://example.test/v1",
          requestBodyValues: {},
          statusCode: 429,
        }),
      ),
    });

    const outcome = await generator.generate(monitor);

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.error).toContain("rate limit");
  });

  it("lets a programming error through instead of calling it a model failure", async () => {
    // The catch in `call.ts` is shared with the classifier, and this is its
    // second caller. docs/testing.md: a rule is only as tested as its
    // least-tested caller, so the branch that must not swallow a TypeError is
    // asserted here too, not only through the classifier.
    const generator = createQueryGenerator({
      config: config(),
      model: modelThrowing(new TypeError("cannot read properties of undefined")),
    });

    await expect(generator.generate(monitor)).rejects.toThrow(TypeError);
  });
});
