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
  sources: [
    {
      id: "reddit",
      displayName: "Reddit",
      billableUnit: "record",
      pricePerUnitMicros: 0,
      credentials: [
        {
          name: "apiKey",
          label: "Bright Data API key",
          environmentVariable: "REDDIT_API_KEY",
          configured: true,
        },
      ],
      ready: true,
    },
  ],
  canGenerateQueries: true,
};

const generated = {
  queries: [
    "playwright tests break every release",
    "manual qa before every release",
    "flaky end to end tests",
  ],
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

    expect(input("Search query 1").value).toBe("playwright tests break every release");
    await act(async () => {
      setValue(input("Search query 1"), "browser tests break after every release");
      button("Remove query 2").click();
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
      queries: ["browser tests break after every release", "flaky end to end tests"],
      subreddits: ["SaaS", "webdev"],
      sources: ["reddit"],
    });
    expect(container.textContent).toContain("Journeys is running");
  });
});
