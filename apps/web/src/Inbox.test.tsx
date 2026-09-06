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
    verdict: null,
    readAt: null,
    source: "reddit",
    channel: "SaaS",
    author: "someone",
    title: "How are small teams handling regression testing?",
    excerpt: "We're manually checking our major flows before every release.",
    url: "https://reddit.com/r/SaaS/comments/abc",
    postedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
    kind: "post",
    parentTitle: null,
    parentExcerpt: null,
    parentUrl: null,
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
      // Checked before the list, because a verdict's URL starts with the
      // list's. The body is what the assertions below read.
      if (url.endsWith("/verdict")) return json({ verdict: "good", changed: false });
      if (url.endsWith("/saved")) {
        return json({ matchId: "match-1", saved: true, savedAt: "2026-09-06T12:00:00.000Z" });
      }
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

  /**
   * A reply is judged against the thread above it, so the inbox has to show it.
   *
   * US-020. "We hit this too, what did you end up using?" is a strong lead or
   * noise depending entirely on the post it answers, and an inbox showing only
   * the reply would ask a person to judge it with less than the classifier had.
   */
  /**
   * Keeping a match. US-043.
   *
   * The row stays on screen either way, unlike a "not relevant" verdict. Saving
   * is somebody saying they will come back to it, and removing it when they say
   * so would be the opposite of helpful.
   */
  describe("saving a match for later", () => {
    it("offers the action, and says when it has been taken", async () => {
      await show();

      const save = [...container.querySelectorAll("button")].find((element) =>
        element.textContent?.includes("Save for later"),
      );

      expect(save).toBeDefined();
      expect(save?.getAttribute("aria-pressed")).toBe("false");
    });

    it("keeps the match on screen once it is saved", async () => {
      await show();

      const save = [...container.querySelectorAll("button")].find((element) =>
        element.textContent?.includes("Save for later"),
      ) as HTMLButtonElement;

      await act(async () => save.click());
      await settle();

      const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/saved"));

      const init = call?.[1] as RequestInit;

      expect(JSON.parse(String(init.body))).toEqual({ saved: true });
      // Still there. A verdict of "not relevant" removes a row; this must not.
      expect(container.textContent).toContain("We're manually checking our major flows");

      // And the button now says so, which only happens if the request
      // succeeded — without the route mocked above this passed on the error
      // path, which is the kind of green this repository warns about.
      const after = [...container.querySelectorAll("button")].find(
        (element) => element.textContent?.trim() === "Saved" && !element.closest(".inbox-views"),
      );

      expect(after?.getAttribute("aria-pressed")).toBe("true");
    });

    it("shows a saved match as saved", async () => {
      await show({
        "/api/matches?": {
          matches: [match({ saved: true })],
          nextCursor: null,
          asOf: firstPage.asOf,
        },
      });

      const save = [...container.querySelectorAll("button")].find(
        (element) => element.textContent?.trim() === "Saved" && !element.closest(".inbox-views"),
      );

      expect(save?.getAttribute("aria-pressed")).toBe("true");
    });

    it("asks the server for the saved list, which it orders differently", async () => {
      await show();

      const picker = container.querySelector(".inbox-views button:last-child") as HTMLButtonElement;

      await act(async () => picker.click());
      await settle();

      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("saved=true"))).toBe(true);
    });
  });

  describe("a match that is a reply", () => {
    const replyMatch = match({
      id: "match-reply",
      kind: "reply",
      title: null,
      excerpt: "We hit this too. What did you end up using?",
      parentTitle: "Our end to end tests break every release",
      parentExcerpt: "We are a four-person SaaS and the suite breaks whenever the UI changes.",
      parentUrl: "https://reddit.com/r/SaaS/comments/abc",
    });

    it("shows the post it answers, and labels both halves", async () => {
      await show({
        "/api/matches?": { matches: [replyMatch], nextCursor: null, asOf: firstPage.asOf },
      });

      expect(container.textContent).toContain("Replying to");
      expect(container.textContent).toContain("We are a four-person SaaS");
      expect(container.textContent).toContain("The reply");
      expect(container.textContent).toContain("We hit this too. What did you end up using?");
    });

    it("titles it with the thread, because a reply has no title of its own", async () => {
      await show({
        "/api/matches?": { matches: [replyMatch], nextCursor: null, asOf: firstPage.asOf },
      });

      expect(container.querySelector(".detail-title")?.textContent).toContain(
        "Our end to end tests break every release",
      );
    });

    it("shows no thread block on a post, so nothing is invented for one", async () => {
      await show();

      expect(container.textContent).toContain("We're manually checking our major flows");
      expect(container.textContent).not.toContain("Replying to");
    });

    it("promises the comment on a platform whose link reaches it", async () => {
      const tikTokReply = match({
        id: "match-tiktok",
        kind: "reply",
        source: "tiktok",
        author: "janehchuu",
        title: null,
        excerpt: "the althea one broke me out 😔 would the yumu one be better?",
        parentTitle: null,
        parentExcerpt: "my fav acne prone moisturizers!!",
        parentUrl: "https://www.tiktok.com/@janehchuu/video/7656532107921001759",
        url: "https://www.tiktok.com/@janehchuu/video/7656532107921001759?cid=NzY3OTM5NjAwMTYyMzE4MDA2NQ",
      });

      await show({
        "/api/matches?": { matches: [tikTokReply], nextCursor: null, asOf: firstPage.asOf },
      });

      expect(container.textContent).toContain("Open conversation");
      expect(container.textContent).not.toContain("no link to a single comment");
    });

    /**
     * The caveat, on a platform this build does not know.
     *
     * Every platform shipped today reaches the comment, so this branch has no
     * live subject — and it is kept tested rather than deleted because the
     * afternoon it was written was the afternoon TikTok did not. A screen that
     * silently promises a link it cannot deliver sends a person scrolling for
     * something that was never there, and the next platform added inherits the
     * safe default rather than that.
     */
    it("says so, and gives the handle to look for, when the link cannot reach the comment", async () => {
      const unknownReply = match({
        id: "match-unknown",
        kind: "reply",
        source: "threads",
        author: "someone",
        title: null,
        excerpt: "which one did you end up using?",
        parentTitle: null,
        parentExcerpt: "my favourite moisturisers",
        parentUrl: "https://example.test/post/1",
        url: "https://example.test/post/1",
      });

      await show({
        "/api/matches?": { matches: [unknownReply], nextCursor: null, asOf: firstPage.asOf },
      });

      expect(container.textContent).toContain("no link to a single comment");
      expect(container.textContent).toContain("@someone");
      expect(container.textContent).toContain("Open the post");
      expect(container.textContent).not.toContain("Open conversation");
    });

    it("keeps the ordinary wording on a post, which has no comment to reach", async () => {
      await show();

      expect(container.textContent).toContain("Open conversation");
      expect(container.textContent).not.toContain("no link to a single comment");
    });
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

  it("opens a selected match in the reading pane", async () => {
    await show({
      "/api/matches?": {
        matches: [
          match(),
          match({
            id: "match-2",
            title: "A second conversation",
            excerpt: "This is the conversation selected from the compact list.",
            url: "https://reddit.com/r/SaaS/comments/def",
          }),
        ],
        nextCursor: null,
        asOf: "2026-09-05T12:00:00.000Z",
      },
    });

    const cards = container.querySelectorAll<HTMLButtonElement>(".match-card");
    await act(async () => cards[1]?.click());

    expect(container.querySelector(".detail-title")?.textContent).toBe("A second conversation");
    expect(container.querySelector(".match-detail a.primary-button")?.getAttribute("href")).toBe(
      "https://reddit.com/r/SaaS/comments/def",
    );
  });

  it("collapses a long post body until a person asks to read more", async () => {
    const longBody = Array.from({ length: 90 }, (_, index) => `word${index + 1}`).join(" ");
    await show({
      "/api/matches?": {
        matches: [match({ excerpt: longBody })],
        nextCursor: null,
        asOf: "2026-09-05T12:00:00.000Z",
      },
    });

    const post = container.querySelector(".post-box");
    expect(post?.textContent).toContain("word80…");
    expect(post?.textContent).not.toContain("word81");

    await act(async () => button("Read more").click());
    expect(post?.textContent).toContain("word90");

    await act(async () => button("Show less").click());
    expect(post?.textContent).not.toContain("word81");
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

    expect(document.querySelector("#inbox-extra-filters")?.hasAttribute("hidden")).toBe(true);
    await act(async () => button("Filters").click());
    expect(document.querySelector("#inbox-extra-filters")?.hasAttribute("hidden")).toBe(false);
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

  describe("the two buttons on a match", () => {
    const twoMatches = {
      matches: [
        match(),
        match({
          id: "match-2",
          title: "A second conversation",
          url: "https://reddit.com/r/SaaS/comments/def",
        }),
      ],
      nextCursor: null,
      asOf: "2026-09-05T12:00:00.000Z",
    };

    /** The verdict requests the screen sent, in order. */
    function verdictCalls(): Array<{ url: string; body: unknown }> {
      return fetchMock.mock.calls
        .filter(([url]) => String(url).endsWith("/verdict"))
        .map(([url, init]) => ({
          url: String(url),
          body: JSON.parse(String((init as RequestInit).body)),
        }));
    }

    it("sends the verdict a person chose", async () => {
      await show();

      await act(async () => button("Good lead").click());
      await settle();

      expect(verdictCalls()).toEqual([
        { url: "/api/matches/match-1/verdict", body: { verdict: "good" } },
      ]);
    });

    it("shows the verdict already given as the one in force", async () => {
      await show({
        "/api/matches?": {
          matches: [match({ verdict: "good" })],
          nextCursor: null,
          asOf: "2026-09-05T12:00:00.000Z",
        },
      });

      expect(button("Good lead").getAttribute("aria-pressed")).toBe("true");
      expect(button("Not relevant").getAttribute("aria-pressed")).toBe("false");
    });

    it("takes a dismissed match out of the list and reads on", async () => {
      await show({ "/api/matches?": twoMatches });

      await act(async () => button("Not relevant").click());
      await settle();

      // The row is gone and the next one is open. A reload would have been
      // the easy way to do this, and it would move every other row: the rank
      // depends on a clock.
      expect(container.textContent).not.toContain(
        "How are small teams handling regression testing?",
      );
      expect(container.querySelector(".detail-title")?.textContent).toBe("A second conversation");
      expect(container.querySelectorAll(".match-card")).toHaveLength(1);

      const listRequests = fetchMock.mock.calls
        .map(([url]) => String(url))
        .filter((url) => url.startsWith("/api/matches?"));
      expect(listRequests).toHaveLength(1);
    });

    it("keeps the match on the screen when the verdict could not be saved", async () => {
      await show({ "/api/matches?": twoMatches });

      fetchMock.mockImplementation(async () => json({ message: "The database is down." }, 500));

      await act(async () => button("Not relevant").click());
      await settle();

      // A row that vanished from a failed request would look like a verdict
      // that was kept, and the person would never give it again.
      expect(container.querySelectorAll(".match-card")).toHaveLength(2);
      expect(container.textContent).toContain("The database is down.");
    });

    it("asks the server for the dismissed matches when the filter says so", async () => {
      await show();

      await act(async () => button("Filters").click());
      await act(async () => setValue(select("Not relevant"), "show"));
      await settle();

      const asked = fetchMock.mock.calls.map(([url]) => String(url));
      expect(asked.some((url) => url.includes("includeNotRelevant=true"))).toBe(true);
    });

    it("does not ask for them when the filter is on hidden", async () => {
      await show();

      const asked = fetchMock.mock.calls.map(([url]) => String(url));
      expect(asked.some((url) => url.includes("includeNotRelevant"))).toBe(false);
    });
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

    await act(async () => button("Filters").click());
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
