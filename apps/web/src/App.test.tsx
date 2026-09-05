// @vitest-environment jsdom
/**
 * Which screen the shell shows.
 *
 * Three claims, and all are about what a person lands on. The inbox is the
 * product, so an empty hash is the inbox and not the setup form. The monitor
 * form has to be reachable from the header, because the inbox's own empty
 * state sends people to it. And the monitor list must not answer to the form's
 * route, because "#/monitors" is a prefix of "#/monitors/new" and the shorter
 * test would take both.
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { json, mount, type Screen, settle } from "./testing.js";

const options = {
  signals: [{ id: "problem", label: "Describing the problem", hint: "Clear pain" }],
  sources: [
    {
      id: "reddit",
      displayName: "Reddit",
      billableUnit: "record",
      pricePerUnitMicros: 0,
      credentials: [],
      ready: true,
    },
  ],
  canGenerateQueries: true,
};

/**
 * Change the route the way the browser does after a click.
 *
 * The click itself is not driven here. jsdom does not follow a fragment link
 * reliably — it leaves the location untouched and fires nothing — so a test
 * built on it would prove the browser rather than the app. What each case
 * asserts instead is the pair: the header carries the link, and the shell
 * follows the hash. The gap left is whether a real browser turns that link
 * into that hash, which no jsdom test can say.
 */
async function go(hash: string): Promise<void> {
  await act(async () => {
    globalThis.location.hash = hash;
  });
  await settle();
}

describe("the three screens", () => {
  let screen: Screen;

  beforeEach(() => {
    globalThis.location.hash = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: string | URL | Request) => {
        const url = typeof request === "string" ? request : request.toString();
        if (url === "/api/monitor-options") return json(options);
        if (url === "/api/monitors") return json([]);
        if (url.startsWith("/api/matches")) {
          return json({ matches: [], nextCursor: null, asOf: "2026-09-05T12:00:00.000Z" });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
  });

  afterEach(async () => {
    await screen?.unmount();
    vi.unstubAllGlobals();
    globalThis.location.hash = "";
  });

  it("opens on the inbox", async () => {
    screen = await mount(<App />);

    expect(screen.container.textContent).toContain("Intent inbox");
    expect(screen.container.textContent).not.toContain("What should this monitor find?");
  });

  it("reaches the monitor form from the header", async () => {
    screen = await mount(<App />);

    expect(screen.container.querySelector('nav a[href="#/monitors/new"]')).not.toBeNull();

    await go("#/monitors/new");

    expect(screen.container.textContent).toContain("What should this monitor find?");
  });

  it("reaches the monitor list from the header, and not the form's route", async () => {
    screen = await mount(<App />);

    expect(screen.container.querySelector('nav a[href="#/monitors"]')).not.toBeNull();

    await go("#/monitors");
    expect(screen.container.textContent).toContain("No monitors yet");

    // The prefix. A shell that tested the shorter route first would put the
    // list on the screen when a person asked for the form.
    await go("#/monitors/new");
    expect(screen.container.textContent).toContain("What should this monitor find?");
  });

  it("comes back to the inbox from the header", async () => {
    globalThis.location.hash = "#/monitors/new";
    screen = await mount(<App />);
    expect(screen.container.textContent).toContain("What should this monitor find?");

    expect(screen.container.querySelector('nav a[href="#/"]')).not.toBeNull();

    await go("#/");

    expect(screen.container.textContent).toContain("Intent inbox");
  });

  it("does not expose mockup routes whose behaviour is not built", async () => {
    screen = await mount(<App />);

    const links = [...screen.container.querySelectorAll("nav a")].map((link) =>
      link.getAttribute("href"),
    );
    expect(links).toEqual(["#/", "#/monitors", "#/monitors/new"]);
    expect(screen.container.textContent).not.toContain("Connections");
    expect(screen.container.textContent).not.toContain("Settings");
  });
});
