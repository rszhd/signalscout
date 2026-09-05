// @vitest-environment jsdom
/**
 * The inbox, driven through the DOM a person uses.
 *
 * The ordering rule belongs to the server and is asserted there. What is
 * asserted here is what US-011 says the screen is for: that a card carries the
 * reasons and the three sub-scores, that the filters reach the request, that a
 * second page is asked for against the first page's clock, and that none of
 * the four things PLAN.md excludes has appeared.
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ageLabel, Inbox } from "./Inbox.js";
import { button, json, mount, type Screen, select, settle, setValue } from "./testing.js";

const qaMonitor = { id: "11111111-1111-4111-8111-111111111111", name: "Teams replacing manual QA" };
const hiringMonitor = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Agencies hiring for QA",
};
const monitors = [qaMonitor, hiringMonitor];

function match(overrides: Record<string, unknown> = {}) {
  return {
    id: "match-1",
    monitorId: qaMonitor.id,
    monitorName: qaMonitor.name,
    score: 94,
    rank: 93.9,
    relevance: 92,
    problemFit: 98,
    icpFit: 91,
    intent: 94,
    urgency: 70,
    intentType: "problem",
    intentLabel: "Describing the problem",
    reasons: ["Small SaaS team", "Explicit manual-testing pain", "Asking for solutions"],
    saved: false,
    readAt: null,
    source: "reddit",
    channel: "SaaS",
    author: "someone",
    title: "How are small teams handling regression testing?",
    excerpt: "We're manually checking our major flows before every release.",
    url: "https://reddit.com/r/SaaS/comments/abc",
    postedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
    ...overrides,
  };
}

const firstPage = {
  matches: [match()],
  nextCursor: null,
  asOf: "2026-09-05T12:00:00.000Z",
};

describe("the intent inbox", () => {
  let screen: Screen;
  let container: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  function answerWith(pages: Record<string, unknown>, monitorRows = monitors) {
    fetchMock.mockImplementation(async (request: string | URL | Request) => {
      const url = typeof request === "string" ? request : request.toString();
      if (url === "/api/monitors") return json(monitorRows);
      if (url.startsWith("/api/matches")) {
        const answer = Object.entries(pages).find(([key]) => url.includes(key));
        return json(answer ? answer[1] : firstPage);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
  }

  async function show(pages: Record<string, unknown> = {}, monitorRows = monitors) {
    answerWith(pages, monitorRows);
    screen = await mount(<Inbox />);
    container = screen.container;
  }

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    await screen?.unmount();
    vi.unstubAllGlobals();
  });

  it("shows the score, where it came from, the quote and the claims", async () => {
    await show();

    expect(container.textContent).toContain("94");
    expect(container.textContent).toContain("High intent");
    expect(container.textContent).toContain("Reddit · r/SaaS");
    expect(container.textContent).toContain("12 minutes ago");
    expect(container.textContent).toContain("We're manually checking our major flows");

    const reasons = [...container.querySelectorAll(".match-why li")].map((item) =>
      item.textContent?.replace("•", "").trim(),
    );
    expect(reasons).toEqual([
      "Small SaaS team",
      "Explicit manual-testing pain",
      "Asking for solutions",
    ]);
  });

  it("does not claim a negative observation is a reason it matched", async () => {
    // The classifier writes claims about the post, not support for its own
    // score, so a weak match carries lines like the second one below. A
    // heading of "Why it matched" and a green tick would both say the model
    // said something it did not.
    await show({
      "/api/matches?": {
        matches: [
          match({
            score: 31,
            reasons: [
              "The author is seeking testers for their Android app",
              "The post does not ask for a testing tool or paid service",
            ],
          }),
        ],
        nextCursor: null,
        asOf: "2026-09-05T12:00:00.000Z",
      },
    });

    expect(container.textContent).toContain("What the model saw");
    expect(container.textContent).not.toContain("Why it matched");
    expect(container.querySelector(".match-why")?.textContent).not.toContain("✓");
  });

  it("shows problem fit, ICP fit and intent", async () => {
    await show();

    const scores = [...container.querySelectorAll(".match-scores div")].map((item) =>
      item.textContent?.trim(),
    );
    expect(scores).toEqual(["Problem fit98", "ICP fit91", "Intent94"]);
  });

  it("opens the original conversation in a new tab, in one click", async () => {
    await show();

    const link = container.querySelector("a.primary-button");
    expect(link?.getAttribute("href")).toBe("https://reddit.com/r/SaaS/comments/abc");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noreferrer");
  });

  it("asks the server for one monitor when the filter names one", async () => {
    await show();

    await act(async () => setValue(select("Monitor"), hiringMonitor.id));
    await settle();

    const asked = fetchMock.mock.calls.map(([url]) => String(url));
    expect(asked.some((url) => url.includes(`monitorId=${hiringMonitor.id}`))).toBe(true);
  });

  it("asks the server for a minimum score when the filter sets one", async () => {
    await show();

    await act(async () => setValue(select("Minimum score"), "70"));
    await settle();

    const asked = fetchMock.mock.calls.map(([url]) => String(url));
    expect(asked.some((url) => url.includes("minScore=70"))).toBe(true);
  });

  it("does not send a minimum score when the filter is on any score", async () => {
    await show();

    const asked = fetchMock.mock.calls.map(([url]) => String(url));
    expect(asked.some((url) => url.includes("minScore"))).toBe(false);
  });

  it("asks for the next page against the clock the first page used", async () => {
    // Without the clock the second page is ranked against a later `now`, every
    // rank has moved down, and a match on the boundary is skipped. Nobody can
    // see that happen: the list simply never shows it.
    const paged = {
      matches: [match({ id: "match-1", score: 94 })],
      nextCursor: "80.5:33333333-3333-4333-8333-333333333333",
      asOf: "2026-09-05T12:00:00.000Z",
    };
    const second = {
      matches: [match({ id: "match-2", score: 80, title: "Second page post" })],
      nextCursor: null,
      asOf: "2026-09-05T12:00:00.000Z",
    };

    await show({ cursor: second, "/api/matches?": paged });

    await act(async () => button("Show more").click());
    await settle();

    const asked = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes("cursor"));
    expect(asked).toHaveLength(1);
    const [askedFor = ""] = asked;
    expect(askedFor).toContain(encodeURIComponent("2026-09-05T12:00:00.000Z"));
    expect(askedFor).toContain(encodeURIComponent("80.5:33333333-3333-4333-8333-333333333333"));
    // Appended, not replaced. A "show more" that dropped the page above it
    // would look like paging and read like losing your place.
    expect(container.textContent).toContain("How are small teams handling regression testing?");
    expect(container.textContent).toContain("Second page post");
  });

  it("offers the form when there is nothing to read and no monitor yet", async () => {
    await show({ "/api/matches?": { matches: [], nextCursor: null, asOf: "x" } }, []);

    expect(container.textContent).toContain("No monitors yet");
    expect(container.querySelector('a[href="#/monitors/new"]')).not.toBeNull();
  });

  it("offers to ask again when the monitors have simply not matched yet", async () => {
    // Nothing on this screen updates itself, and the person is waiting for the
    // worker. Offering to create another monitor here answers a question
    // nobody asked.
    await show({ "/api/matches?": { matches: [], nextCursor: null, asOf: "x" } });

    expect(container.textContent).toContain("Nothing has matched yet");
    expect(container.querySelector('a[href="#/monitors/new"]')).toBeNull();

    const before = fetchMock.mock.calls.filter(([url]) =>
      String(url).startsWith("/api/matches"),
    ).length;

    await act(async () => button("Check again").click());
    await settle();

    const after = fetchMock.mock.calls.filter(([url]) =>
      String(url).startsWith("/api/matches"),
    ).length;
    expect(after).toBe(before + 1);
  });

  it("offers to clear the filters when the filters are what is empty", async () => {
    await show({ "/api/matches?": { matches: [], nextCursor: null, asOf: "x" } });

    await act(async () => setValue(select("Minimum score"), "85"));
    await settle();

    expect(container.textContent).toContain("No matches with these filters");
    expect(container.textContent).not.toContain("Nothing has matched yet");

    await act(async () => button("Clear filters").click());
    await settle();

    expect(select("Minimum score").value).toBe("0");
    expect(container.textContent).toContain("Nothing has matched yet");
  });

  it("repeats the server's own sentence when the inbox cannot be read", async () => {
    fetchMock.mockImplementation(async (request: string | URL | Request) => {
      const url = typeof request === "string" ? request : request.toString();
      if (url === "/api/monitors") return json(monitors);
      return json({ message: "The database is not reachable." }, 500);
    });
    screen = await mount(<Inbox />);

    expect(screen.container.textContent).toContain("The database is not reachable.");
  });

  it("has no chart, sentiment score, word cloud or share of voice", async () => {
    // PLAN.md excludes all four by name, and the ticket says why the exclusion
    // is worth guarding early: a dashboard is what everyone reaches for when a
    // screen looks empty.
    await show();

    const text = (container.textContent ?? "").toLowerCase();
    for (const excluded of ["sentiment", "share of voice", "word cloud", "chart"]) {
      expect(text).not.toContain(excluded);
    }
    expect(container.querySelector("canvas")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("the age on a card", () => {
  const now = new Date("2026-09-05T12:00:00.000Z").getTime();

  function ago(minutes: number): string {
    return ageLabel(new Date(now - minutes * 60_000).toISOString(), now);
  }

  it("counts in minutes, then hours, then days", () => {
    expect(ago(0)).toBe("just now");
    expect(ago(1)).toBe("1 minute ago");
    expect(ago(12)).toBe("12 minutes ago");
    expect(ago(90)).toBe("2 hours ago");
    expect(ago(60 * 26)).toBe("1 day ago");
    expect(ago(60 * 24 * 3)).toBe("3 days ago");
  });
});
