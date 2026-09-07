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

  /**
   * The default screen changed in US-045, and this case is where that is
   * recorded. PLAN.md is firm that the product is the inbox — but an inbox is
   * a question about one business, and with no project named there is no
   * honest answer to it.
   */
  it("opens on the projects list, because an inbox needs a project", async () => {
    screen = await mount(<App />);

    expect(screen.container.textContent).toContain("Projects");
    expect(screen.container.textContent).not.toContain("What should this monitor find?");
  });

  it("opens on the inbox once a project is named", async () => {
    globalThis.location.hash = "#/?project=p1";
    screen = await mount(<App />);

    expect(screen.container.textContent).toContain("Intent inbox");
  });

  it("reaches the monitor form from the header", async () => {
    globalThis.location.hash = "#/?project=p1";
    screen = await mount(<App />);

    expect(
      screen.container.querySelector('nav a[href="#/monitors/new?project=p1"]'),
    ).not.toBeNull();

    await go("#/monitors/new?project=p1");

    expect(screen.container.textContent).toContain("What should this monitor find?");
    expect(screen.container.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.container.querySelector(".setup-page")).not.toBeNull();
    expect(screen.container.textContent).not.toContain("No monitors yet");
  });

  it("reaches the monitor list from the header, and not the form's route", async () => {
    globalThis.location.hash = "#/?project=p1";
    screen = await mount(<App />);

    expect(screen.container.querySelector('nav a[href="#/monitors?project=p1"]')).not.toBeNull();

    await go("#/monitors?project=p1");
    expect(screen.container.textContent).toContain("No monitors yet");

    expect(screen.container.querySelector('[role="dialog"]')).toBeNull();

    // Setup owns the whole page; the monitor list is not mounted underneath.
    await go("#/monitors/new?project=p1");
    expect(screen.container.textContent).toContain("What should this monitor find?");
    expect(screen.container.querySelector(".setup-page")).not.toBeNull();
  });

  it("comes back to the inbox from the header", async () => {
    globalThis.location.hash = "#/monitors/new?project=p1";
    screen = await mount(<App />);
    expect(screen.container.textContent).toContain("What should this monitor find?");

    expect(screen.container.querySelector('nav a[href="#/?project=p1"]')).not.toBeNull();

    await go("#/?project=p1");

    expect(screen.container.textContent).toContain("Intent inbox");
  });

  it("keeps page setup open on Escape", async () => {
    globalThis.location.hash = "#/monitors/new?project=p1";
    screen = await mount(<App />);

    await act(async () => {
      globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await settle();

    expect(globalThis.location.hash).toBe("#/monitors/new?project=p1");
    expect(screen.container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows the connections screen on its own route", async () => {
    screen = await mount(<App />);

    await go("#/connections");

    expect(screen.container.textContent).toContain("Connections");
  });

  /**
   * Connections is machine-level: one key serves every project. US-045.
   *
   * So it carries no project, and the project-scoped links are hidden there
   * for the same reason they are hidden on the projects page — an inbox link
   * with no project answers for all of them.
   */
  it("hides the project-scoped links on connections", async () => {
    screen = await mount(<App />);

    await go("#/connections");

    const links = [...screen.container.querySelectorAll("nav a")].map((link) =>
      link.getAttribute("href"),
    );

    // Pricing joins Connections here, and for the same reason: both are
    // machine-level screens — one set of keys, one set of prices, every
    // project — so neither carries one. US-058.
    expect(links).toEqual(["#/projects", "#/connections", "#/providers"]);
  });

  /**
   * The inbox and the monitor list are questions about one business. US-045.
   *
   * On the projects page no project is chosen, so both are hidden rather than
   * shown pointing at everything — a link that silently means "every business
   * at once" is the thing grouping exists to remove.
   */
  it("hides the inbox, the monitors and new-monitor while no project is chosen", async () => {
    screen = await mount(<App />);

    await go("#/projects");

    const links = [...screen.container.querySelectorAll("nav a")].map((link) =>
      link.getAttribute("href"),
    );

    // A monitor is made inside a project and prefills its four answers from
    // one, so offering the form here would make an unfiled monitor — the state
    // migration 0038 emptied out.
    expect(links).toEqual(["#/projects", "#/connections", "#/providers"]);
  });

  it("carries the project through every link once one is chosen", async () => {
    screen = await mount(<App />);

    await go("#/?project=p1");

    const links = [...screen.container.querySelectorAll("nav a")].map((link) =>
      link.getAttribute("href"),
    );

    // The inbox, the monitors and the new-monitor form all stay inside the
    // project a person is looking at.
    expect(links).toContain("#/?project=p1");
    expect(links).toContain("#/monitors?project=p1");
    expect(links).toContain("#/monitors/new?project=p1");
  });

  /**
   * The rule that does not depend on any link being right. US-045.
   *
   * Scoping every href keeps a person inside their project, but a bookmark, a
   * typed address or a link somebody forgot to update all arrive here too. So
   * the requirement lives in the router: no project, no inbox and no monitors.
   */
  it("sends a person to choose a project rather than answering for all of them", async () => {
    for (const hash of ["#/", "#/monitors", "#/monitors/new"]) {
      globalThis.location.hash = hash;
      screen = await mount(<App />);

      expect(screen.container.textContent).toContain("Projects");
      // Not the inbox, and not the form: neither means anything yet.
      expect(screen.container.textContent).not.toContain("Ranked by score & age");
      expect(screen.container.textContent).not.toContain("What should this monitor find?");

      // And the address is corrected, so it stops saying something untrue.
      expect(globalThis.location.hash).toBe("#/projects");

      await screen.unmount();
    }
  });

  it("shows the inbox once a project is chosen", async () => {
    globalThis.location.hash = "#/?project=p1";
    screen = await mount(<App />);

    expect(screen.container.textContent).toContain("Intent inbox");
    expect(globalThis.location.hash).toBe("#/?project=p1");
  });

  it("does not expose mockup routes whose behaviour is not built", async () => {
    globalThis.location.hash = "#/?project=p1";
    screen = await mount(<App />);

    const links = [...screen.container.querySelectorAll("nav a")].map((link) =>
      link.getAttribute("href"),
    );
    // Connections joined this list in US-023 and Projects in US-045, each when
    // the screen behind it was built. Settings is still a mockup route and must
    // stay off the nav: a link that leads nowhere is worse than no link.
    expect(links).toEqual([
      "#/projects",
      "#/?project=p1",
      "#/monitors?project=p1",
      "#/connections",
      "#/providers",
      "#/monitors/new?project=p1",
    ]);
    expect(screen.container.textContent).not.toContain("Settings");
  });
});
