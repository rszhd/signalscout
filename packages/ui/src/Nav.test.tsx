// @vitest-environment jsdom
/**
 * The parts a navigation is built from. US-355.
 *
 * What the parts decide, and a shell cannot get wrong: an item is current by
 * `aria-current="page"` and by its class together, an item that opens
 * something is a button and not a link, and signing out is a `POST`. Which
 * item is current on which screen is each application's shell test.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountIdentity, NavItem, SignOut } from "./Nav.js";
import { button, json, mount, type Screen, settle } from "./testing/harness.js";

let screen: Screen;

afterEach(async () => {
  await screen?.unmount();
  vi.restoreAllMocks();
});

describe("a navigation item", () => {
  it("links to its screen and says when the reader is on it", async () => {
    screen = await mount(
      <nav>
        <NavItem icon="inbox" label="Inbox" to="/projects/p1" current />
        <NavItem icon="monitors" label="Monitors" to="/projects/p1/monitors" />
      </nav>,
    );
    const [inbox, monitors] = [...screen.container.querySelectorAll("a")];

    expect(inbox?.getAttribute("href")).toBe("/projects/p1");
    expect(inbox?.getAttribute("aria-current")).toBe("page");
    expect(inbox?.className).toBe("nav-item current");
    expect(monitors?.getAttribute("aria-current")).toBeNull();
    expect(monitors?.className).toBe("nav-item");
  });

  it("is a button when it opens something, and keeps the page's class", async () => {
    const onClick = vi.fn();
    screen = await mount(
      <NavItem className="account-sheet-button" icon="account" label="Account" onClick={onClick} />,
    );

    expect(screen.container.querySelector("a")).toBeNull();
    expect(button("Account").className).toBe("nav-item account-sheet-button");
    button("Account").click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("opens another site in a new tab and is never the current page", async () => {
    screen = await mount(
      <NavItem icon="docs" label="Docs" href="https://docs.signalscout.run/" current />,
    );
    const docs = screen.container.querySelector("a");

    expect(docs?.getAttribute("href")).toBe("https://docs.signalscout.run/");
    expect(docs?.getAttribute("target")).toBe("_blank");
    expect(docs?.getAttribute("rel")).toBe("noreferrer");
    expect(docs?.getAttribute("aria-current")).toBeNull();
  });
});

describe("the signed-in person", () => {
  it("shows the first letter, the name and the address in full on hover", async () => {
    screen = await mount(<AccountIdentity name="harith" email="harith@example.com" />);

    expect(screen.container.querySelector(".account-avatar")?.textContent).toBe("H");
    expect(screen.container.querySelector("[title]")?.getAttribute("title")).toBe(
      "harith@example.com",
    );
  });
});

describe("signing out", () => {
  it("posts to the session route and reloads, even when the server refuses", async () => {
    const fetchStub = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(json({ message: "No." }, 500));
    const reload = vi.fn();
    vi.spyOn(globalThis, "location", "get").mockReturnValue({
      ...globalThis.location,
      reload,
    });
    screen = await mount(<SignOut />);

    button("Sign out").click();
    await settle();

    expect(fetchStub).toHaveBeenCalledWith("/api/auth/sign-out", { method: "POST" });
    expect(reload).toHaveBeenCalledOnce();
  });
});
