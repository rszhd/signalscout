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

    expect(container.textContent).toContain("takes a copy");
    expect(container.textContent).toContain("leaves the monitors you already have");
  });

  it("will not create a project until every answer is filled in", async () => {
    await show([]);

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

  it("posts the four answers and the signals that were ticked", async () => {
    await show([]);

    setValue(field("Name"), "Acme QA");
    setValue(field("What is the product?"), "A test runner");
    setValue(field("Who is it for?"), "Small SaaS teams");
    setValue(field("What problem does it solve?"), "Tests break on every UI change");
    await settle();

    const tick = container.querySelector<HTMLInputElement>('.signal-card input[type="checkbox"]');
    await act(async () => tick?.click());
    await settle();

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
      signals: ["problem"],
    });
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

    expect(links).toContain("#/?project=11111111-1111-4111-8111-111111111111");
    expect(links).toContain("#/monitors/new?project=11111111-1111-4111-8111-111111111111");
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
