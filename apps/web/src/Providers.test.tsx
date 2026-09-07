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
import { Providers } from "./Providers.js";
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
    can: { keyword: true, channel: false, replies: false, commentLinks: null },
    returned: {
      posts: 20,
      matches: 5,
      matchRate: 25,
      medianAgeHours: 195.8,
      costPerMatch: money(16236),
      thin: true,
    },
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
        returned: {
          posts: 25,
          matches: 2,
          matchRate: 8,
          medianAgeHours: 2.8,
          costPerMatch: money(26000),
          thin: true,
        },
      }),
    ],
  };
}

function view(overrides: Record<string, unknown> = {}) {
  return {
    comparedPosts: 50,
    thinSample: 50,
    verdicts: 5,
    platforms: [linkedIn()],
    ...overrides,
  };
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
  screen = await mount(<Providers />);
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
    screen = await mount(<Providers />);

    expect(text()).toContain("This page could not be loaded");
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
    screen = await mount(<Providers />);

    expect(text()).toContain("Providers");
  });
});

describe("what each provider actually returned", () => {
  it("shows freshness, which no price on the page says", async () => {
    // The number that decided LinkedIn: 2.8 hours against 196. Hours under two
    // days, days after that, because "8 days" is the fact and "196 h" is a
    // division somebody has to do.
    await show(view());

    expect(text()).toContain("median age 3 h");
    expect(text()).toContain("median age 8 days");
  });

  it("shows how many posts became matches, with the count behind the rate", async () => {
    await show(view());

    expect(text()).toContain("25%");
    expect(text()).toContain("of 20 posts");
    expect(text()).toContain("of 25 posts");
  });

  it("marks a rate that rests on too few posts", async () => {
    // Twenty posts is two matches either way. A percentage over it should read
    // as fragile, because it is.
    await show(view());

    expect(text()).toContain("too few to lean on");
  });

  it("shows cost per match, which is value where cost per post is price", async () => {
    await show(view());

    expect(text()).toContain("$0.0162");
    expect(text()).toContain("$0.0260");
  });

  it("says nothing to judge rather than nought per cent for an unused provider", async () => {
    // 0 of 0 is not zero per cent, and printing one would read as a
    // measurement of a provider nobody has used.
    await show(
      view({
        platforms: [
          {
            id: "x",
            displayName: "X",
            comparable: false,
            connectors: [
              connector({
                returned: {
                  posts: 0,
                  matches: 0,
                  matchRate: null,
                  medianAgeHours: null,
                  costPerMatch: null,
                  thin: false,
                },
              }),
            ],
          },
        ],
      }),
    );

    expect(text()).toContain("none collected");
    expect(text()).toContain("nothing to judge yet");
  });
});

describe("what the page refuses to claim", () => {
  it("says a match is our guess and a verdict is the person's", async () => {
    await show(view());

    expect(text()).toContain("A match is our guess. A verdict is yours.");
  });

  it("names how many verdicts there are, so the caveat is concrete", async () => {
    await show(view({ verdicts: 5 }));

    expect(text()).toContain("5 so far");
  });

  it("says match rate is comparable only inside one platform", async () => {
    // Across platforms it measures the monitor and its threshold. Reddit
    // through SocialCrawl matches at 21.4% and YouTube through the same
    // provider at 2.6%, which says nothing about SocialCrawl.
    await show(view());

    expect(text()).toContain("between two providers of one platform");
  });

  it("shows no score, grade or stars anywhere", async () => {
    // The reason is in US-059: on this instance's own data a score built from
    // match rate ranks the worse LinkedIn provider three times higher.
    await show(view());

    expect(text()).not.toMatch(/\b\d(\.\d)?\s*\/\s*5\b/);
    expect(text()).not.toMatch(/★|rating|grade [A-F]\b/i);
  });
});

describe("what a connector can find at all", () => {
  it("says how it discovers, in words", async () => {
    await show(
      view({
        platforms: [
          {
            id: "reddit",
            displayName: "Reddit",
            comparable: false,
            connectors: [
              connector({
                can: { keyword: true, channel: true, replies: true, commentLinks: true },
              }),
            ],
          },
        ],
      }),
    );

    expect(text()).toContain("Finds by keywords and channels");
    expect(text()).toContain("reads and links comments");
  });

  it("separates reading a comment from being able to link to one", async () => {
    // US-047's rule: a match needs a URL that opens the comment. A connector
    // that reads comments and returns a link to the commenter's profile has
    // not met it.
    await show(
      view({
        platforms: [
          {
            id: "linkedin",
            displayName: "LinkedIn",
            comparable: false,
            connectors: [
              connector({
                can: { keyword: true, channel: false, replies: true, commentLinks: false },
              }),
            ],
          },
        ],
      }),
    );

    expect(text()).toContain("reads comments, cannot link them");
  });

  it("says links are unproven rather than guessing", async () => {
    await show(
      view({
        platforms: [
          {
            id: "instagram",
            displayName: "Instagram",
            comparable: false,
            connectors: [
              connector({
                can: { keyword: true, channel: false, replies: true, commentLinks: null },
              }),
            ],
          },
        ],
      }),
    );

    expect(text()).toContain("links unproven");
  });
});
