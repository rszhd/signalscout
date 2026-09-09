/**
 * Switching a connector off. US-053.
 *
 * The mechanism is the subject here and LinkedIn is only its first caller, so
 * nothing below names a real connector: a switch that works for one pair and
 * not for the next is not a switch. Reddit is used because it is the platform
 * with three providers, and losing one of three is the case that has to stay
 * right — the platform keeps polling, and a recorded choice naming the one that
 * went is refused rather than quietly moved to whoever is left.
 *
 * Correctness-critical, and the failure shape is money at a provider nobody
 * chose. `decideProvider` already refuses a choice it cannot run; a switched-off
 * connector is one it cannot run, and treating it instead as a stale row would
 * bill a second account at a price the person never saw.
 */
import { describe, expect, it } from "vitest";
import { createLogger } from "../logger.js";
import { unreachableFetch } from "../testing/network.js";
import { fakeSourceDefinition } from "./fake/index.js";
import { isOffered, notOfferedReason, offeredConnectors, reasonsByProvider } from "./offering.js";
import { groupByPlatform } from "./platforms.js";
import {
  ConnectorNotOfferedError,
  createSourceRegistry,
  decideProvider,
  NoUsableProviderError,
} from "./registry.js";
import type { ConnectorDefinition, SourceRuntime } from "./types.js";

const runtime: SourceRuntime = {
  fetch: unreachableFetch,
  now: () => new Date("2026-09-09T12:00:00.000Z"),
  sleep: () => Promise.resolve(),
  logger: createLogger({ level: "silent", name: "offering-test" }),
};

const tooDear = "Reddit through ScrapeCreators is switched off: it costs too much here.";

/** Reddit through three providers, with the middle one switched off. */
function threeRedditProviders(): ConnectorDefinition[] {
  return [
    fakeSourceDefinition({ id: "reddit", displayName: "Reddit", providerId: "brightdata" }),
    fakeSourceDefinition({
      id: "reddit",
      displayName: "Reddit",
      providerId: "scrapecreators",
      notOffered: tooDear,
    }),
    fakeSourceDefinition({ id: "reddit", displayName: "Reddit", providerId: "socialcrawl" }),
  ];
}

function registryOf(...definitions: ConnectorDefinition[]) {
  return createSourceRegistry({ definitions, runtime });
}

describe("one field switches a connector off", () => {
  it("reads as offered until it carries a reason", () => {
    const on = fakeSourceDefinition({ id: "reddit", providerId: "brightdata" });
    const off = fakeSourceDefinition({
      id: "reddit",
      providerId: "scrapecreators",
      notOffered: tooDear,
    });

    expect(isOffered(on)).toBe(true);
    expect(isOffered(off)).toBe(false);
    expect(offeredConnectors([on, off])).toEqual([on]);
    expect(reasonsByProvider([on, off], "reddit")).toEqual({ scrapecreators: tooDear });
  });

  it("says nothing about a platform another provider still fetches", () => {
    // The reason a platform is not the axis. Losing one of three providers is
    // not losing Reddit.
    expect(notOfferedReason(threeRedditProviders(), "reddit")).toBeNull();
  });

  it("answers with the reason when every connector for a platform is off", () => {
    const sources = [
      fakeSourceDefinition({ id: "linkedin", providerId: "socialcrawl", notOffered: tooDear }),
    ];

    expect(notOfferedReason(sources, "linkedin")).toBe(tooDear);
  });

  it("joins the reasons when two providers were switched off for two reasons", () => {
    // A person reading one reason would think the other provider was a way in.
    const stale = "It returns posts weeks old.";
    const sources = [
      fakeSourceDefinition({ id: "linkedin", providerId: "socialcrawl", notOffered: tooDear }),
      fakeSourceDefinition({ id: "linkedin", providerId: "scrapecreators", notOffered: stale }),
    ];

    expect(notOfferedReason(sources, "linkedin")).toBe(`${tooDear} ${stale}`);
  });

  it("says nothing about a platform this build has no connector for", () => {
    // `UnknownSourceError`'s question, and answering it here would put two
    // different refusals on one sentence.
    expect(notOfferedReason(threeRedditProviders(), "bluesky")).toBeNull();
  });
});

