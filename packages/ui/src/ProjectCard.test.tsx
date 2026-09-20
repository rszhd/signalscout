// @vitest-environment jsdom
/**
 * The project card, driven through the DOM a person uses. US-273, tested where
 * it lives since US-274 gave the package the harness.
 *
 * What is asserted is the shape both products share: the question replacing
 * the action row, the slots the product fills, and the links going where they
 * were told. What each product puts in the slots is that product's own test,
 * through its own page.
 */
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectCard, type ProjectCardProps } from "./ProjectCard.js";
import { button, mount, type Screen, settle } from "./testing/harness.js";

function props(overrides: Partial<ProjectCardProps> = {}): ProjectCardProps {
  return {
    name: "Acme QA",
    inboxHref: "/projects/p1",
    product: "A test runner for small teams",
    audience: "Small SaaS teams with no dedicated QA",
    status: "2 monitors",
    editHref: "/projects/p1/edit",
    actions: (
      <a className="secondary-button" href="/projects/p1/monitors/new">
        New monitor
      </a>
    ),
    deleteQuestion: "Delete Acme QA, its 2 monitors and the 37 matches they found?",
    confirming: false,
    deleting: false,
    onAskDelete: () => undefined,
    onKeep: () => undefined,
    onDelete: () => undefined,
    ...overrides,
  };
}

describe("the project card", () => {
  let screen: Screen;

  async function show(overrides: Partial<ProjectCardProps> = {}) {
    screen = await mount(
      <ul>
        <ProjectCard {...props(overrides)} />
      </ul>,
    );
    return screen.container;
  }

  afterEach(async () => {
    await screen?.unmount();
  });

  it("names the project, links it to its inbox, and shows what the product put in the slots", async () => {
    const container = await show();

    expect(container.querySelector(".project-avatar")?.textContent).toBe("A");
    expect(container.querySelector(".project-name a")?.getAttribute("href")).toBe("/projects/p1");
    expect(container.querySelector(".project-count")?.textContent).toBe("2 monitors");
    expect(container.textContent).toContain("Ideal customer");
    expect(container.textContent).toContain("Small SaaS teams with no dedicated QA");
    expect(container.querySelector(".project-open-button")?.getAttribute("href")).toBe(
      "/projects/p1",
    );
    expect(container.textContent).toContain("New monitor");
    expect(container.querySelector('[aria-label="Edit Acme QA"]')?.getAttribute("href")).toBe(
      "/projects/p1/edit",
    );
  });

  it("colours the status dot by the tone the product gives, and not otherwise", async () => {
    const plain = await show();
    expect(plain.querySelector(".project-count")?.className).toBe("project-count");
    await screen.unmount();

    const running = await show({ status: "Running", statusTone: "running" });
    expect(running.querySelector(".project-count")?.className).toBe("project-count running");
  });

  it("offers no editor when the product has none to open", async () => {
    const container = await show({ editHref: undefined });

    expect(container.querySelector(".project-edit-button")).toBeNull();
  });

  it("asks on the first press, through the page, and sends nothing itself", async () => {
    const onAskDelete = vi.fn();
    const container = await show({ onAskDelete });

    await act(async () => button("Delete").click());

    expect(onAskDelete).toHaveBeenCalledTimes(1);
    // The page decides whether the card is asking: nothing changed here.
    expect(container.textContent).not.toContain("This cannot be undone");
  });

  it("replaces the action row with the question while the page says it is asking", async () => {
    const onKeep = vi.fn();
    const onDelete = vi.fn();
    const container = await show({ confirming: true, onKeep, onDelete });

    const actions = container.querySelector(".project-actions");
    expect(actions?.textContent).toContain("Delete Acme QA, its 2 monitors and the 37 matches");
    expect(actions?.querySelector(".project-open-button")).toBeNull();
    expect(container.textContent).not.toContain("New monitor");

    await act(async () => button("Keep").click());
    expect(onKeep).toHaveBeenCalledTimes(1);

    await act(async () => button("Yes, delete").click());
    await settle();
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("says it is deleting, and takes no second press meanwhile", async () => {
    const container = await show({ confirming: true, deleting: true });

    expect(container.textContent).toContain("Deleting…");
    expect(button("Deleting…").disabled).toBe(true);
    expect(button("Keep").disabled).toBe(true);
  });
});
