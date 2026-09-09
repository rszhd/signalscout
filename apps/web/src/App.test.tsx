// @vitest-environment jsdom
/**
 * Which screen the shell shows.
 *
 * These claims are about what a person lands on. Every address here is a real
 * path — US-076 moved the router out of the hash — so what a case asserts is
 * the pair: the sidebar carries the link, and the router puts that screen on
 * the page. The inbox, the monitor list and the form all live inside a
 * project, and an address naming none is sent to choose one. The nav offers
 * only screens that are built.
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import type { BillingState } from "./Billing.js";
import { json, mount, type Screen, settle } from "./testing.js";

const options = {
  signals: [{ id: "problem", label: "Describing the problem", hint: "Clear pain" }],
  sources: [{ id: "reddit", displayName: "Reddit", missingCredentials: [], ready: true }],
  canGenerateQueries: true,
};

/**
 * Where a project's screens live. US-076.
 *
 * The project is a path segment rather than a query parameter, because an
 * inbox is a question about one business — the address is *of* that business
 * and not a filter over a page that means something without it.
 */
const project = "p1";
const inbox = `/projects/${project}`;
const monitors = `${inbox}/monitors`;
const newMonitor = `${monitors}/new`;

describe("the application screens", () => {
  let screen: Screen;
  let billingMode: "off" | "stripe";
  /** Whether this account holds the two keys the setup gate asks for. */
  let setUp: boolean;
  /** Whether the two setup reads answer at all. */
  let setupReadable: boolean;
  let billingState: BillingState;

  beforeEach(() => {
    billingMode = "off";
    setUp = true;
    setupReadable = true;
    billingState = {
      mode: "stripe",
      entitled: true,
      reason: "trialing",
      status: "trialing",
      trialDaysLeft: 7,
      trialEndsAt: "2026-09-15T00:00:00.000Z",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      hasBillingAccount: false,
      trialDays: 7,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: string | URL | Request) => {
        const url = typeof request === "string" ? request : request.toString();
        // US-017 put every screen behind a session. These cases are about
        // which screen the shell shows, so the person asking is signed in.
        if (url === "/api/auth-status") {
          return json({
            firstRun: false,
            signUpOpen: false,
            signedIn: true,
            account: { name: "The owner", email: "owner@example.com" },
            billingMode,
          });
        }
        if (url === "/api/billing") return json(billingState);
        if (url === "/api/monitor-options") return json(options);
        if (url === "/api/monitors") return json([]);
        if (url.startsWith("/api/matches")) {
          return json({ matches: [], nextCursor: null, asOf: "2026-09-05T12:00:00.000Z" });
        }
        /*
          Set up, unless a case says otherwise. US-088.

          The catch-all goes through the setup screen now, and that screen asks
          these two routes whether the account holds a provider key and a model
          key. An account holding neither is offered setup instead of the
          projects list, so every case about where an address lands has to say
          which kind of account is asking.
        */
        if (!setupReadable && (url === "/api/connections" || url === "/api/models")) {
          return json({ message: "no" }, 500);
        }
        if (url === "/api/connections") {
          return json({
            canStore: true,
            storeBlocker: null,
            providers: [
              {
                id: "brightdata",
                displayName: "Bright Data",
                platforms: ["Reddit"],
                ready: setUp,
                credentials: [
                  {
                    name: "apiKey",
                    label: "API key",
                    environmentVariable: "BRIGHTDATA_API_KEY",
                    storedHint: setUp ? "••••b3e7" : null,
                    fromEnvironment: false,
                    configured: setUp,
                  },
                ],
              },
            ],
            platforms: [],
          });
        }
        if (url === "/api/models") {
          return json({
            canStore: true,
            storeBlocker: null,
            pricedModels: {},
            embeddingModels: {},
            testModels: { anthropic: "claude-sonnet-5" },
            keys: [],
            tasks: [
              {
                task: "classify",
                title: "Scoring posts",
                providers: ["anthropic"],
                instance: { provider: "anthropic", model: "claude-haiku-4-5", hasKey: setUp },
                fallback: {
                  source: "instance",
                  provider: "anthropic",
                  model: "claude-haiku-4-5",
                  hasKey: setUp,
                  keyName: null,
                  keyId: null,
                },
                provider: null,
                model: null,
                baseUrl: null,
                keyId: null,
              },
            ],
          });
        }
        if (url === "/api/reply-prompts") return json({ prompts: [] });
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
  });

  afterEach(async () => {
    await screen?.unmount();
    vi.unstubAllGlobals();
  });

  /**
   * The sidebar says which account is in use. US-069.
   *
   * It carried a hardcoded `Self-hosted` pill before, which was written when
   * there were no accounts and is false on an instance taking registrations —
   * and it sat in the one place a person looks to tell two accounts apart.
   */
  it("shows the signed-in account where the self-hosted label used to be", async () => {
    screen = await mount(<App />);

    expect(
      screen.container.querySelector<HTMLImageElement>('.brand-logo[src="/logo.png"]'),
    ).not.toBeNull();
    expect(screen.container.textContent).toContain("The owner");
    expect(screen.container.textContent).toContain("owner@example.com");
    expect(screen.container.textContent).not.toContain("Self-hosted");
  });

  it("labels a trial account, and no other account, beside the product name", async () => {
    billingMode = "stripe";
    screen = await mount(<App />);

    expect(screen.container.querySelector(".trial-badge")?.textContent).toBe("Trial");
    expect(screen.container.querySelector('.account-nav a[href="/billing"]')).not.toBeNull();

    await screen.unmount();
    billingState = {
      ...billingState,
      reason: "subscribed",
      status: "active",
      currentPeriodEnd: "2026-10-15T00:00:00.000Z",
    };
    screen = await mount(<App />);

    expect(screen.container.querySelector(".trial-badge")).toBeNull();
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
    screen = await mount(<App />, inbox);

    expect(screen.container.textContent).toContain("Intent inbox");
  });

  it("reaches the monitor form from the header", async () => {
    screen = await mount(<App />, inbox);

    expect(screen.container.querySelector(`nav a[href="${newMonitor}"]`)).not.toBeNull();

    await screen.go(newMonitor);

    expect(screen.container.textContent).toContain("What should this monitor find?");
    expect(screen.container.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.container.querySelector(".setup-page")).not.toBeNull();
    expect(screen.container.textContent).not.toContain("No monitors yet");
  });

  it("reaches the monitor list from the header, and not the form's route", async () => {
    screen = await mount(<App />, inbox);

    expect(screen.container.querySelector(`nav a[href="${monitors}"]`)).not.toBeNull();

    await screen.go(monitors);
    expect(screen.container.textContent).toContain("No monitors yet");

    expect(screen.container.querySelector('[role="dialog"]')).toBeNull();

    // Setup owns the whole page; the monitor list is not mounted underneath.
    await screen.go(newMonitor);
    expect(screen.container.textContent).toContain("What should this monitor find?");
    expect(screen.container.querySelector(".setup-page")).not.toBeNull();
  });

  it("comes back to the inbox from the header", async () => {
    screen = await mount(<App />, newMonitor);
    expect(screen.container.textContent).toContain("What should this monitor find?");

    expect(screen.container.querySelector(`nav a[href="${inbox}"]`)).not.toBeNull();

    await screen.go(inbox);

    expect(screen.container.textContent).toContain("Intent inbox");
  });

  it("keeps page setup open on Escape", async () => {
    screen = await mount(<App />, newMonitor);

    await act(async () => {
      globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await settle();

    expect(screen.path()).toBe(newMonitor);
    expect(screen.container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows the connections screen on its own route", async () => {
    screen = await mount(<App />);

    await screen.go("/connections");

    expect(screen.container.textContent).toContain("Connections");
    expect(screen.container.querySelector('.site-nav a[href="/connections"]')).toBeNull();
    expect(screen.container.querySelector('.account-nav a[href="/connections"]')).toBeNull();
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

    await screen.go("/connections");

    const projectLinks = [...screen.container.querySelectorAll(".site-nav a")].map((link) =>
      link.getAttribute("href"),
    );
    const accountLinks = [...screen.container.querySelectorAll(".account-nav a")].map((link) =>
      link.getAttribute("href"),
    );

    // Pricing joins the account section here, and for the same reason: both
    // are machine-level screens — one set of keys, one set of prices, every
    // project — so neither carries one. US-058.
    expect(projectLinks).toEqual(["/projects"]);
    expect(accountLinks).toEqual(["/providers", "/reply-voices", "/models"]);
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

    await screen.go("/projects");

    const links = [...screen.container.querySelectorAll(".site-nav a")].map((link) =>
      link.getAttribute("href"),
    );

    // A monitor is made inside a project and prefills its four answers from
    // one, so offering the form here would make an unfiled monitor — the state
    // migration 0038 emptied out.
    expect(links).toEqual(["/projects"]);
  });

  it("carries the project through every link once one is chosen", async () => {
    screen = await mount(<App />);

    await screen.go(inbox);

    const links = [...screen.container.querySelectorAll(".site-nav a")].map((link) =>
      link.getAttribute("href"),
    );

    // The inbox, the monitors and the new-monitor form all stay inside the
    // project a person is looking at.
    expect(links).toContain(inbox);
    expect(links).toContain(monitors);
    expect(links).toContain(newMonitor);
  });

  /**
   * The rule that does not depend on any link being right. US-045.
   *
   * Scoping every href keeps a person inside their project, but a bookmark, a
   * typed address or a link somebody forgot to update all arrive here too. So
   * the requirement lives in the router: no project, no inbox and no monitors.
   */
  it("sends a person to choose a project rather than answering for all of them", async () => {
    for (const address of ["/", "/monitors", "/monitors/new", "/projects//monitors"]) {
      screen = await mount(<App />, address);

      expect(screen.container.textContent).toContain("Projects");
      // Not the inbox, and not the form: neither means anything yet.
      expect(screen.container.textContent).not.toContain("Ranked by score & age");
      expect(screen.container.textContent).not.toContain("What should this monitor find?");

      // And the address is corrected, so it stops saying something untrue.
      expect(screen.path()).toBe("/projects");

      await screen.unmount();
    }
  });

  /**
   * The gate, in place of the whole application. US-088.
   *
   * Not a route: a route can be navigated away from, and the first version of
   * this was one — a new account stepped around setup in a click and met the
   * missing key later, on the monitor form, as a refusal. So the setup screen
   * replaces the application the way the login does, and no address reaches
   * past it.
   */
  it("replaces the whole application until both keys are there", async () => {
    setUp = false;

    for (const address of ["/", "/projects", inbox, "/models", "/connections"]) {
      screen = await mount(<App />, address);

      expect(screen.container.textContent).toContain("Set up SignalScout");
      expect(screen.container.textContent).toContain("Connect a data provider");
      // No sidebar, so there is no link out of it either.
      expect(screen.container.querySelectorAll("nav a").length).toBe(0);

      await screen.unmount();
    }
  });

  /**
   * A failed read opens the gate rather than closing it. US-088.
   *
   * Locking somebody out of their own inbox because one request failed is
   * worse than letting an unconfigured account through: the monitor form
   * refuses a platform with no key anyway, and every poll is refused with a
   * reason.
   */
  it("does not gate an account whose setup could not be read", async () => {
    setupReadable = false;
    screen = await mount(<App />, "/projects");

    expect(screen.container.textContent).toContain("Projects");
    expect(screen.container.textContent).not.toContain("Set up SignalScout");
  });

  it("shows the inbox once a project is chosen", async () => {
    screen = await mount(<App />, inbox);

    expect(screen.container.textContent).toContain("Intent inbox");
    expect(screen.path()).toBe(inbox);
  });

  it("does not expose mockup routes whose behaviour is not built", async () => {
    screen = await mount(<App />, inbox);

    const projectLinks = [...screen.container.querySelectorAll(".site-nav a")].map((link) =>
      link.getAttribute("href"),
    );
    const accountLinks = [...screen.container.querySelectorAll(".account-nav a")].map((link) =>
      link.getAttribute("href"),
    );
    // Connections is gone from the menu and the account screens sit together.
    // Settings is still a mockup route and must stay off the nav: a link that
    // leads nowhere is worse than no link.
    expect(projectLinks).toEqual(["/projects", inbox, monitors, newMonitor]);
    expect(accountLinks).toEqual(["/providers", "/reply-voices", "/models"]);
    expect(screen.container.textContent).not.toContain("Settings");
  });

  /**
   * The address is one address. US-076.
   *
   * The router lived in the hash until then, so Stripe's return read
   * `/billing?checkout=done#/billing` — the path was the server's answer and
   * the hash was the app's, and the two said the same thing twice.
   */
  it("puts the whole route in the path, with no hash", async () => {
    billingMode = "stripe";
    screen = await mount(<App />, "/billing?checkout=done");

    expect(screen.container.textContent).toContain("Billing");
    expect(screen.path()).toBe("/billing");

    const links = [...screen.container.querySelectorAll("a")].map((link) =>
      link.getAttribute("href"),
    );
    for (const link of links) expect(link).not.toContain("#");
  });

  /**
   * A self-hosted instance has no subscription, so the route is not
   * registered — and an address naming it lands on the projects list rather
   * than on a page that can only say the instance does not charge. US-072.
   */
  it("does not answer the billing address where the instance does not charge", async () => {
    screen = await mount(<App />, "/billing");

    expect(screen.path()).toBe("/projects");
  });

  it("opens account-level reply voices without asking for a project", async () => {
    screen = await mount(<App />);

    await screen.go("/reply-voices");

    expect(screen.path()).toBe("/reply-voices");
    expect(screen.container.textContent).toContain("Reusable writing guidance for every project.");
    expect(screen.container.textContent).toContain("Create your first reply voice");
  });
});
