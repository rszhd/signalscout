// @vitest-environment jsdom
/**
 * The projects list, driven through the DOM a person uses. US-045.
 *
 * This screen is the list only. Making and editing a project happen on their
 * own pages (`/projects/new`, `/projects/<id>/edit`), and the list links to
 * both — so what this file owns is whether the list tells the truth: what a
 * project is, how many monitors came out of it, and where its inbox, its
 * monitor form and its editor are. The editor's own rules live in
 * `ProjectForm.test.tsx`.
 *
 * One claim here is worth keeping. A project's answers are copied into a
 * monitor, so editing a project changes what the *next* monitor starts from
 * and nothing that already exists — the sentence that says so is asserted on
 * the form page, and the edit link here is the way in.
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Projects } from "./Projects.js";
import { button, json, mount, type Screen } from "./testing.js";

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Acme QA",
    product: "A test runner for small teams",
    idealCustomer: "Small SaaS teams with no dedicated QA",
    problem: "Their end to end tests break on every UI change",
    signals: ["problem"],
    monitorCount: 2,
    ...overrides,
  };
}

describe("the projects screen", () => {
  let screen: Screen;
  let container: HTMLDivElement;

  async function show(projects: unknown[] = [], nextBlocker: string | null = null) {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith("/api/projects")) {
        return json({ projects, nextBlocker });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    screen = await mount(<Projects />);
    container = screen.container;
  }

  beforeEach(() => {
    vi.unstubAllGlobals();
    // jsdom does not implement the native dialog top layer.
    for (const method of ["showModal", "close"] as const) {
      Object.defineProperty(HTMLDialogElement.prototype, method, {
        configurable: true,
        value: function (this: HTMLDialogElement) {
          this.open = method === "showModal";
        },
      });
    }
  });

  afterEach(async () => {
    await screen?.unmount();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  });

  it("says there are none yet, and offers the create page", async () => {
    await show([]);

    expect(container.textContent).toContain("No projects yet");
    expect(container.textContent).toContain("starts with its answers filled in");
    expect(container.querySelector('a[href="/projects/new"]')).not.toBeNull();
  });

  it("offers the editor from the header as well as from the empty state", async () => {
    await show([]);

    const headerLink = container.querySelector(
      ".projects-topbar a[href='/projects/new'].primary-button",
    );
    expect(headerLink?.textContent?.trim()).toBe("New project");
  });

  /**
   * US-133. On the instance's keys the plan carries a project count, and the
   * list answers the refusal beside the projects. The button shows it when
   * pressed instead of opening a form whose save would be refused.
   */
  it("shows the plan's refusal when the button is pressed, instead of opening the editor", async () => {
    const sentence = "Your plan includes 1 project, and this account already has 1.";
    await show([project()], sentence);

    expect(container.querySelector('a[href="/projects/new"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();

    const button = container.querySelector<HTMLButtonElement>(".projects-topbar button");
    expect(button?.textContent?.trim()).toBe("New project");
    await act(async () => {
      button?.click();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(sentence);
  });

  it("lists a project with how many monitors came out of it", async () => {
    await show([
      project(),
      project({ id: "22222222-2222-4222-8222-222222222222", name: "Beta", monitorCount: 0 }),
    ]);

    expect(container.textContent).toContain("Acme QA");
    expect(container.textContent).toContain("2 monitors");
    expect(container.textContent).toContain("No monitors yet");
  });

  it("offers a project its own inbox, a monitor and an editor", async () => {
    await show([project()]);

    const links = [...container.querySelectorAll("a")].map((link) => link.getAttribute("href"));

    expect(links).toContain("/projects/11111111-1111-4111-8111-111111111111");
    expect(links).toContain("/projects/11111111-1111-4111-8111-111111111111/monitors/new");
    expect(links).toContain("/projects/11111111-1111-4111-8111-111111111111/edit");
  });

  /**
   * US-145. The dialog says how many monitors go with the project, because
   * they do — an unfiled monitor would be reachable from no screen.
   */
  it("deletes a project behind a dialog that counts its monitors", async () => {
    const calls: { url: string; method?: string }[] = [];
    let listed = [project()];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method });
      if (init?.method === "DELETE") {
        listed = [];
        return new Response(null, { status: 204 });
      }
      if (String(url).startsWith("/api/projects")) {
        return json({ projects: listed, nextBlocker: null });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    screen = await mount(<Projects />);
    container = screen.container;

    await act(async () => {
      button("Delete Acme QA").click();
    });

    const dialog = container.querySelector<HTMLDialogElement>(".project-delete-dialog");
    expect(dialog?.open).toBe(true);
    expect(dialog?.textContent).toContain("Delete Acme QA?");
    expect(dialog?.textContent).toContain("Its 2 monitors go with it");

    await act(async () => {
      button("Delete project").click();
    });

    expect(calls).toContainEqual({
      url: "/api/projects/11111111-1111-4111-8111-111111111111",
      method: "DELETE",
    });
    expect(container.textContent).toContain("No projects yet");
  });

  /**
   * US-146. A trial may make three projects in total, and the dialog says how
   * many are left before the person deletes their way to none.
   */
  it("says how many more projects a trial may make, before one is deleted", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith("/api/projects")) {
        return json({
          projects: [project()],
          nextBlocker: null,
          creations: { made: 2, allowed: 3 },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    screen = await mount(<Projects />);
    container = screen.container;

    await act(async () => {
      button("Delete Acme QA").click();
    });

    expect(container.querySelector(".project-delete-dialog")?.textContent).toContain(
      "This account has made 2, so 1 more can be made after this.",
    );
  });

  it("shows the server's own sentence when a delete is refused", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return json({ message: "No such project." }, 404);
      }
      if (String(url).startsWith("/api/projects")) {
        return json({ projects: [project()], nextBlocker: null });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    screen = await mount(<Projects />);
    container = screen.container;

    await act(async () => {
      button("Delete Acme QA").click();
    });
    await act(async () => {
      button("Delete project").click();
    });

    expect(container.querySelector(".project-delete-dialog [role='alert']")?.textContent).toContain(
      "No such project.",
    );
    expect(container.textContent).toContain("Acme QA");
  });

  it("shows the server's own sentence when the list cannot be read, and retries", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith("/api/projects")) {
        return json({ message: "The database is unreachable." }, 503);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    screen = await mount(<Projects />);
    container = screen.container;

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "The database is unreachable.",
    );

    fetchMock.mockImplementation(async () => json({ projects: [project()] }));
    await act(async () => button("Try again").click());
    await vi.waitFor(() => expect(container.textContent).toContain("Acme QA"));
  });
});
