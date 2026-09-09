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

  async function show(projects: unknown[] = []) {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith("/api/projects")) {
        return json({ projects });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    screen = await mount(<Projects />);
    container = screen.container;
  }

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(async () => {
    await screen?.unmount();
    vi.unstubAllGlobals();
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
