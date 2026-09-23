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
  it("puts the form beside the story, and says the hosted footer by default", async () => {
    screen = await mount(
      <LoginFrame>
        <form aria-label="Sign in" />
      </LoginFrame>,
    );
    const layout = screen.container.querySelector(".login-layout");

    expect(layout?.lastElementChild?.getAttribute("aria-label")).toBe("Sign in");
    expect(screen.container.querySelector(".login-footer")?.textContent).toBe(
      "AI intent monitoring.",
    );
    expect(screen.container.querySelector(".login-story-footer")).toBeNull();
  });

  it("says what the product passes under the story and in the footer", async () => {
    screen = await mount(
      <LoginFrame storyNote="Your data." footer="AI intent monitoring you can self-host.">
        <form />
      </LoginFrame>,
    );

    expect(screen.container.querySelector(".login-story-footer")?.textContent).toBe("Your data.");
    expect(screen.container.querySelector(".login-footer")?.textContent).toBe(
      "AI intent monitoring you can self-host.",
    );
  });
});
