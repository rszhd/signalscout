// @vitest-environment jsdom
/**
 * The notification screen's options, driven through the DOM. US-354.
 *
 * What each application's own test owns is the screen against its API. What
 * this owns is what the package decides: the fields only one API sends are
 * optional, the product's own sentence replaces the default one, and a
 * secret the account may not store cannot be asked for.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Notifications, type SigningSecret } from "./Notifications.js";
import { button, json, mount, type Screen } from "./testing/harness.js";

let screen: Screen;

afterEach(async () => {
  await screen?.unmount();
  vi.restoreAllMocks();
});

function answer(signingSecret: SigningSecret) {
  return {
    settings: {
      emailEnabled: false,
      emailTo: "",
      digestHours: 24,
      minScore: 50,
      immediateScore: null,
      webhookEnabled: false,
      webhookUrl: "",
      webhookMode: "digest",
    },
    smtpMissing: [],
    webhookMissing: [],
    emailError: null,
    webhookError: null,
    nextDigestAt: null,
    signingSecret,
  };
}

async function show(secret: SigningSecret, notice?: (secret: SigningSecret) => React.ReactNode) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(json(answer(secret)));
  screen = await mount(
    <Notifications monitorId="m1" monitorHref="/projects/p1/monitors/m1" signingNotice={notice} />,
  );
  return screen.container.textContent ?? "";
}

describe("the notification screen", () => {
  it("reads a hosted answer, which sends none of the self-hosted fields", async () => {
    const text = await show({ hint: null, updatedAt: null });

    expect(text).toContain("No secret yet, so nothing can be delivered.");
    expect(button("Generate a secret").disabled).toBe(false);
  });

  it("says the product's own sentence in place of the default one", async () => {
    const text = await show({ hint: null, updatedAt: null, usingInstanceSecret: true }, (secret) =>
      secret.usingInstanceSecret ? <p>Signed with the instance's secret.</p> : null,
    );

    expect(text).toContain("Signed with the instance's secret.");
    expect(text).not.toContain("No secret yet");
  });

  it("falls back to the default sentence when the product has nothing to say", async () => {
    const text = await show({ hint: null, updatedAt: null }, () => null);

    expect(text).toContain("No secret yet");
  });

  it("will not ask for a secret the account may not store, and says why", async () => {
    const text = await show({
      hint: null,
      updatedAt: null,
      canStore: false,
      storeBlocker: "Set SECRETS_KEY to store a secret.",
    });

    expect(text).toContain("Set SECRETS_KEY to store a secret.");
    expect(button("Generate a secret").disabled).toBe(true);
  });

  it("links back to the monitor it was given", async () => {
    await show({ hint: "••••1234", updatedAt: null });

    const links = [...screen.container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/projects/p1/monitors/m1", "/projects/p1/monitors/m1"]);
  });
});
