/**
 * An instance's own prices for its providers. US-389.
 *
 * The failure these guard is a price that reaches some readers and not
 * others: the definition says one thing, the connector the registry builds
 * says another, and the budget guard, which reads the connector, spends past
 * a cap that the cost screen, which reads the definition, says is safe.
 */
import { describe, expect, it } from "vitest";
import { createLogger } from "../logger.js";
import { fakeSourceDefinition } from "./fake/index.js";
import { withInstancePrices } from "./prices.js";
import { apifyLinkedIn } from "./providers/apify/linkedin.js";
import { harvestApiLinkedIn } from "./providers/harvestapi/linkedin.js";
import { socialCrawlInstagram } from "./providers/socialcrawl/instagram.js";
import { socialCrawlX } from "./providers/socialcrawl/x.js";
import { socialDataX } from "./providers/socialdata/x.js";
import { createSourceRegistry } from "./registry.js";
import type { SourceRuntime } from "./types.js";

const runtime: SourceRuntime = {
  fetch: () => Promise.reject(new Error("no test reaches a provider")),
  now: () => new Date("2026-09-24T00:00:00.000Z"),
  sleep: () => Promise.resolve(),
  logger: createLogger({ level: "silent", name: "prices-test" }),
};

/** SocialCrawl's £49 pack: £0.00245 a credit at $1.353, rounded up. */
const growthPack = 3_315;

describe("withInstancePrices", () => {
  it("scales a provider's connectors by the price paid over the list price", () => {
    const [instagram, x] = withInstancePrices([socialCrawlInstagram, socialCrawlX], {
      socialcrawl: growthPack,
    });

    // A search page is one credit and a comment page five, and both move by
    // the same ratio, so the five-to-one survives.
    expect(instagram?.pricePerUnitMicros).toBe(growthPack);
    expect(instagram?.replyPricePerUnitMicros).toBe(5 * growthPack);
    expect(x?.pricePerUnitMicros).toBe(growthPack);
  });

  it("gives the connector the registry builds the same prices as its definition", () => {
    const priced = withInstancePrices([socialCrawlInstagram], { socialcrawl: growthPack });
    const registry = createSourceRegistry({ definitions: priced, runtime });

    const connector = registry.get("instagram", "socialcrawl");

    expect(connector.pricePerUnitMicros).toBe(growthPack);
    expect(connector.replyPricePerUnitMicros).toBe(5 * growthPack);
  });

  it("leaves the connector working: its methods run with their own state", async () => {
    const [priced] = withInstancePrices([harvestApiLinkedIn], { harvestapi: 3_200 });
    const connector = priced?.create(runtime);

    // Reaches the connector's own method and its own private runtime, and
    // calls nobody: a missing key is answered before any request.
    expect(await connector?.validateCredentials({})).toEqual({
      valid: false,
      reason: "Enter your HarvestAPI key.",
    });
    expect(connector?.pricePerUnitMicros).toBe(3_200);
    expect(connector?.provider.id).toBe("harvestapi");
  });

  it("rounds a fraction of a micro-dollar up, never down", () => {
    // Every shipped connector is a whole number of its provider's units, so
    // this is a constructed one: 10 at a list price of 3, paid 2, is 6⅔.
    const fake = fakeSourceDefinition({ pricePerUnitMicros: 10 });
    const odd = { ...fake, provider: { ...fake.provider, unitPriceMicros: 3 } };

    const [priced] = withInstancePrices([odd], { [odd.provider.id]: 2 });

    expect(priced?.pricePerUnitMicros).toBe(7);
  });

  it("keeps a whole multiple exact, whatever floating point makes of it", () => {
    // 40,590 × 3,315 / 8,118 is 16,575 in arithmetic and a hair either side
    // of it in a double; rounding up the hair above would bill a micro-dollar
    // that was never spent, on every comment page.
    const [instagram] = withInstancePrices([socialCrawlInstagram], { socialcrawl: 3_315 });

    expect(instagram?.replyPricePerUnitMicros).toBe(16_575);
  });

  it("returns every other definition as it was, the same object", () => {
    const definitions = [socialCrawlInstagram, socialDataX, harvestApiLinkedIn];

    const priced = withInstancePrices(definitions, { socialcrawl: growthPack });

    expect(priced[1]).toBe(socialDataX);
    expect(priced[2]).toBe(harvestApiLinkedIn);
  });

  it("changes nothing when given no prices", () => {
    const definitions = [socialCrawlInstagram, apifyLinkedIn];

    expect(withInstancePrices(definitions, {})).toEqual(definitions);
    expect(withInstancePrices(definitions, {})[1]).toBe(apifyLinkedIn);
  });

  describe("refuses, naming the provider, a price that would hide spending", () => {
    for (const [label, price] of [
      ["zero", 0],
      ["negative", -1],
      ["a fraction", 3_314.5],
      ["not a number", Number.NaN],
      ["infinite", Number.POSITIVE_INFINITY],
    ] as const) {
      it(`${label}`, () => {
        expect(() => withInstancePrices([socialCrawlInstagram], { socialcrawl: price })).toThrow(
          /socialcrawl/,
        );
      });
    }

    it("a provider none of the connectors names", () => {
      expect(() => withInstancePrices([socialCrawlInstagram], { socialcrowl: growthPack })).toThrow(
        /socialcrowl/,
      );
    });

    it("a provider that cannot be scaled", () => {
      expect(() => withInstancePrices([apifyLinkedIn], { apify: 1_500 })).toThrow(/apify/);
    });

    it("a provider with no list price, like the fake", () => {
      const fake = fakeSourceDefinition({ pricePerUnitMicros: 100 });

      expect(() => withInstancePrices([fake], { [fake.provider.id]: 50 })).toThrow(
        new RegExp(fake.provider.id),
      );
    });
  });
});
