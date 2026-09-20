// @vitest-environment jsdom
/**
 * The state block and the error row. US-276.
 *
 * What is asserted is the one thing a screen cannot be trusted to remember:
 * the role each state carries, which is what a screen reader reads. Before
 * this, two of the sixteen hand-written state blocks carried none.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mount, type Screen } from "../testing/harness.js";
import { FormError } from "./FormError.js";
import { PageState } from "./PageState.js";

describe("the state block", () => {
  let screen: Screen;

  afterEach(async () => {
    await screen?.unmount();
  });

  it("tells a screen reader it is waiting, and draws the spinner", async () => {
    screen = await mount(<PageState kind="loading">Reading your monitors.</PageState>);
    const block = screen.container.querySelector(".center-state");

    expect(block?.getAttribute("role")).toBe("status");
    expect(block?.querySelector(".spinner")).not.toBeNull();
    expect(block?.textContent).toContain("Reading your monitors.");
  });

  it("says an empty state as status, with the product's own mark", async () => {
    screen = await mount(
      <PageState kind="empty" mark="◎" heading="No monitors yet" action={<a href="/new">Create</a>}>
        Create a monitor and SignalScout will start collecting.
      </PageState>,
    );
    const block = screen.container.querySelector(".center-state");

    expect(block?.getAttribute("role")).toBe("status");
    expect(block?.querySelector(".empty-mark")?.textContent).toBe("◎");
    expect(block?.querySelector("h2")?.textContent).toBe("No monitors yet");
    expect(block?.querySelector("a")?.getAttribute("href")).toBe("/new");
  });

  it("says an error as alert, with the icon, whatever the caller wrote", async () => {
    screen = await mount(
      <PageState kind="error" heading="The inbox could not be loaded">
        The database is unreachable.
      </PageState>,
    );
    const block = screen.container.querySelector(".center-state");

    expect(block?.getAttribute("role")).toBe("alert");
    expect(block?.classList.contains("error-state")).toBe(true);
    expect(block?.querySelector(".state-icon")).not.toBeNull();
    expect(block?.textContent).toContain("The database is unreachable.");
  });

  it("fills the page unless told it is a notice inside one", async () => {
    screen = await mount(<PageState kind="empty">Nothing here.</PageState>);
    expect(screen.container.querySelector(".center-state")?.classList.contains("page-state")).toBe(
      true,
    );
    await screen.unmount();

    screen = await mount(
      <PageState kind="empty" page={false}>
        Nothing here.
      </PageState>,
    );
    expect(screen.container.querySelector(".center-state")?.classList.contains("page-state")).toBe(
      false,
    );
  });
});

describe("the error row", () => {
  let screen: Screen;

  afterEach(async () => {
    await screen?.unmount();
  });

  it("is an alert, as a line when there is nothing to press", async () => {
    screen = await mount(<FormError>Set a monthly budget.</FormError>);
    const row = screen.container.querySelector(".form-error");

    expect(row?.tagName).toBe("P");
    expect(row?.getAttribute("role")).toBe("alert");
    expect(row?.textContent).toBe("Set a monthly budget.");
  });

  it("is an alert, as a row with the action at the end when there is one", async () => {
    screen = await mount(
      <FormError action={<button type="button">Try again</button>}>Could not load.</FormError>,
    );
    const row = screen.container.querySelector(".form-error");

    expect(row?.tagName).toBe("DIV");
    expect(row?.getAttribute("role")).toBe("alert");
    expect(row?.querySelector("span")?.textContent).toBe("Could not load.");
    expect(row?.querySelector("button")?.textContent).toBe("Try again");
  });

  it("takes a placement class from the page and keeps its own", async () => {
    screen = await mount(<FormError className="floating-error">Gone.</FormError>);
    const row = screen.container.querySelector(".form-error");

    expect(row?.classList.contains("floating-error")).toBe(true);
  });
});
