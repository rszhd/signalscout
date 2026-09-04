// @vitest-environment jsdom
/**
 * The monitor form, driven through the DOM a person uses.
 *
 * The options and generated plan are responses from our own API, so these are
 * small local stubs. They assert the UI-to-API seam: which answers are sent to
 * generation, and whether the plan a person edited is the plan finally stored.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function input(label: string): HTMLInputElement | HTMLTextAreaElement {
  const element = document.querySelector(`[aria-label="${label}"]`);
  if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
    throw new Error(`No input has the label "${label}".`);
  }
  return element;
}

function button(label: string): HTMLButtonElement {
  const element = [...document.querySelectorAll("button")].find((candidate) => {
    return (
      candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label
    );
  });
  if (!(element instanceof HTMLButtonElement)) throw new Error(`No button says "${label}".`);
  return element;
}

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("This DOM cannot set an input value.");
  setter.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("the monitor form", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    fetchMock = vi.fn(async (request: string | URL | Request) => {
      const url = typeof request === "string" ? request : request.toString();
      if (url === "/api/monitor-options") return json(options);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<App />));
    await settle();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
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
