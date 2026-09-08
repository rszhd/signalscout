// @vitest-environment jsdom
/**
 * The projects screen, driven through the DOM a person uses. US-045.
 *
 * The rules belong to `packages/core` and the wire to `apps/api`; what this
 * owns is whether a person can make a project and whether the screen tells the
 * truth about what editing one does.
 *
 * That second one is the case worth keeping. A project's answers are copied
 * into a monitor, so editing a project changes what the *next* monitor starts
 * from and nothing that already exists — and a screen that let somebody assume
 * otherwise would be lying by omission about their verdicts.
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Projects } from "./Projects.js";
import { button, field, json, mount, type Screen, settle, setValue } from "./testing.js";

const signalOptions = [
  { id: "problem", label: "Describing the problem", hint: "They say what is going wrong." },
  { id: "purchase", label: "Ready to buy", hint: "They are looking to spend." },
];

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
  let fetchMock: ReturnType<typeof vi.fn>;

  function respond(projects: unknown[]) {
    fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith("/api/monitor-options")) {
        return json({ signals: signalOptions, sources: [] });
      }
      return json({ projects });
    });
    vi.stubGlobal("fetch", fetchMock);
  }

  async function show(projects: unknown[] = []) {
    respond(projects);
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

  it("says there are none yet, and what making one would do", async () => {
    await show([]);

    expect(container.textContent).toContain("No projects yet");
    expect(container.textContent).toContain("starts with its answers filled in");
  });

  /**
   * The sentence that keeps the copy decision honest.
   *
   * If projects ever become a link, this is the case that has to change first
   * — and changing it should force somebody to think about US-012's verdicts.
   */
  it("says an edit reaches the next monitor and not the ones that exist", async () => {
    await show([]);
    await act(async () => button("New project").click());

    expect(container.textContent).toContain("takes a copy");
    expect(container.textContent).toContain("leaves the monitors you already have");
  });

  it("will not create a project until every answer is filled in", async () => {
    await show([]);
    await act(async () => button("New project").click());

    expect(button("Create project").disabled).toBe(true);

    setValue(field("Name"), "Acme QA");
    setValue(field("What is the product?"), "A test runner");
    await settle();

    // Two of four. A half-filled project prefills a monitor with gaps.
    expect(button("Create project").disabled).toBe(true);

    setValue(field("Who is it for?"), "Small SaaS teams");
    setValue(field("What problem does it solve?"), "Tests break on every UI change");
    await settle();

    expect(button("Create project").disabled).toBe(false);
  });

  /**
   * The four answers, and no signals.
   *
   * The form stopped asking for signals: they say what one search looks for,
   * so the monitor form asks instead. What is asserted here is the body, not
   * the absent control — a screen that still sent an empty list would look the
   * same and would erase an edited project's own signals on `PATCH`.
   */
  it("posts the four answers and asks for no signals", async () => {
    await show([]);
    await act(async () => button("New project").click());

    setValue(field("Name"), "Acme QA");
    setValue(field("What is the product?"), "A test runner");
    setValue(field("Who is it for?"), "Small SaaS teams");
    setValue(field("What problem does it solve?"), "Tests break on every UI change");
    await settle();

    expect(container.querySelector(".project-signals")).toBeNull();

    await act(async () => button("Create project").click());
    await settle();

    const write = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    );

    const [url, init] = write as [string, RequestInit];

    expect(url).toBe("/api/projects");
    expect(JSON.parse(init.body as string)).toEqual({
      name: "Acme QA",
      product: "A test runner",
      idealCustomer: "Small SaaS teams",
      problem: "Tests break on every UI change",
    });
  });

  /**
   * Drafting from a document. US-050.
   *
   * What is asserted is that a draft is a draft: the fields are filled in, the
   * gaps the model admits to are shown, and nothing is written. These four
   * fields are the ones the classifier reads, so a screen that saved them on
   * somebody's behalf would put words nobody wrote into every later verdict.
   */
  it("fills the four fields from a page, and saves nothing", async () => {
    respond([]);
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith("/api/monitor-options")) {
        return json({ signals: signalOptions, sources: [] });
      }
      if (String(url) === "/api/projects/describe") {
        return json({
          name: "Acme QA",
          product: "A test runner for small teams",
          idealCustomer: "Small SaaS teams",
          problem: "Tests break on every UI change",
          signals: ["problem"],
          missing: ["how it is priced"],
          charactersRead: 1200,
          truncated: false,
        });
      }
      void init;
      return json({ projects: [] });
    });

    screen = await mount(<Projects />);
    container = screen.container;

    await act(async () => button("New project").click());
    await act(async () => container.querySelector<HTMLElement>("details summary")?.click());
    setValue(field("Your product's address"), "https://acme.test");
    await settle();

    await act(async () => button("Read this page").click());
    await settle();

    expect(field("What is the product?").value).toBe("A test runner for small teams");
    expect(field("What problem does it solve?").value).toBe("Tests break on every UI change");

    // The gap the model admits to, shown rather than swallowed.
    expect(container.textContent).toContain("how it is priced");

    // Nothing was written. The person still has to press the button.
    const writes = fetchMock.mock.calls.filter(
      ([url, init]) =>
        (init as RequestInit | undefined)?.method === "POST" && String(url) === "/api/projects",
    );
    expect(writes).toEqual([]);
  });

  it("shows the server's own sentence when a page cannot be read", async () => {
    respond([]);
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith("/api/monitor-options")) {
        return json({ signals: signalOptions, sources: [] });
      }
      if (String(url) === "/api/projects/describe") {
        return json({ message: "example.test resolves to an address on this network." }, 400);
      }
      return json({ projects: [] });
    });

    screen = await mount(<Projects />);
    container = screen.container;

    await act(async () => button("New project").click());
    await act(async () => container.querySelector<HTMLElement>("details summary")?.click());
    setValue(field("Your product's address"), "https://example.test");
    await settle();

    await act(async () => button("Read this page").click());
    await settle();

    // The server named the reason; a screen that said "could not analyse"
    // would throw away the part a person can act on.
    expect(container.textContent).toContain("resolves to an address on this network");
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

  it("offers a project its own inbox and a monitor that starts from it", async () => {
    await show([project()]);

    const links = [...container.querySelectorAll("a")].map((link) => link.getAttribute("href"));

    expect(links).toContain("/projects/11111111-1111-4111-8111-111111111111");
    expect(links).toContain("/projects/11111111-1111-4111-8111-111111111111/monitors/new");
  });

  it("keeps the list separate from editing and clears a cancelled draft", async () => {
    await show([project()]);
    expect(container.querySelector('input[aria-label="Name"]')).toBeNull();
    await act(async () => button("Edit").click());
    expect(field("Name").value).toBe("Acme QA");
    expect(document.activeElement).toBe(field("Name"));
    setValue(field("Name"), "Unsaved name");
    await settle();
    await act(async () => button("Cancel").click());
    expect(container.textContent).toContain("Acme QA");
    await act(async () => button("New project").click());
    expect(field("Name").value).toBe("");
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method)).toBe(false);
  });

  it("retains edits when saving fails", async () => {
    await show([project()]);
    await act(async () => button("Edit").click());
    fetchMock.mockResolvedValueOnce(json({ message: "Please try again." }, 500));
    await act(async () => button("Save changes").click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Please try again.");
    expect(field("Name").value).toBe("Acme QA");
    expect(button("Save changes").disabled).toBe(false);
  });

  it("edits with PATCH rather than making a second project", async () => {
    await show([project()]);

    await act(async () => button("Edit").click());
    await settle();

    setValue(field("Name"), "Acme QA (EU)");
    await settle();

    await act(async () => button("Save changes").click());
    await settle();

    const write = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
    );

    const [url, init] = write as [string, RequestInit];

    expect(url).toBe("/api/projects/11111111-1111-4111-8111-111111111111");
    expect(JSON.parse(init.body as string)).toMatchObject({
      name: "Acme QA (EU)",
      product: "A test runner for small teams",
    });
  });
});
