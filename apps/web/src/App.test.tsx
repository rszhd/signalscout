// @vitest-environment jsdom
/**
 * Which screen the shell shows.
 *
 * Four claims, and all are about what a person lands on. The inbox is the
 * product, so an empty hash is the inbox and not the setup form. The monitor
 * form has to be reachable from the header, because the inbox's own empty
 * state sends people to it. The monitor list must not answer to the form's
 * route, because "#/monitors" is a prefix of "#/monitors/new" and the shorter
 * test would take both. And the nav offers only screens that are built.
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { json, mount, type Screen, settle } from "./testing.js";

const options = {
  signals: [{ id: "problem", label: "Describing the problem", hint: "Clear pain" }],
  sources: [{ id: "reddit", displayName: "Reddit", missingCredentials: [], ready: true }],
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

describe("the four screens", () => {
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
        if (url === "/api/connections") {
          return json({ canStore: true, storeBlocker: null, providers: [], platforms: [] });
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
    expect(screen.container.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.container.querySelector(".setup-page")).not.toBeNull();
    expect(screen.container.textContent).not.toContain("No monitors yet");
  });

  it("reaches the monitor list from the header, and not the form's route", async () => {
    screen = await mount(<App />);

    expect(screen.container.querySelector('nav a[href="#/monitors"]')).not.toBeNull();

    await go("#/monitors");
    expect(screen.container.textContent).toContain("No monitors yet");

    expect(screen.container.querySelector('[role="dialog"]')).toBeNull();

    // Setup owns the whole page; the monitor list is not mounted underneath.
    await go("#/monitors/new");
    expect(screen.container.textContent).toContain("What should this monitor find?");
    expect(screen.container.querySelector(".setup-page")).not.toBeNull();
  });

  it("comes back to the inbox from the header", async () => {
    globalThis.location.hash = "#/monitors/new";
    screen = await mount(<App />);
    expect(screen.container.textContent).toContain("What should this monitor find?");

    expect(screen.container.querySelector('nav a[href="#/"]')).not.toBeNull();

    await go("#/");

    expect(screen.container.textContent).toContain("Intent inbox");
  });

  it("keeps page setup open on Escape", async () => {
    globalThis.location.hash = "#/monitors/new";
    screen = await mount(<App />);

    await act(async () => {
      globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await settle();

    expect(globalThis.location.hash).toBe("#/monitors/new");
    expect(screen.container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows the connections screen on its own route", async () => {
    screen = await mount(<App />);

    await go("#/connections");

    expect(screen.container.textContent).toContain("Connections");
  });

  it("does not expose mockup routes whose behaviour is not built", async () => {
    screen = await mount(<App />);

    const links = [...screen.container.querySelectorAll("nav a")].map((link) =>
      link.getAttribute("href"),
    );
    // Connections joined this list in US-023 and Projects in US-045, each when
    // the screen behind it was built. Settings is still a mockup route and must
    // stay off the nav: a link that leads nowhere is worse than no link.
    expect(links).toEqual(["#/", "#/projects", "#/monitors", "#/connections", "#/monitors/new"]);
    expect(screen.container.textContent).not.toContain("Settings");
  });
});