describe("a platform that loses one of its three providers", () => {
  it("is still offered, and still polls through another provider", () => {
    const registry = registryOf(...threeRedditProviders());

    expect(registry.notOffered("reddit")).toBeNull();
    expect(registry.only("reddit", { among: ["brightdata"] }).provider.id).toBe("brightdata");
  });

  it("is not answered by the switched-off provider, even when it holds the only key", () => {
    // The deployment has a ScrapeCreators key and nothing else. Before the
    // switch that was the one answer; now there is none, and saying so beats
    // collecting through a connector this build will not stand behind.
    const registry = registryOf(...threeRedditProviders());

    expect(() => registry.only("reddit", { among: ["scrapecreators"] })).toThrow(
      NoUsableProviderError,
    );
  });

  it("refuses a recorded choice naming it rather than replacing it", () => {
    /**
     * The money case, and the one this ticket could get wrong. A row says
     * ScrapeCreators; the build no longer offers it. Falling back to Bright
     * Data would go on collecting at a price nobody chose, which is exactly
     * what US-026 refuses when a key goes missing.
     */
    const registry = registryOf(...threeRedditProviders());
    const choices = { reddit: "scrapecreators" };

    expect(() =>
      registry.only("reddit", { among: ["brightdata", "scrapecreators"], choices }),
    ).toThrow(NoUsableProviderError);
    expect(() =>
      registry.only("reddit", { among: ["brightdata", "scrapecreators"], choices }),
    ).toThrow('"reddit" is set to fetch through "scrapecreators", which cannot run here.');
  });

  it("carries the reason on the decision, so a screen can say which kind of refusal it is", () => {
    const decision = decideProvider(
      "reddit",
      ["brightdata", "scrapecreators"],
      ["brightdata", "scrapecreators"],
      { reddit: "scrapecreators" },
      { scrapecreators: tooDear },
    );

    expect(decision).toEqual({
      status: "unavailable",
      chosen: "scrapecreators",
      available: ["brightdata"],
      reason: tooDear,
    });
  });

  it("never offers the switched-off provider as the repair", () => {
    // "Connect scrapecreators" is an instruction that cannot work.
    const decision = decideProvider(
      "reddit",
      ["brightdata", "scrapecreators"],
      [],
      {},
      {
        scrapecreators: tooDear,
      },
    );

    expect(decision).toEqual({ status: "unavailable", chosen: null, available: ["brightdata"] });
  });

  it("asks no choice when the switch leaves one provider standing", () => {
    // Two offered providers with keys is a question. One offered and one
    // switched off is not, and asking it would be a question with one answer.
    const decision = decideProvider(
      "reddit",
      ["brightdata", "scrapecreators"],
      ["brightdata", "scrapecreators"],
      {},
      { scrapecreators: tooDear },
    );

    expect(decision).toEqual({ status: "chosen", providerId: "brightdata", recorded: false });
  });

  it("leaves the switched-off provider off the screens and keeps the platform on them", () => {
    const grouped = groupByPlatform(threeRedditProviders());

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.providers.map((provider) => provider.id)).toEqual([
      "brightdata",
      "socialcrawl",
    ]);
  });
});

describe("a platform whose every connector is switched off", () => {
  const sources = [
    fakeSourceDefinition({ id: "reddit", displayName: "Reddit", providerId: "brightdata" }),
    fakeSourceDefinition({
      id: "linkedin",
      displayName: "LinkedIn",
      providerId: "socialcrawl",
      notOffered: tooDear,
    }),
  ];

  it("disappears from every screen that lists platforms", () => {
    // One filter, inside `groupByPlatform`, is what makes this cost no screen a
    // branch: the monitor form and the connections rows both read it.
    expect(groupByPlatform(sources).map(({ platform }) => platform.id)).toEqual(["reddit"]);
  });

  it("is refused by the registry with the reason, not with 'unknown'", () => {
    // The two send a reader to opposite places. "Unknown" means go and look for
    // the code; this means the code is there and switched off.
    const registry = registryOf(...sources);

    expect(registry.notOffered("linkedin")).toBe(tooDear);
    expect(() => registry.only("linkedin")).toThrow(ConnectorNotOfferedError);
    expect(() => registry.only("linkedin")).toThrow(tooDear);
  });

  it("is still fetched by id, so a collection already paid for is read", () => {
    // A continuation names the provider that started it. Refusing here would
    // throw away a snapshot somebody has already been billed for.
    const registry = registryOf(...sources);

    expect(registry.get("linkedin", "socialcrawl").provider.id).toBe("socialcrawl");
    expect(registry.forPlatform("linkedin")).toHaveLength(1);
  });

  it("does not stop the process at boot", () => {
    // A monitor written before the switch still names it. `require` is about a
    // connector that is missing, and this one is not.
    const registry = registryOf(...sources);

    expect(() => registry.require(["reddit", "linkedin"])).not.toThrow();
  });
});
