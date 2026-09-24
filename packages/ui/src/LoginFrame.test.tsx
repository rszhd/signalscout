// @vitest-environment jsdom
/**
 * The page around a sign-in form. US-354.
 *
 * The form is the child and each application's; what the frame owns is where
 * the child goes and the two lines a product says about itself.
 */
import { afterEach, describe, expect, it } from "vitest";
import { LoginFrame } from "./LoginFrame.js";
import { mount, type Screen } from "./testing/harness.js";

let screen: Screen;

afterEach(async () => {
  await screen?.unmount();
});

describe("the login frame", () => {
  it("puts the mark at the top of one card, the screen under it, and no row by default", async () => {
    screen = await mount(
      <LoginFrame>
        <form aria-label="Sign in" />
      </LoginFrame>,
    );
    const shell = screen.container.querySelector(".login-shell");

    expect(shell?.firstElementChild?.getAttribute("src")).toBe("/brand/mark.svg");
    expect(shell?.lastElementChild?.getAttribute("aria-label")).toBe("Sign in");
    // A product that says nothing about itself gets no row under the card.
    expect(screen.container.querySelector(".login-footer")).toBeNull();
  });

  it("says what the product passes in the row under the card", async () => {
    screen = await mount(
      <LoginFrame storyNote="Your data." footer={<a href="/help">Help</a>}>
        <form />
      </LoginFrame>,
    );
    const row = screen.container.querySelector(".login-footer");

    expect(row?.firstElementChild?.textContent).toBe("Your data.");
    expect(row?.lastElementChild?.getAttribute("href")).toBe("/help");
  });
});
