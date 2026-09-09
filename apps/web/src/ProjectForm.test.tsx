// @vitest-environment jsdom
/**
 * The project editor pages, driven through the DOM a person uses. US-045.
 *
 * One form serves `/projects/new` and `/projects/<id>/edit`, so this file owns
 * both modes through the same component: what a create sends, what an edit
 * loads and patches, and what each does after it saves — a new business goes
 * to its own inbox, an edited one goes back to the list.
 *
 * The list is `Projects.test.tsx`. This page is where the copy decision lives:
 * an edit reaches the next monitor and never the ones that already exist.
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectForm } from "./Projects.js";
import { button, field, json, mount, type Screen, settle, setValue } from "./testing.js";

const projectId = "11111111-1111-4111-8111-111111111111";

const answers = {
  name: "Acme QA",
  product: "A test runner for small teams",
  idealCustomer: "Small SaaS teams with no dedicated QA",
  problem: "Their end to end tests break on every UI change",
};

function projectJson(overrides: Record<string, unknown> = {}) {
  return {
    id: projectId,
    ...answers,
    signals: ["problem"],
    monitorCount: 2,
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
    ...overrides,
  };
}

describe("the project editor", () => {
  let screen: Screen;
  let container: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  /** Fill the four answers a person must type. */
  async function fillAll() {
    setValue(field("Name"), answers.name);
    setValue(field("What is the product?"), answers.product);
    setValue(field("Who is it for?"), answers.idealCustomer);
    setValue(field("What problem does it solve?"), answers.problem);
    await settle();
  }

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(async () => {
    await screen?.unmount();
    vi.unstubAllGlobals();
  });

  it("will not create a project until every answer is filled in", async () => {
    fetchMock = vi.fn(async () => json(projectJson()));
    vi.stubGlobal("fetch", fetchMock);

    screen = await mount(<ProjectForm projectId={null} />, "/projects/new");
    container = screen.container;

    expect(container.querySelector("h1")?.textContent).toBe("New project");
    expect(button("Create project").disabled).toBe(true);

    setValue(field("Name"), answers.name);
    setValue(field("What is the product?"), answers.product);
    await settle();

    // Two of four. A half-filled project prefills a monitor with gaps.
    expect(button("Create project").disabled).toBe(true);

    await fillAll();

    expect(button("Create project").disabled).toBe(false);
  });

  /**
   * The copy decision, on the page that makes the promise. An edit reaches the
   * next monitor and not the ones that exist, because `monitors.version` is
   * the version a verdict was given against.
   */
  it("says an edit reaches the next monitor and not the ones that exist", async () => {
    fetchMock = vi.fn(async () => json(projectJson()));
    vi.stubGlobal("fetch", fetchMock);

    screen = await mount(<ProjectForm projectId={null} />, "/projects/new");

    expect(screen.container.textContent).toContain("takes a copy");
    expect(screen.container.textContent).toContain("leaves the monitors you already have");
  });

  /**
   * The four answers, and no signals.
   *
   * The form stopped asking for signals: they say what one search looks for,
   * so the monitor form asks instead. What is asserted here is the body, not
   * the absent control — a screen that still sent an empty list would look the
   * same and would erase an edited project's own signals on `PATCH`.
   */
  it("posts the four answers, asks for no signals, and goes to the inbox", async () => {
    const created = projectJson({ id: "22222222-2222-4222-8222-222222222222" });
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      void init;
      return json(String(url) === "/api/projects" ? created : { projects: [] }, 201);
    });
    vi.stubGlobal("fetch", fetchMock);

    screen = await mount(<ProjectForm projectId={null} />, "/projects/new");
    container = screen.container;

    expect(container.querySelector(".project-signals")).toBeNull();

    await fillAll();
    await act(async () => button("Create project").click());
    await settle();

    const write = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    );

    const [url, init] = write as [string, RequestInit];

    expect(url).toBe("/api/projects");
    expect(JSON.parse(init.body as string)).toEqual(answers);

    // A new business is sent to its own inbox, which offers the first monitor.
    expect(screen.path()).toBe("/projects/22222222-2222-4222-8222-222222222222");
  });

  it("shows the back way to the list from either mode", async () => {
    fetchMock = vi.fn(async (url: string) => {
      if (String(url) === `/api/projects/${projectId}`) return json(projectJson());
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    screen = await mount(<ProjectForm projectId={projectId} />, `/projects/${projectId}/edit`);
    await settle();

    expect(screen.container.querySelector('a[href="/projects"]')).not.toBeNull();
  });

  it("loads an existing project and edits with PATCH, back to the list", async () => {
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && String(url) === `/api/projects/${projectId}`) {
        return json(projectJson());
      }
      if (method === "PATCH" && String(url) === `/api/projects/${projectId}`) {
        return json(projectJson({ name: "Acme QA (EU)" }));
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    screen = await mount(<ProjectForm projectId={projectId} />, `/projects/${projectId}/edit`);
    container = screen.container;
    await settle();

    expect(container.querySelector("h1")?.textContent).toBe("Edit project");
    expect(field("Name").value).toBe(answers.name);

    setValue(field("Name"), "Acme QA (EU)");
    await settle();

    await act(async () => button("Save changes").click());
    await settle();

    const write = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
    );
    const [url, init] = write as [string, RequestInit];

    expect(url).toBe(`/api/projects/${projectId}`);
    expect(JSON.parse(init.body as string)).toEqual({ ...answers, name: "Acme QA (EU)" });
    expect(screen.path()).toBe("/projects");
  });

  it("retains edits when saving fails", async () => {
    let patch = false;
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && String(url) === `/api/projects/${projectId}`) {
        return json(projectJson());
      }
      if (method === "PATCH" && String(url) === `/api/projects/${projectId}`) {
        patch = true;
        return json({ message: "Please try again." }, 500);
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    screen = await mount(<ProjectForm projectId={projectId} />, `/projects/${projectId}/edit`);
    await settle();

    setValue(field("Name"), "Acme QA (EU)");
    await settle();
    await act(async () => button("Save changes").click());
    await settle();

    expect(patch).toBe(true);
    expect(screen.container.querySelector('[role="alert"]')?.textContent).toContain(
      "Please try again.",
    );
    expect(field("Name").value).toBe("Acme QA (EU)");
    expect(button("Save changes").disabled).toBe(false);
  });

  it("does not offer a blank form for a project that cannot be read", async () => {
    fetchMock = vi.fn(async () => json({ message: "No such project." }, 404));
    vi.stubGlobal("fetch", fetchMock);

    screen = await mount(<ProjectForm projectId={projectId} />, `/projects/${projectId}/edit`);
    container = screen.container;
    await settle();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("No such project.");
    expect(container.querySelector('input[aria-label="Name"]')).toBeNull();
    expect(() => button("Save changes")).toThrow();
    // The way out is the list.
    expect(container.querySelector('a[href="/projects"]')).not.toBeNull();
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
    fetchMock = vi.fn(async (url: string) => {
      if (String(url) === "/api/projects/describe") {
        return json({
          name: answers.name,
          product: answers.product,
          idealCustomer: answers.idealCustomer,
          problem: answers.problem,
          signals: ["problem"],
          missing: ["how it is priced"],
          charactersRead: 1200,
          truncated: false,
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    screen = await mount(<ProjectForm projectId={null} />, "/projects/new");
    container = screen.container;

    await act(async () => container.querySelector<HTMLElement>("details summary")?.click());
    setValue(field("Your product's address"), "https://acme.test");
    await settle();

    await act(async () => button("Read this page").click());
    await settle();

    expect(field("What is the product?").value).toBe(answers.product);
    expect(field("What problem does it solve?").value).toBe(answers.problem);

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
    fetchMock = vi.fn(async (url: string) => {
      if (String(url) === "/api/projects/describe") {
        return json({ message: "example.test resolves to an address on this network." }, 400);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    screen = await mount(<ProjectForm projectId={null} />, "/projects/new");
    container = screen.container;

    await act(async () => container.querySelector<HTMLElement>("details summary")?.click());
    setValue(field("Your product's address"), "https://example.test");
    await settle();

    await act(async () => button("Read this page").click());
    await settle();

    expect(container.textContent).toContain("resolves to an address on this network");
  });
});
