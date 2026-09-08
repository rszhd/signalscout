// @vitest-environment jsdom
/**
 * The signed-out screen, through the DOM.
 *
 * Two claims, and both are about what a person meets rather than about the
 * server. An instance with no account asks for one; an instance that has one
 * offers no way to make a second. The second claim is the one worth a test:
 * a sign-up form left on the screen of a public instance is how these tools
 * get taken, and it would look completely normal.
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { Login } from "./Login.js";
import { button, field, json, mount, type Screen, settle, setValue } from "./testing.js";

describe("the login screen", () => {
  let screen: Screen;
  let fetched: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    globalThis.location.hash = "";
    fetched = vi.fn(async () => json({}));
    vi.stubGlobal("fetch", fetched);
    // The component reloads on success, and jsdom refuses to navigate.
    vi.stubGlobal("location", { ...globalThis.location, reload: vi.fn(), hash: "" });
  });

  afterEach(async () => {
    await screen?.unmount();
    vi.unstubAllGlobals();
  });

  it("asks for the first account when the instance has none", async () => {
    screen = await mount(<Login firstRun={true} signUpOpen={true} />);

    expect(screen.container.textContent).toContain("Set up this instance");
    expect(screen.container.textContent).toContain("signup closes behind it");
    expect(field("Your name")).toBeTruthy();
    expect(field("Password").minLength).toBe(12);
  });

  it("offers no way to make a second account when signup is closed", async () => {
    screen = await mount(<Login firstRun={false} signUpOpen={false} />);

    expect(screen.container.textContent).toContain("Sign in");
    expect(screen.container.textContent).not.toContain("Set up this instance");
    expect(() => field("Your name")).toThrow();
    expect(button("Sign in")).toBeTruthy();
    // Absent, not disabled. An offer that refuses is worse than no offer,
    // because somebody fills the form in before they meet the refusal.
    expect(() => button("Create an account")).toThrow();
  });

  /**
   * The cloud shape. US-066 reversed US-017's one-account rule behind a
   * setting, and this is what that setting looks like on the screen.
   */
  it("offers the way to a new account when signup is open", async () => {
    screen = await mount(<Login firstRun={false} signUpOpen={true} />);

    // It opens on sign in: on an instance taking registrations, most visitors
    // are people coming back.
    expect(screen.container.textContent).toContain("Sign in");
    expect(() => field("Your name")).toThrow();

    await act(async () => button("Create an account").click());
    await settle();

    expect(screen.container.textContent).toContain("Create an account");
    expect(field("Your name")).toBeTruthy();
    expect(field("Password").minLength).toBe(12);
    // And it does not claim to be the first run, because it is not.
    expect(screen.container.textContent).not.toContain("Set up this instance");
  });

  it("registers through the sign-up endpoint once somebody switches to it", async () => {
    screen = await mount(<Login firstRun={false} signUpOpen={true} />);

    await act(async () => button("Create an account").click());
    await settle();

    setValue(field("Your name"), "Someone New");
    setValue(field("Email"), "new@example.com");
    setValue(field("Password"), "a-long-enough-password");
    await act(async () => button("Create the account").click());
    await settle();

    const [url, init] = fetched.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/auth/sign-up/email");
    expect(JSON.parse(String(init.body))).toEqual({
      name: "Someone New",
      email: "new@example.com",
      password: "a-long-enough-password",
    });
  });

  it("sends the password to the sign-in endpoint and nowhere else", async () => {
    screen = await mount(<Login firstRun={false} signUpOpen={false} />);

    setValue(field("Email"), "owner@example.com");
    setValue(field("Password"), "a-long-enough-password");
    await act(async () => button("Sign in").click());
    await settle();

    expect(fetched).toHaveBeenCalledTimes(1);
    const [url, init] = fetched.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/auth/sign-in/email");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      email: "owner@example.com",
      password: "a-long-enough-password",
    });
  });

  it("shows the server's own sentence when a sign-in is refused", async () => {
    fetched.mockResolvedValue(json({ message: "Invalid email or password." }, 401));
    screen = await mount(<Login firstRun={false} signUpOpen={false} />);

    setValue(field("Email"), "owner@example.com");
    setValue(field("Password"), "the-wrong-password");
    await act(async () => button("Sign in").click());
    await settle();

    expect(screen.container.textContent).toContain("Invalid email or password.");
  });

  it("is what the shell shows instead of the inbox when nobody is signed in", async () => {
    fetched.mockImplementation(async (request: string) => {
      if (request === "/api/auth-status") {
        return json({ firstRun: false, signUpOpen: false, signedIn: false, account: null });
      }
      throw new Error(`The signed-out shell asked for ${request}`);
    });

    screen = await mount(<App />);

    // The wording changed in US-066 and the assertion moved with it. It used
    // to say "This instance is private", which is true of a self-hosted box and
    // false of a cloud tier taking registrations; one sentence now serves both.
    expect(screen.container.textContent).toContain("Sign in to read your inbox");
    // No sidebar, no inbox, and nothing fetched behind the form.
    expect(screen.container.textContent).not.toContain("Intent inbox");
    expect(fetched).toHaveBeenCalledTimes(1);
  });
});
