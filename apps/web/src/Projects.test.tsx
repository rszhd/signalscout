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
import { deleteSentence, Projects } from "./Projects.js";
import { button, json, mount, type Screen, settle } from "./testing.js";

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

  /**
   * Deleting takes the monitors and every match they found. BUG-030.
   *
   * That is the irreversible part, so the card asks once, in place, with the
   * numbers, and nothing is sent until the second press.
   */
  describe("deleting a project", () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let projects: unknown[];

    async function showDeletable(rows: unknown[]) {
      projects = rows;
      fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          projects = [];
          return new Response(null, { status: 204 });
        }
        if (String(url).startsWith("/api/projects")) return json({ projects });
        throw new Error(`Unexpected request: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      screen = await mount(<Projects />);
      container = screen.container;
    }

    it("asks once, with the numbers, and sends nothing until the second press", async () => {
      await showDeletable([project({ matchCount: 37 })]);

      await act(async () => button("Delete").click());

      expect(container.textContent).toContain(
        "Delete Acme QA, its 2 monitors and the 37 matches they found? This cannot be undone.",
      );
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);

      await act(async () => button("Yes, delete").click());
      await settle();

      const sent = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE");
      expect(sent?.[0]).toBe("/api/projects/11111111-1111-4111-8111-111111111111");
      expect(container.textContent).toContain("No projects yet");
    });

    it("keeps the project when the person changes their mind", async () => {
      await showDeletable([project({ matchCount: 37 })]);

      await act(async () => button("Delete").click());
      await act(async () => button("Keep").click());

      expect(container.textContent).not.toContain("This cannot be undone");
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
      expect(container.textContent).toContain("Acme QA");
    });

    /**
     * The question takes the action row. US-273: two rows of unrelated
     * controls on a narrow card make a long project name wrap under the
     * buttons it is about.
     */
    it("replaces the card's actions while it asks", async () => {
      await showDeletable([project({ matchCount: 37 })]);

      expect(container.textContent).toContain("Open inbox");
      expect(container.textContent).toContain("New monitor");

      await act(async () => button("Delete").click());

      const actions = container.querySelector(".project-actions");
      expect(actions?.textContent).toContain("This cannot be undone");
      expect(actions?.querySelector(".project-open-button")).toBeNull();
      expect(container.textContent).not.toContain("New monitor");

      await act(async () => button("Keep").click());
      expect(container.querySelector(".project-open-button")).not.toBeNull();
    });

    /**
     * The row leaves without a reload. US-273: re-reading the list moves every
     * other row under a person who is usually about to do something else.
     */
    it("takes the row out of the list without asking for the list again", async () => {
      await showDeletable([
        project({ matchCount: 37 }),
        project({ id: "22222222-2222-4222-8222-222222222222", name: "Beta" }),
      ]);
      const listReads = () =>
        fetchMock.mock.calls.filter(
          ([url, init]) => !init?.method && String(url).startsWith("/api/projects"),
        ).length;
      const before = listReads();

      await act(async () => button("Delete").click());
      await act(async () => button("Yes, delete").click());
      await settle();

      expect(container.textContent).not.toContain("Acme QA");
      expect(container.textContent).toContain("Beta");
      expect(listReads()).toBe(before);
    });

    /**
     * A row that vanished on a failed request would be a deletion that did not
     * happen. US-273.
     */
    it("keeps the row and says why when the delete fails", async () => {
      const rows = [project({ matchCount: 37 })];
      fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          return json({ message: "The database is unreachable." }, 503);
        }
        if (String(url).startsWith("/api/projects")) return json({ projects: rows });
        throw new Error(`Unexpected request: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      screen = await mount(<Projects />);
      container = screen.container;

      await act(async () => button("Delete").click());
      await act(async () => button("Yes, delete").click());
      await settle();

      expect(container.textContent).toContain("The database is unreachable.");
      expect(container.textContent).toContain("Acme QA");
      // The question closed, so the row is back to its own actions.
      expect(container.querySelector(".project-open-button")).not.toBeNull();
    });

    it("names what goes, in the right number", () => {
      const base = project() as Parameters<typeof deleteSentence>[0];

      expect(deleteSentence({ ...base, monitorCount: 0, matchCount: 0 })).toBe("Delete Acme QA?");
      expect(deleteSentence({ ...base, monitorCount: 1, matchCount: 0 })).toBe(
        "Delete Acme QA and its monitor?",
      );
      expect(deleteSentence({ ...base, monitorCount: 1, matchCount: 1 })).toBe(
        "Delete Acme QA, its monitor and the match it found?",
      );
      expect(deleteSentence({ ...base, monitorCount: 2, matchCount: 37 })).toBe(
        "Delete Acme QA, its 2 monitors and the 37 matches they found?",
      );
      // An older API sends no match count; the sentence does not invent one.
      expect(deleteSentence({ ...base, monitorCount: 2, matchCount: undefined })).toBe(
        "Delete Acme QA and its 2 monitors?",
      );
    });
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
