// @vitest-environment jsdom
/**
 * The pricing comparison, driven through the DOM a person uses.
 *
 * What this file owns is whether a person can actually compare two providers:
 * that both appear for one platform, that the comparable figure is shown for
 * each, that the cheaper one is marked, and that nothing is rounded to cents.
 * The arithmetic behind those figures is asserted in
 * `apps/api/src/pricing.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Pricing } from "./Pricing.js";
import { json, mount, type Screen, settle } from "./testing.js";

function money(micros: number) {
  return { micros, display: `$${(micros / 1_000_000).toFixed(4)}` };
}

function connector(overrides: Record<string, unknown> = {}) {
  return {
    providerId: "socialcrawl",
    providerName: "SocialCrawl",
    billableUnit: "credit",
    pricePerUnit: money(8118),
    postsPerUnit: 2,
    estimatedPerComparedPosts: money(202950),
    replyPricePerUnit: null,
    ceilingPerQueryPoll: money(16236),
    connected: true,
    missingEnvironmentVariables: [],
    inUse: true,
    spent: { units: 10, cost: money(81180) },
    ...overrides,
  };
}

/** The two LinkedIn providers, which is the comparison this page exists for. */
function linkedIn() {
  return {
    id: "linkedin",
    displayName: "LinkedIn",
    comparable: true,
    connectors: [
      connector(),
      connector({
        providerId: "apify",
        providerName: "Apify",
        billableUnit: "post",
        pricePerUnit: money(2000),
        postsPerUnit: 1,
        estimatedPerComparedPosts: money(100000),
        ceilingPerQueryPoll: money(50000),
        inUse: false,
        spent: { units: 26, cost: money(52000) },
      }),
    ],
  };
}

function view(overrides: Record<string, unknown> = {}) {
  return { comparedPosts: 50, platforms: [linkedIn()], ...overrides };
}

let screen: Screen;

/** Everything a person can read on the screen, as one string. */
function text(): string {
  return screen.container.textContent ?? "";
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(async () => {
  await screen?.unmount();
});

async function show(body: unknown) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(json(body));
  screen = await mount(<Pricing />);
  await settle();
}

describe("comparing two providers for one platform", () => {
  it("shows both, so the comparison is on one screen", async () => {
    await show(view());

    expect(text()).toContain("SocialCrawl");
    expect(text()).toContain("Apify");
    expect(text()).toContain("LinkedIn");
  });

  it("shows a comparable figure for each, over the same number of posts", async () => {
    // The whole point. $8.12 per 1,000 credits and $2.00 per 1,000 posts are
    // not two numbers anybody can put side by side; $0.2030 and $0.1000 for
    // the same fifty posts are.
    await show(view());

    // 25 credits at 8,118 micro-dollars is 202,950, which is $0.2029 and not
    // $0.2030. The fourth decimal place is there so that difference is visible
    // rather than rounded away.
    expect(text()).toContain("$0.2029");
    expect(text()).toContain("$0.1000");
    expect(text()).toContain("50 posts");
  });

  it("marks the cheaper one, and only where there is a choice", async () => {
    await show(view());

    expect(text()).toContain("cheapest here");
  });

  it("does not call one provider cheapest when a platform has only one", async () => {
    // "Cheapest" against no alternative reads as a recommendation about a
    // choice nobody has.
    await show(
      view({
        platforms: [{ id: "x", displayName: "X", comparable: false, connectors: [connector()] }],
      }),
    );

    expect(text()).not.toContain("cheapest");
  });

  it("says which provider a poll would really use", async () => {
    await show(view());

    expect(text()).toContain("In use");
  });

  it("says when a provider has no key here", async () => {
    await show(
      view({
        platforms: [
          {
            id: "linkedin",
            displayName: "LinkedIn",
            comparable: true,
            connectors: [
              connector(),
              connector({
                providerId: "apify",
                providerName: "Apify",
                connected: false,
                missingEnvironmentVariables: ["APIFY_API_TOKEN"],
                inUse: false,
              }),
            ],
          },
        ],
      }),
    );

    expect(text()).toContain("No key");
  });
});

describe("keeping three kinds of number apart", () => {
  it("labels the comparison an estimate", async () => {
    await show(view());

    expect(text()).toContain("estimated");
  });

  it("shows what has really been spent, separately from the estimate", async () => {
    // Money already gone, from `api_usage`. It is the one figure here that is
    // not a projection, and the strongest thing to compare two providers on.
    await show(view());

    expect(text()).toContain("$0.0812");
    expect(text()).toContain("$0.0520");
    expect(text()).toContain("billed");
  });

  it("says nothing yet rather than showing a zero as a price", async () => {
    await show(
      view({
        platforms: [
          {
            id: "x",
            displayName: "X",
            comparable: false,
            connectors: [connector({ spent: { units: 0, cost: money(0) } })],
          },
        ],
      }),
    );

    expect(text()).toContain("nothing yet");
  });

  it("admits when nobody measured what a unit brings back", async () => {
    // Without a yield there is no comparable figure, and inventing one would
    // be the only dishonest thing this page could do.
    await show(
      view({
        platforms: [
          {
            id: "x",
            displayName: "X",
            comparable: false,
            connectors: [connector({ postsPerUnit: null, estimatedPerComparedPosts: null })],
          },
        ],
      }),
    );

    expect(text()).toContain("not measured");
    expect(text()).toContain("nothing to compare");
  });
});

describe("what docs/costs.md requires of any figure", () => {
  it("shows four decimal places, never cents", async () => {
    // Ten Reddit records cost $0.0150, and a page rounding that to two cents
    // could not be reconciled against a provider's dashboard.
    await show(
      view({
        platforms: [
          {
            id: "reddit",
            displayName: "Reddit",
            comparable: false,
            connectors: [
              connector({
                providerId: "brightdata",
                providerName: "Bright Data",
                billableUnit: "record",
                pricePerUnit: money(1500),
                postsPerUnit: 1,
                estimatedPerComparedPosts: money(75000),
                spent: { units: 10, cost: money(15000) },
              }),
            ],
          },
        ],
      }),
    );

    expect(text()).toContain("$0.0150");
    expect(text()).not.toMatch(/\$0\.02\b/);
  });

  it("says the estimate is ours and the spend is theirs", async () => {
    await show(view());

    expect(text()).toContain("not a bill");
  });
});

describe("when the prices cannot be read", () => {
  it("says so rather than showing an empty table", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({ message: "The database is unreachable." }, 500),
    );
    screen = await mount(<Pricing />);

    expect(text()).toContain("The prices could not be loaded");
    expect(text()).toContain("The database is unreachable.");
  });
});

describe("the shape of one row", () => {
  it("names the unit beside every price, so no figure stands alone", async () => {
    await show(view());

    expect(text()).toContain("per credit");
    expect(text()).toContain("per post");
  });

  it("shows the reply price where a connector prices comments separately", async () => {
    await show(
      view({
        platforms: [
          {
            id: "instagram",
            displayName: "Instagram",
            comparable: false,
            connectors: [connector({ replyPricePerUnit: money(40590) })],
          },
        ],
      }),
    );

    expect(text()).toContain("$0.0406");
    expect(text()).toContain("per comment page");
  });
});

/** The header is on the screen before the answer arrives, and after it fails. */
describe("while it is loading", () => {
  it("names itself rather than showing a blank page", async () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}) as Promise<Response>);
    screen = await mount(<Pricing />);

    expect(text()).toContain("Provider pricing");
  });
});
