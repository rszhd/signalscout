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

    expect(
      screen.container.querySelector<HTMLImageElement>('.brand-logo[src="/logo.png"]'),
    ).not.toBeNull();
    expect(screen.container.textContent).toContain("Set up this instance");
    expect(screen.container.textContent).toContain("signup closes behind it");
    expect(screen.container.textContent).not.toContain("Example conversation");
    expect(field("Your name")).toBeTruthy();
    expect(field("Password").minLength).toBe(8);
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
    expect(field("Password").minLength).toBe(8);
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

  /**
   * An address that has to be proven. US-092.
   *
   * Three states the screen never had before, and each one is a person left
   * with nothing to do if it is missing: a sign-up that made no session, a
   * sign-in the server refused because the link is unopened, and a link that
   * had expired by the time it was clicked.
   */
  describe("when the instance verifies an address", () => {
    it("says to check the email when a sign-up made no session", async () => {
      fetched.mockResolvedValue(json({ token: null, user: { email: "new@example.com" } }));
      screen = await mount(<Login firstRun={false} signUpOpen={true} />);

      await act(async () => button("Create an account").click());
      await settle();
      setValue(field("Your name"), "Someone New");
      setValue(field("Email"), "new@example.com");
      setValue(field("Password"), "a-long-enough-password");
      await act(async () => button("Create the account").click());
      await settle();

      expect(screen.container.textContent).toContain("Check your email");
      expect(screen.container.textContent).toContain("new@example.com");
      // The form is gone, not merely covered: a second submit would post the
      // same registration again and send a second link.
      expect(() => field("Password")).toThrow();
      expect(globalThis.location.reload).not.toHaveBeenCalled();
    });

    /**
     * The loop a person actually got stuck in, on 2026-09-09.
     *
     * They registered an address they had registered earlier, met "check your
     * email", and no mail came — because the server answers an existing
     * address with a fabricated success so that nobody can enumerate accounts.
     * Nothing on the screen said the way out was to sign in, so the product
     * read as broken.
     */
    it("names the reason no link may come, without saying which address it is", async () => {
      fetched.mockResolvedValue(json({ token: null, user: { email: "taken@example.com" } }));
      screen = await mount(<Login firstRun={false} signUpOpen={true} />);

      await act(async () => button("Create an account").click());
      await settle();
      setValue(field("Your name"), "Someone");
      setValue(field("Email"), "taken@example.com");
      setValue(field("Password"), "a-long-enough-password");
      await act(async () => button("Create the account").click());
      await settle();

      expect(screen.container.textContent).toContain("already have an account");
      expect(screen.container.textContent).toContain("sign in instead");
      // And it stays a possibility rather than a statement. Confirming that
      // this address is taken is the enumeration the server refuses to do.
      expect(screen.container.textContent).not.toContain("is already registered");
    });

    it("says the same thing when a refused sign-in means the link is unopened", async () => {
      fetched.mockResolvedValue(
        json({ message: "Email not verified", code: "EMAIL_NOT_VERIFIED" }, 403),
      );
      screen = await mount(<Login firstRun={false} signUpOpen={false} />);

      setValue(field("Email"), "owner@example.com");
      setValue(field("Password"), "a-long-enough-password");
      await act(async () => button("Sign in").click());
      await settle();

      expect(screen.container.textContent).toContain("Check your email");
      expect(screen.container.textContent).toContain("owner@example.com");
      // And not the library's own words, which name a state rather than an
      // action and read as a failure the person caused.
      expect(screen.container.textContent).not.toContain("Email not verified");
    });

    /**
     * The code and not the sentence.
     *
     * A refusal that is *not* about verification has to go back to the form
     * with the server's own words, and matching on wording would send a wrong
     * password to the wrong screen the day the library rephrases something.
     */
    it("still shows a wrong password as a wrong password", async () => {
      fetched.mockResolvedValue(
        json({ message: "Invalid email or password.", code: "INVALID_EMAIL_OR_PASSWORD" }, 401),
      );
      screen = await mount(<Login firstRun={false} signUpOpen={false} />);

      setValue(field("Email"), "owner@example.com");
      setValue(field("Password"), "the-wrong-password");
      await act(async () => button("Sign in").click());
      await settle();

      expect(screen.container.textContent).toContain("Invalid email or password.");
      expect(screen.container.textContent).not.toContain("Check your email");
    });

    it("explains a link that had already expired, rather than showing a bare form", async () => {
      vi.stubGlobal("location", {
        ...globalThis.location,
        reload: vi.fn(),
        search: "?error=TOKEN_EXPIRED",
      });

      screen = await mount(<Login firstRun={false} signUpOpen={false} />);

      expect(screen.container.textContent).toContain("expired");
      // And it says what to do next, which is the one action that works.
      expect(screen.container.textContent).toContain("send a new one");
      expect(button("Sign in")).toBeTruthy();
    });

    it("says nothing about a link when the address carries no error", async () => {
      screen = await mount(<Login firstRun={false} signUpOpen={false} />);

      expect(screen.container.textContent).not.toContain("confirmation link");
    });
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
