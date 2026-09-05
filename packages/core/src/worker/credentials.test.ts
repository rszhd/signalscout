import { describe, expect, it } from "vitest";
import type { SocialSource } from "../sources/types.js";
import { credentialsFromEnvironment, environmentVariableFor } from "./credentials.js";

function sourceWith(id: string, fields: string[]): SocialSource {
  return {
    id,
    displayName: id,
    billableUnit: "record",
    pricePerUnitMicros: 0,
    maxUnitsPerQueryPoll: 50,
    credentialFields: fields.map((name) => ({ name, label: name, secret: true })),
    validateCredentials: async () => ({ valid: true }),
    search: async () => ({ posts: [], unitsConsumed: 0, next: { status: "done" } }),
  };
}

describe("the environment variable a credential comes from", () => {
  it("is named after the source and the field, never after the provider", () => {
    // A user connects Reddit. That this Reddit arrives through Bright Data is
    // a fact of sources/reddit/, and STACK.md keeps it there.
    expect(environmentVariableFor("reddit", "apiKey")).toBe("REDDIT_API_KEY");
    expect(environmentVariableFor("x", "apiSecret")).toBe("X_API_SECRET");
    expect(environmentVariableFor("hacker-news", "token")).toBe("HACKER_NEWS_TOKEN");
  });
});

describe("reading credentials from the environment", () => {
  it("collects every field a connector declares", () => {
    const lookup = credentialsFromEnvironment({ X_API_KEY: "key", X_API_SECRET: "secret" });

    expect(lookup(sourceWith("x", ["apiKey", "apiSecret"]))).toEqual({
      apiKey: "key",
      apiSecret: "secret",
    });
  });

  it("answers nothing at all when one field is missing", () => {
    // Half a key is a failed API call, and a failed API call retries four
    // times before it dead-letters. Four wrong answers to a question that can
    // be answered here for nothing.
    const lookup = credentialsFromEnvironment({ X_API_KEY: "key" });

    expect(lookup(sourceWith("x", ["apiKey", "apiSecret"]))).toBeUndefined();
  });

  it("treats an empty variable as unset", () => {
    const lookup = credentialsFromEnvironment({ REDDIT_API_KEY: "" });

    expect(lookup(sourceWith("reddit", ["apiKey"]))).toBeUndefined();
  });
});
