// @vitest-environment jsdom
/**
 * The monitor form, driven through the DOM a person uses.
 *
 * The options and generated plan are responses from our own API, so these are
 * small local stubs. They assert the UI-to-API seam: which answers are sent to
 * generation, and whether the plan a person edited is the plan finally stored.
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MonitorForm } from "./MonitorForm.js";
import { button, field as input, json, mount, type Screen, settle, setValue } from "./testing.js";

const options = {
  signals: [
    {
      id: "recommendation_request",
      label: "Asking for recommendations",
      hint: "What are other teams using?",
    },
    {
      id: "alternative_search",
      label: "Looking for alternatives",
      hint: "Is there something easier than this?",
    },
    {
      id: "competitor_complaint",
      label: "Complaining about their current solution",
      hint: "Frustration with a tool they already pay for",
    },
    {
      id: "problem",
      label: "Describing the problem",
      hint: "Clear pain, even without asking for a product",
    },
    { id: "comparison", label: "Comparing products", hint: "Weighing two or more options" },
    { id: "purchase", label: "Ready to buy", hint: "Asking about price or trials" },
    { id: "hiring", label: "Looking to hire someone", hint: "Paying a person to solve it" },
  ],
  // One row per platform, never per connector. US-026: the form names
  // networks, and which account fetches them is the connections screen's
  // question.
  sources: [
    {
      id: "reddit",
      displayName: "Reddit",
      // US-027: the form asks for one list per platform and shows each
      // platform's own limit, so the options carry it.
      search: { maxQueryWords: 8, note: "A Reddit post has a title and paragraphs." },
      missingCredentials: [],
      ready: true,
      // US-020: whether the connector that runs here reads replies.
      canFetchReplies: true,
    },
  ],
  canGenerateQueries: true,
};

const generated = {
  queries: {
    reddit: [
      "playwright tests break every release",
      "manual qa before every release",
      "flaky end to end tests",
    ],
  },
  subreddits: ["SaaS", "webdev"],
  model: "claude-haiku-4-5",
  estimatedCostMicros: 850,
};

describe("the monitor form", () => {
  let screen: Screen;
  let container: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fetchMock = vi.fn(async (request: string | URL | Request) => {
      const url = typeof request === "string" ? request : request.toString();
      if (url === "/api/monitor-options") return json(options);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    screen = await mount(<MonitorForm />);
    container = screen.container;
  });

  afterEach(async () => {
    await screen.unmount();
    vi.unstubAllGlobals();
  });

  it("collects the three written answers and all seven server-defined signals", () => {
    expect(input("What do you sell?").required).toBe(true);
    expect(input("Who is most likely to buy it?").required).toBe(true);
    expect(input("What problem does it solve?").required).toBe(true);

    const checkboxes = [...document.querySelectorAll('input[name="signals"]')];
    expect(checkboxes).toHaveLength(7);
    expect(container.textContent).toContain("Asking for recommendations");
    expect(container.textContent).toContain("Looking to hire someone");
  });

  it("stores the answers with the queries a person edited and kept", async () => {
    fetchMock.mockImplementation(async (request: string | URL | Request, init?: RequestInit) => {
      const url = typeof request === "string" ? request : request.toString();
      if (url === "/api/monitor-options") return json(options);
      if (url === "/api/monitors/queries") return json(generated);
      if (url === "/api/monitors") {
        return json(
          {
            id: "monitor-1",
            name: "Journeys",
            paused: false,
            missingCredentials: [],
          },
          201,
        );
      }
      throw new Error(`Unexpected request: ${url} ${init?.method ?? "GET"}`);
    });

    await act(async () => {
      setValue(input("Monitor name"), "Journeys");
      setValue(
        input("What do you sell?"),
        "A test runner that records browser flows instead of coding them",
      );
      setValue(input("Who is most likely to buy it?"), "Small SaaS teams without a QA engineer");
      setValue(
        input("What problem does it solve?"),
        "Their end-to-end tests break after UI changes",
      );
    });

    await act(async () => button("Generate search plan").click());
    await settle();

    expect(input("Reddit search query 1").value).toBe("playwright tests break every release");
    await act(async () => {
      setValue(input("Reddit search query 1"), "browser tests break after every release");
      button("Remove Reddit query 2").click();
    });
    await act(async () => button("Start monitor").click());
    await settle();

    const generationCall = fetchMock.mock.calls.find(([url]) => url === "/api/monitors/queries");
    expect(JSON.parse(generationCall?.[1]?.body as string)).toMatchObject({
      product: "A test runner that records browser flows instead of coding them",
      idealCustomer: "Small SaaS teams without a QA engineer",
      problem: "Their end-to-end tests break after UI changes",
    });

    const createCall = fetchMock.mock.calls.find(([url]) => url === "/api/monitors");
    expect(JSON.parse(createCall?.[1]?.body as string)).toMatchObject({
      name: "Journeys",
      product: "A test runner that records browser flows instead of coding them",
      queries: { reddit: ["browser tests break after every release", "flaky end to end tests"] },
      subreddits: ["SaaS", "webdev"],
      sources: ["reddit"],
    });
    expect(container.textContent).toContain("Journeys is running");
  });

  /**
   * US-020. The opt-in, and the sentence that stops it being a silent nothing.
   *
   * A monitor may ask for replies on a platform whose connector cannot read
   * them — the poll still runs and still returns posts — so the form has to say
   * which platforms will answer. Being given none without being told is the
   * failure this control exists to avoid.
   */
  describe("reading the replies as well as the posts", () => {
    function replyCheckbox(): HTMLInputElement {
      const label = [...container.querySelectorAll("label")].find((element) =>
        element.textContent?.includes("Include replies and comments"),
      );
      return label?.querySelector("input") as HTMLInputElement;
    }

    it("is off until it is asked for, because it multiplies what the model reads", () => {
      expect(replyCheckbox().checked).toBe(false);
      expect(container.textContent).toContain("multiply the model calls");
    });

    it("sends the answer with the monitor", async () => {
      fetchMock.mockImplementation(async (request: string | URL | Request) => {
        const url = typeof request === "string" ? request : request.toString();
        if (url === "/api/monitor-options") return json(options);
        if (url === "/api/monitors/queries") return json(generated);
        if (url === "/api/monitors") {
          return json({ id: "m", name: "Journeys", paused: false, missingCredentials: [] }, 201);
        }
        throw new Error(`Unexpected request: ${url}`);
      });

      await act(async () => {
        setValue(input("Monitor name"), "Journeys");
        setValue(input("What do you sell?"), "A test runner");
        setValue(input("Who is most likely to buy it?"), "Small SaaS teams");
        setValue(input("What problem does it solve?"), "Tests break after UI changes");
      });

      // Ticked before the plan is generated: the control sits with the
      // "where should it look" question, which is answered on this stage.
      await act(async () => replyCheckbox().click());

      await act(async () => button("Generate search plan").click());
      await settle();
      await act(async () => button("Start monitor").click());
      await settle();

      const call = fetchMock.mock.calls.find(([url]) => url === "/api/monitors");
      expect(JSON.parse(call?.[1]?.body as string)).toMatchObject({ includeReplies: true });
    });

    it("says nothing about platforms that will answer", async () => {
      await act(async () => replyCheckbox().click());

      expect(container.textContent).not.toContain("will not return replies");
    });

    /**
     * The case the control exists for. A build may ship two connectors for one
     * platform where only one reads replies, so an instance holding the other
     * one's key must be told rather than given nothing.
     */
    it("warns when a ticked platform's own connector cannot read replies", async () => {
      await screen.unmount();

      fetchMock.mockImplementation(async (request: string | URL | Request) => {
        const url = typeof request === "string" ? request : request.toString();
        if (url === "/api/monitor-options") {
          return json({
            ...options,
            sources: [{ ...options.sources[0], canFetchReplies: false }],
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      });

      screen = await mount(<MonitorForm />);
      container = screen.container;

      await act(async () => {
        const label = [...container.querySelectorAll("label")].find((element) =>
          element.textContent?.includes("Include replies and comments"),
        );
        const box = label?.querySelector("input");
        (box as HTMLInputElement).click();
      });

      expect(container.textContent).toContain("Reddit will not return replies");
      expect(container.textContent).toContain("The posts still arrive");
    });
  });

  it("keeps a plan the cost test says would break the budget, without starting it", async () => {
    // US-014. The money is spent at fetch time, so the only place to stop a
    // plan that is too broad is before it starts.
    const overCap = {
      id: "estimate-1",
      monitorId: null,
      status: "ready",
      pollIntervalSeconds: 3600,
      // BUG-005. The response carries the days it priced, so the sentence under
      // the table can say what was assumed rather than implying every day.
      pollDays: [0, 1, 2, 3, 4, 5, 6],
      windowDays: 7,
      testUnits: 30,
      testCostMicros: 45_000,
      queries: [
        ...generated.queries.reddit.map((term) => ({
          source: "reddit",
          sourceName: "Reddit",
          kind: "query",
          term,
          status: "ready",
          postsFound: 10,
          unitsBilled: 10,
          capped: true,
          postsPerDay: 120,
          monthlyUnitsLow: 7_200,
          monthlyUnitsHigh: 36_000,
          monthlyCostMicrosLow: 10_800_000,
          monthlyCostMicrosHigh: 54_000_000,
          billableUnit: "record",
          overCap: true,
          samples: [],
          error: null,
        })),
        ...generated.subreddits.map((term) => ({
          source: "reddit",
          sourceName: "Reddit",
          kind: "channel",
          term,
          status: "ready",
          postsFound: 2,
          unitsBilled: 2,
          capped: false,
          postsPerDay: 0.3,
          monthlyUnitsLow: 720,
          monthlyUnitsHigh: 720,
          monthlyCostMicrosLow: 1_080_000,
          monthlyCostMicrosHigh: 1_080_000,
          billableUnit: "record",
          overCap: false,
          samples: [],
          error: null,
        })),
      ],
      totals: {
        postsPerDay: 360,
        monthlyUnitsLow: 22_320,
        monthlyUnitsHigh: 109_440,
        monthlyCostMicrosLow: 33_480_000,
        monthlyCostMicrosHigh: 164_160_000,
        capMicros: 10_000_000,
        overCap: true,
      },
      error: null,
      finishedAt: "2026-09-05T09:02:00.000Z",
    };

    fetchMock.mockImplementation(async (request: string | URL | Request) => {
      const url = typeof request === "string" ? request : request.toString();
      if (url === "/api/monitor-options") return json(options);
      if (url === "/api/monitors/queries") return json(generated);
      if (url === "/api/monitors/estimates") return json(overCap, 202);
      if (url === "/api/monitors") {
        return json(
          { id: "monitor-1", name: "Journeys", paused: true, missingCredentials: [] },
          201,
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await act(async () => {
      setValue(input("Monitor name"), "Journeys");
      setValue(input("What do you sell?"), "A test runner that records browser flows");
      setValue(input("Who is most likely to buy it?"), "Small SaaS teams without a QA engineer");
      setValue(input("What problem does it solve?"), "Their tests break after UI changes");
    });

    await act(async () => button("Generate search plan").click());
    await settle();

    await act(async () => setValue(input("Monthly budget"), "10"));
    await act(async () => button("Test this plan").click());
    await settle();

    // The plan is measured against the cap the person just typed.
    const testCall = fetchMock.mock.calls.find(([url]) => url === "/api/monitors/estimates");
    expect(JSON.parse(testCall?.[1]?.body as string)).toMatchObject({
      monthlyCapMicros: 10_000_000,
      // The cost test prices each platform's own list, so the body carries the
      // same keyed shape the monitor is created with. US-027.
      queries: { reddit: generated.queries.reddit },
    });

    expect(container.textContent).toContain("spend its budget before the month ends");

    await act(async () => button("Save without starting").click());
    await settle();

    const createCall = fetchMock.mock.calls.find(([url]) => url === "/api/monitors");
    expect(JSON.parse(createCall?.[1]?.body as string)).toMatchObject({
      name: "Journeys",
      startPaused: true,
      budget: { monthlyCapMicros: 10_000_000, onExhausted: "pause" },
    });
  });

  it("starts a monitor whose plan was never tested", async () => {
    // The test costs money, so it is offered and never required.
    fetchMock.mockImplementation(async (request: string | URL | Request) => {
      const url = typeof request === "string" ? request : request.toString();
      if (url === "/api/monitor-options") return json(options);
      if (url === "/api/monitors/queries") return json(generated);
      if (url === "/api/monitors") {
        return json(
          { id: "monitor-1", name: "Journeys", paused: false, missingCredentials: [] },
          201,
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await act(async () => {
      setValue(input("Monitor name"), "Journeys");
      setValue(input("What do you sell?"), "A test runner that records browser flows");
      setValue(input("Who is most likely to buy it?"), "Small SaaS teams without a QA engineer");
      setValue(input("What problem does it solve?"), "Their tests break after UI changes");
    });

    await act(async () => button("Generate search plan").click());
    await settle();

    await act(async () => button("Start monitor").click());
    await settle();

    const createCall = fetchMock.mock.calls.find(([url]) => url === "/api/monitors");
    const payload = JSON.parse(createCall?.[1]?.body as string);

    expect(payload.startPaused).toBeUndefined();
    expect(payload.budget).toBeUndefined();
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/monitors/estimates")).toBe(false);
  });
});
