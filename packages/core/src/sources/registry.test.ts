import { describe, expect, it } from "vitest";
import { createLogger } from "../logger.js";
import { unreachableFetch } from "../testing/network.js";
import { fakeSourceDefinition } from "./fake/index.js";
import {
  AmbiguousConnectorError,
  createSourceRegistry,
  UnknownConnectorError,
  UnknownSourceError,
} from "./registry.js";
import { assertSourcesCanBeStored } from "./storage.js";
import type { ConnectorDefinition, SourceRuntime } from "./types.js";

const runtime: SourceRuntime = {
  fetch: unreachableFetch,
  now: () => new Date("2026-09-04T12:00:00.000Z"),
  sleep: () => Promise.resolve(),
  logger: createLogger({ level: "silent", name: "registry-test" }),
};

function registryOf(...definitions: ConnectorDefinition[]) {
  return createSourceRegistry({ definitions, runtime });
}

describe("the registry answers for a platform and a provider together", () => {
  it("returns the connector registered under a pair", () => {
    const registry = registryOf(
      fakeSourceDefinition({ id: "reddit", displayName: "Reddit", providerId: "brightdata" }),
    );

    expect(registry.get("reddit", "brightdata").platform.displayName).toBe("Reddit");
    expect(registry.has("reddit", "brightdata")).toBe(true);
    expect(registry.platforms()).toEqual(["reddit"]);
    expect(registry.keys()).toEqual([{ platformId: "reddit", providerId: "brightdata" }]);
    expect(registry.list()).toHaveLength(1);
  });

  it("refuses a pair nothing fetches, and names both halves of it", () => {
    // The mistake this ticket's split makes possible: the platform is right,
    // the provider is not, and a message naming only the platform would send
    // the reader looking for a connector that is registered.
    const registry = registryOf(fakeSourceDefinition({ id: "reddit", providerId: "brightdata" }));

    expect(() => registry.get("reddit", "scrapecreators")).toThrow(UnknownConnectorError);
    expect(() => registry.get("reddit", "scrapecreators")).toThrow(
      'No connector fetches "reddit" from "scrapecreators". ' +
        "Registered connectors: reddit via brightdata.",
    );
  });

  it("says so plainly when nothing is registered at all", () => {
    const registry = registryOf();

    expect(() => registry.get("reddit", "brightdata")).toThrow("Registered connectors: (none).");
  });
});

describe("a caller that has a platform and no provider", () => {
  it("gets the one connector that fetches it", () => {
    const registry = registryOf(
      fakeSourceDefinition({ id: "reddit", displayName: "Reddit", providerId: "brightdata" }),
    );

    expect(registry.only("reddit").provider.id).toBe("brightdata");
  });

  it("throws for a platform it does not know, and names what it does know", () => {
    const registry = registryOf(fakeSourceDefinition({ id: "reddit" }));

    expect(() => registry.only("bluesky")).toThrow(UnknownSourceError);
    expect(() => registry.only("bluesky")).toThrow(
      'Unknown source "bluesky". Registered sources: reddit.',
    );
  });

  it("refuses to choose when two providers fetch the platform", () => {
    // Registration order is not a choice. Answering with the first would spend
    // somebody's money at a provider they did not pick, and the day this
    // happens the caller is what has to be given a choice.
    const registry = registryOf(
      fakeSourceDefinition({ id: "reddit", providerId: "brightdata" }),
      fakeSourceDefinition({ id: "reddit", providerId: "scrapecreators" }),
    );

    expect(registry.forPlatform("reddit")).toHaveLength(2);
    expect(() => registry.only("reddit")).toThrow(AmbiguousConnectorError);
    expect(() => registry.only("reddit")).toThrow(
      '"reddit" is fetched by brightdata and scrapecreators.',
    );
  });

  it("answers with the provider a deployment recorded", () => {
    // A recorded choice is not a guess. The objection to registration order is
    // that nobody chose it; an entry here was chosen by whoever configured the
    // deployment. US-025 fills it from one variable, US-026 from a stored row.
    const registry = createSourceRegistry({
      definitions: [
        fakeSourceDefinition({ id: "reddit", providerId: "brightdata" }),
        fakeSourceDefinition({ id: "reddit", providerId: "scrapecreators" }),
      ],
      runtime,
      defaultProviders: { reddit: "scrapecreators" },
    });

    expect(registry.only("reddit").provider.id).toBe("scrapecreators");
  });

  it("still refuses when the recorded provider does not fetch the platform", () => {
    // Falling back to one of the two would spend money at a provider nobody
    // picked, which is the failure `only` exists to prevent. A misconfigured
    // choice has to be as loud as no choice at all.
    const registry = createSourceRegistry({
      definitions: [
        fakeSourceDefinition({ id: "reddit", providerId: "brightdata" }),
        fakeSourceDefinition({ id: "reddit", providerId: "scrapecreators" }),
      ],
      runtime,
      defaultProviders: { reddit: "a-provider-that-is-not-registered" },
    });

    expect(() => registry.only("reddit")).toThrow(AmbiguousConnectorError);
  });

  it("ignores a recorded choice for a platform that has only one provider", () => {
    const registry = createSourceRegistry({
      definitions: [fakeSourceDefinition({ id: "reddit", providerId: "brightdata" })],
      runtime,
      defaultProviders: { reddit: "scrapecreators" },
    });

    // One connector can run, so there is nothing to choose and a stale entry
    // must not turn a working deployment into a failing one.
    expect(registry.only("reddit").provider.id).toBe("brightdata");
  });
});

describe("the registry fails at startup, not at poll time", () => {
  it("refuses two connectors claiming the same pair", () => {
    expect(() =>
      registryOf(
        fakeSourceDefinition({ id: "x", providerId: "brightdata" }),
        fakeSourceDefinition({ id: "x", providerId: "brightdata" }),
      ),
    ).toThrow('Two connectors are registered as "x via brightdata".');
  });

  it("allows the same platform twice through different providers", () => {
    expect(() =>
      registryOf(
        fakeSourceDefinition({ id: "x", providerId: "brightdata" }),
        fakeSourceDefinition({ id: "x", providerId: "scrapecreators" }),
      ),
    ).not.toThrow();
  });

  it("refuses an id that cannot travel through a URL or a column", () => {
    expect(() => registryOf(fakeSourceDefinition({ id: "Reddit" }))).toThrow(/not usable/);
    expect(() => registryOf(fakeSourceDefinition({ id: "" }))).toThrow(/not usable/);
    expect(() => registryOf(fakeSourceDefinition({ id: "hacker news" }))).toThrow(/not usable/);
  });

  it("holds a provider id to the same alphabet", () => {
    // It reaches `source_credentials.provider` and an environment variable
    // name, so a space or a capital in it breaks the same two things.
    expect(() => registryOf(fakeSourceDefinition({ providerId: "Bright Data" }))).toThrow(
      /Provider id "Bright Data" is not usable/,
    );
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

  it("refuses a connector that says one query costs nothing to poll", () => {
    // US-014 multiplies this by the polls in a month. A zero here reports
    // every plan on this source as free, which is the one wrong answer a cost
    // screen must never give — and it would be given at boot, quietly, to
    // everybody.
    expect(() => registryOf(fakeSourceDefinition({ id: "x", maxUnitsPerQueryPoll: 0 }))).toThrow(
      /at least one/,
    );
    expect(() => registryOf(fakeSourceDefinition({ id: "x", maxUnitsPerQueryPoll: 2.5 }))).toThrow(
      /whole number/,
    );
    expect(() =>
      registryOf(fakeSourceDefinition({ id: "x", maxUnitsPerQueryPoll: 100 })),
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
