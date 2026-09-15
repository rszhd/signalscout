/**
 * Which provider a deployment names per platform for the plan that lends its
 * keys, and what a name this build cannot run is refused with. US-130.
 *
 * Driven against the built-in connectors, because the refusal's whole point is
 * to compare a variable with what this build registers and offers.
 */
import { describe, expect, it } from "vitest";
import { builtInSources } from "./index.js";
import { lentProvidersFrom, lentProviderVariableName } from "./lent-providers.js";

describe("the variable's name", () => {
  it("is the platform id, upper snake case, under one prefix", () => {
    expect(lentProviderVariableName("reddit")).toBe("KEYS_INCLUDED_PROVIDER_REDDIT");
    expect(lentProviderVariableName("x")).toBe("KEYS_INCLUDED_PROVIDER_X");
    expect(lentProviderVariableName("linkedin")).toBe("KEYS_INCLUDED_PROVIDER_LINKEDIN");
  });
});

describe("reading the deployment's providers", () => {
  it("names nothing where nothing is set, which is every self-hosted instance", () => {
    expect(lentProvidersFrom({}, builtInSources)).toEqual({});
  });

  it("reads one provider per platform, and only the platforms that are set", () => {
    const named = lentProvidersFrom(
      {
        KEYS_INCLUDED_PROVIDER_REDDIT: "scrapecreators",
        KEYS_INCLUDED_PROVIDER_X: "socialdata",
        KEYS_INCLUDED_PROVIDER_LINKEDIN: "apify",
      },
      builtInSources,
    );

    expect(named).toEqual({ reddit: "scrapecreators", x: "socialdata", linkedin: "apify" });
  });

  it("treats a blank value as unset", () => {
    expect(lentProvidersFrom({ KEYS_INCLUDED_PROVIDER_REDDIT: "  " }, builtInSources)).toEqual({});
  });

  /**
   * The three refusals, each at boot rather than at 02:00: a provider this
   * build does not have, one it has that does not fetch the platform, and one
   * it has switched off. The message names the repair each time.
   */
  it("refuses a provider this build does not have, naming the ones that fetch the platform", () => {
    expect(() =>
      lentProvidersFrom({ KEYS_INCLUDED_PROVIDER_REDDIT: "scrapecreatorz" }, builtInSources),
    ).toThrow(
      /KEYS_INCLUDED_PROVIDER_REDDIT=scrapecreatorz .*does not fetch reddit.*scrapecreators/,
    );
  });

  it("refuses a provider that does not fetch the platform named", () => {
    // Apify fetches LinkedIn and nothing else.
    expect(() =>
      lentProvidersFrom({ KEYS_INCLUDED_PROVIDER_REDDIT: "apify" }, builtInSources),
    ).toThrow(/does not fetch reddit/);
  });

  it("refuses a provider this build has switched off, with the reason", () => {
    // SocialCrawl's LinkedIn connector carries `notOffered` since US-053.
    expect(() =>
      lentProvidersFrom({ KEYS_INCLUDED_PROVIDER_LINKEDIN: "socialcrawl" }, builtInSources),
    ).toThrow(/switched off/);
  });
});
