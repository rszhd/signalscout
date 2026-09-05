// @vitest-environment jsdom
/**
 * The cost test, driven through the DOM a person uses.
 *
 * The one thing this screen must never do is spend money by itself. So the
 * first assertion is that nothing is requested until the button is pressed,
 * and the second is that reading the answer back is a `GET`.
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CostTest, type EstimateReport } from "./CostTest.js";
import { button, json, mount, type Screen, settle } from "./testing.js";

const probe = {
  source: "reddit",
  sourceName: "Reddit",
  kind: "query" as const,
  term: "flaky end to end tests",
  status: "ready" as const,
  postsFound: 7,
  unitsBilled: 8,
  capped: false,
  postsPerDay: 1,
  monthlyUnitsLow: 720,
  monthlyUnitsHigh: 720,
  monthlyCostMicrosLow: 1_080_000,
  monthlyCostMicrosHigh: 1_080_000,
  billableUnit: "record",
  overCap: false,
  samples: [
    {
      url: "https://reddit.test/r/SaaS/1",
      title: "Our tests break every release",
      author: "tired_qa",
      channel: "SaaS",
      excerpt: "Every UI change breaks three specs and nobody wants to own them.",
      postedAt: "2026-09-04T09:00:00.000Z",
    },
  ],
  error: null,
};

function report(overrides: Partial<EstimateReport> = {}): EstimateReport {
  return {
    id: "estimate-1",
    monitorId: null,
    status: "ready",
    pollIntervalSeconds: 3600,
    windowDays: 7,
    testUnits: 10,
    testCostMicros: 15_000,
    queries: [probe],
    totals: {
      postsPerDay: 1,
      monthlyUnitsLow: 720,
      monthlyUnitsHigh: 720,
      monthlyCostMicrosLow: 1_080_000,
      monthlyCostMicrosHigh: 1_080_000,
      capMicros: 10_000_000,
      overCap: false,
    },
    error: null,
    finishedAt: "2026-09-05T09:02:00.000Z",
    ...overrides,
  };
}

describe("the cost test", () => {
  let screen: Screen;
  let container: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;
  let onReport: ReturnType<typeof vi.fn<(report: EstimateReport | null) => void>>;

  const plan = {
    queries: ["flaky end to end tests"],
    subreddits: ["SaaS"],
    sources: ["reddit"],
    monthlyCapMicros: 10_000_000,
  };

  async function show(current: EstimateReport | null = null): Promise<void> {
    onReport = vi.fn<(report: EstimateReport | null) => void>();
    screen = await mount(<CostTest {...plan} report={current} onReport={onReport} />);
    container = screen.container;
  }

  beforeEach(() => {
    fetchMock = vi.fn(async () => json(report()));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    await screen.unmount();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("asks for nothing until a person presses the button", async () => {
    await show();

    // The sample is charged to the user's key. A screen that tested on a
    // keystroke would spend their money while they typed.
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => button("Test this plan").click());
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("/api/monitors/estimates");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      queries: ["flaky end to end tests"],
      subreddits: ["SaaS"],
      sources: ["reddit"],
      monthlyCapMicros: 10_000_000,
    });
    expect(onReport).toHaveBeenCalledWith(report());
  });

  it("shows what each query finds, what it would cost, and what the test cost", async () => {
    await show(report());

    expect(container.textContent).toContain("flaky end to end tests");
    expect(container.textContent).toContain("1 a day");
    // 720 records a month at $1.50 a thousand.
    expect(container.textContent).toContain("$1.08 a month");
    expect(container.textContent).toContain("720 records");
    // One figure, not a range: the source had nothing more to give.
    expect(container.textContent).not.toContain(" to $");
    // What the answer itself cost, which the ticket is explicit about.
    expect(container.textContent).toContain("$0.015");
    // The assumption the projection rests on.
    expect(container.textContent).toContain("every hour");
  });

  it("shows a free source as volume with no price at all", async () => {
    await show(
      report({
        queries: [{ ...probe, monthlyCostMicrosLow: null, monthlyCostMicrosHigh: null }],
        totals: {
          postsPerDay: 1,
          monthlyUnitsLow: 720,
          monthlyUnitsHigh: 720,
          monthlyCostMicrosLow: null,
          monthlyCostMicrosHigh: null,
          capMicros: null,
          overCap: false,
        },
      }),
    );

    expect(container.textContent).toContain("no charge");
    expect(container.textContent).not.toContain("$0.00 a month");
  });

  it("names the query that is over the budget, not only the plan", async () => {
    await show(
      report({
        queries: [
          {
            ...probe,
            capped: true,
            monthlyUnitsLow: 7_200,
            monthlyUnitsHigh: 36_000,
            monthlyCostMicrosLow: 10_800_000,
            monthlyCostMicrosHigh: 54_000_000,
            overCap: true,
          },
        ],
        totals: {
          postsPerDay: 120,
          monthlyUnitsLow: 7_200,
          monthlyUnitsHigh: 36_000,
          monthlyCostMicrosLow: 10_800_000,
          monthlyCostMicrosHigh: 54_000_000,
          capMicros: 10_000_000,
          overCap: true,
        },
      }),
    );

    expect(container.querySelector("tr.over-cap")).not.toBeNull();
    expect(container.textContent).toContain("over your budget");
    expect(container.textContent).toContain("spend its budget before the month ends");
  });

  it("clears the flag when the budget is raised, without buying another sample", async () => {
    // Raising the budget is a subtraction. A screen that made a person pay for
    // a second test to see it would be charging them for arithmetic.
    const expensive = report({
      queries: [
        {
          ...probe,
          monthlyCostMicrosLow: 54_000_000,
          monthlyCostMicrosHigh: 54_000_000,
          overCap: true,
        },
      ],
      totals: {
        postsPerDay: 120,
        monthlyUnitsLow: 36_000,
        monthlyUnitsHigh: 36_000,
        monthlyCostMicrosLow: 54_000_000,
        monthlyCostMicrosHigh: 54_000_000,
        capMicros: 10_000_000,
        overCap: true,
      },
    });

    onReport = vi.fn<(report: EstimateReport | null) => void>();
    screen = await mount(
      <CostTest {...plan} monthlyCapMicros={100_000_000} report={expensive} onReport={onReport} />,
    );
    container = screen.container;

    // The run says it is over its cap. The box says otherwise, and the box is
    // what the monitor will be created with.
    expect(container.querySelector("tr.over-cap")).toBeNull();
    expect(container.textContent).not.toContain("spend its budget before the month ends");
    expect(container.textContent).toContain("$100.00");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a refused query as a reason rather than as nothing found", async () => {
    // A failed probe that read as "none a day, no charge" would be the
    // cheapest line on the screen and the least true.
    await show(
      report({
        queries: [
          {
            ...probe,
            status: "failed",
            postsFound: 0,
            postsPerDay: 0,
            monthlyCostMicrosLow: null,
            monthlyCostMicrosHigh: null,
            error: "Bright Data refused the query (keyword: not allowed).",
          },
        ],
      }),
    );

    expect(container.textContent).toContain("Bright Data refused the query");
    expect(container.textContent).not.toContain("none a day");
  });

  it("says a sample was stopped, so the rate reads as a floor and the cost as a range", async () => {
    await show(
      report({
        queries: [
          {
            ...probe,
            capped: true,
            postsFound: 10,
            unitsBilled: 10,
            postsPerDay: 60,
            monthlyUnitsLow: 7_200,
            monthlyUnitsHigh: 36_000,
            monthlyCostMicrosLow: 10_800_000,
            monthlyCostMicrosHigh: 54_000_000,
          },
        ],
      }),
    );

    expect(container.textContent).toContain("at least");
    expect(container.textContent).toContain("60 a day");
    // One sample of ten cannot say where between the two the truth lies, so
    // the screen does not pretend to.
    expect(container.textContent).toContain("$10.80 to $54.00 a month");
  });

  it("never shows a query as free when the source charged for it", async () => {
    /**
     * The live run of 2026-09-05, and the reason this file changed. "flaky end
     * to end tests" was billed ten records and returned no posts, because
     * everything Bright Data found was three weeks old. The screen used to
     * read "none a day, $0.00 a month", which is the cheapest line on the page
     * and the least true: that query would cost $10.80 a month for nothing.
     */
    await show(
      report({
        queries: [
          {
            ...probe,
            postsFound: 0,
            postsPerDay: 0,
            unitsBilled: 10,
            monthlyUnitsLow: 7_200,
            monthlyUnitsHigh: 7_200,
            monthlyCostMicrosLow: 10_800_000,
            monthlyCostMicrosHigh: 10_800_000,
          },
        ],
      }),
    );

    expect(container.textContent).toContain("$10.80 a month");
    expect(container.textContent).not.toContain("$0.00 a month");
    // And it says why a query that found nothing is on the bill at all.
    expect(container.textContent).toContain("were charged for anyway");
  });

  it("keeps reading until the samples are collected, and reads with GET", async () => {
    const collecting = report({ status: "collecting", finishedAt: null });

    // Fake timers before the screen exists: the wait is scheduled by the
    // first render, and a timer scheduled on the real clock cannot be
    // advanced. `shouldAdvanceTime` keeps the harness's own microtask waits
    // working.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await show(collecting);

    expect(container.textContent).toContain("Collecting samples");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];

    expect(url).toBe("/api/monitors/estimates/estimate-1");
    // A refresh must not be able to spend anything.
    expect(init?.method ?? "GET").toBe("GET");
    expect(onReport).toHaveBeenCalledWith(report());
  });
});
