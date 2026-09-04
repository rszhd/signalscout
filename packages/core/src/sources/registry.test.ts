import { describe, expect, it } from "vitest";
import { createLogger } from "../logger.js";
import { unreachableFetch } from "../testing/network.js";
import { fakeSourceDefinition } from "./fake/index.js";
import { createSourceRegistry, UnknownSourceError } from "./registry.js";
import { assertSourcesCanBeStored } from "./storage.js";
import type { SourceDefinition, SourceRuntime } from "./types.js";

const runtime: SourceRuntime = {
  fetch: unreachableFetch,
  now: () => new Date("2026-09-04T12:00:00.000Z"),
  sleep: () => Promise.resolve(),
  logger: createLogger({ level: "silent", name: "registry-test" }),
};

function registryOf(...definitions: SourceDefinition[]) {
  return createSourceRegistry({ definitions, runtime });
}

describe("the registry answers for a source", () => {
  it("returns the source registered under an id", () => {
    const registry = registryOf(fakeSourceDefinition({ id: "reddit", displayName: "Reddit" }));

    expect(registry.get("reddit").displayName).toBe("Reddit");
    expect(registry.has("reddit")).toBe(true);
    expect(registry.ids()).toEqual(["reddit"]);
    expect(registry.list()).toHaveLength(1);
  });

  it("throws for an id it does not know, and names what it does know", () => {
    const registry = registryOf(fakeSourceDefinition({ id: "reddit" }));

    expect(() => registry.get("bluesky")).toThrow(UnknownSourceError);
    expect(() => registry.get("bluesky")).toThrow(
      'Unknown source "bluesky". Registered sources: reddit.',
    );
  });

  it("says so plainly when nothing is registered at all", () => {
    const registry = registryOf();

    expect(() => registry.get("reddit")).toThrow("Registered sources: (none).");
  });
});

describe("the registry fails at startup, not at poll time", () => {
  it("refuses two connectors claiming the same id", () => {
    expect(() =>
      registryOf(fakeSourceDefinition({ id: "x" }), fakeSourceDefinition({ id: "x" })),
    ).toThrow('Two sources are registered as "x".');
  });

  it("refuses an id that cannot travel through a URL or a column", () => {
    expect(() => registryOf(fakeSourceDefinition({ id: "Reddit" }))).toThrow(/not usable/);
    expect(() => registryOf(fakeSourceDefinition({ id: "" }))).toThrow(/not usable/);
    expect(() => registryOf(fakeSourceDefinition({ id: "hacker news" }))).toThrow(/not usable/);
  });

  it("refuses a price that is not a whole number of micro-dollars", () => {
    // $0.005 is 5000 micro-dollars. A connector that writes 0.005 has written
    // dollars in a field that counts millionths, and every budget sum after it
    // is wrong by a factor of a million.
    expect(() => registryOf(fakeSourceDefinition({ id: "x", pricePerUnitMicros: 0.005 }))).toThrow(
      /not a whole number/,
    );
    expect(() => registryOf(fakeSourceDefinition({ id: "x", pricePerUnitMicros: -1 }))).toThrow(
      /not a whole number/,
    );
    expect(() =>
      registryOf(fakeSourceDefinition({ id: "x", pricePerUnitMicros: 5000 })),
    ).not.toThrow();
  });

  it("checks a whole list of wanted ids at once and names every missing one", () => {
    const registry = registryOf(fakeSourceDefinition({ id: "reddit" }));

    expect(() => registry.require(["reddit"])).not.toThrow();
    expect(() => registry.require(["reddit", "x", "bluesky"])).toThrow(
      'Unknown sources "x", "bluesky". Registered sources: reddit.',
    );
  });
});

describe("a connector whose posts cannot be stored", () => {
  it("passes for the sources the schema accepts", () => {
    expect(() => assertSourcesCanBeStored(["reddit", "x"])).not.toThrow();
  });

  it("fails for one the posts table has no room for", () => {
    // Without this the connector works until the first insert, which happens
    // inside a scheduled job at night.
    expect(() => assertSourcesCanBeStored(["reddit", "bluesky"])).toThrow(/no place for "bluesky"/);
    expect(() => assertSourcesCanBeStored(["bluesky"])).toThrow(/Extending it is a migration/);
  });
});
