// @vitest-environment jsdom
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { Notifications } from "./Notifications.js";
import { button, json, mount, type Screen, settle, setValue } from "./testing.js";

let screen: Screen;
afterEach(async () => {
  await screen?.unmount();
  vi.unstubAllGlobals();
});
const settings = {
  emailEnabled: false,
  emailTo: "",
  digestHours: 24,
  minScore: 50,
  immediateScore: null,
  webhookEnabled: false,
  webhookUrl: "",
  webhookMode: "digest",
};
/** US-096. An account with no secret of its own, on an instance that has one. */
const instanceSecret = {
  hint: null,
  usingInstanceSecret: true,
  canStore: true,
  storeBlocker: null,
  updatedAt: null,
};

function response(extra = {}) {
  return {
    settings,
    smtpMissing: [],
    webhookMissing: [],
    emailError: null,
    webhookError: null,
    nextDigestAt: null,
    signingSecret: instanceSecret,
    ...extra,
  };
}
function input(label: string) {
  const node = [...document.querySelectorAll("label")]
    .find((one) => one.textContent === label)
    ?.querySelector("input");
  if (!node) throw new Error(`No input labelled ${label}`);
  return node;
}
it("saves a digest and immediate threshold through the controls", async () => {
  const requests: RequestInit[] = [];
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      requests.push(init);
      return json(response({ settings: JSON.parse(init.body as string) }));
    }
    return json(response());
  });
  screen = await mount(
    <Notifications monitorId="monitor-1" projectId="p1" />,
    "/projects/p1/monitors/monitor-1/notifications",
  );
  await act(async () => {
    input("Email digest").click();
    setValue(input("Recipient email"), "owner@example.com");
    input("Immediate email alerts").click();
  });
  await act(async () => {
    setValue(input("Immediate alert score"), "85");
    button("Save notifications").click();
  });
  await settle();
  expect(JSON.parse(requests[0]?.body as string)).toMatchObject({
    emailEnabled: true,
    emailTo: "owner@example.com",
    digestHours: 24,
    minScore: 50,
    immediateScore: 85,
  });
  expect(screen.container.textContent).toContain("Notification settings saved.");
});
it("shows missing configuration and disabled webhook failures", async () => {
  vi.stubGlobal("fetch", async () =>
    json(
      response({
        smtpMissing: ["SMTP_HOST", "SMTP_FROM"],
        webhookMissing: ["WEBHOOK_SIGNING_SECRET"],
        webhookError: "Webhook disabled after repeated delivery failures.",
      }),
    ),
  );
  screen = await mount(
    <Notifications monitorId="monitor-1" projectId="p1" />,
    "/projects/p1/monitors/monitor-1/notifications",
  );
  expect(input("Email digest").disabled).toBe(true);
  expect(input("Enable webhook").disabled).toBe(true);
  expect(screen.container.textContent).toContain("SMTP_HOST, SMTP_FROM");
  expect(screen.container.textContent).toContain("Webhook disabled");
});
it("keeps the form and reports a failed save", async () => {
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) =>
    init?.method === "PUT" ? json({ message: "Settings were not saved." }, 500) : json(response()),
  );
  screen = await mount(
    <Notifications monitorId="monitor-1" projectId="p1" />,
    "/projects/p1/monitors/monitor-1/notifications",
  );
  await act(async () => {
    button("Save notifications").click();
  });
  await settle();
  expect(screen.container.querySelector('[role="alert"]')?.textContent).toBe(
    "Settings were not saved.",
  );
  expect(button("Save notifications").disabled).toBe(false);
});

it("shows a generated signing secret once, and never asks for it again", async () => {
  /**
   * US-096. The generate route is the only response that carries the value, so
   * the page holds it in state — a screen that could re-fetch it is a screen
   * that leaks it with a screenshot.
   */
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);

    if (init?.method === "POST") {
      return json({
        secret: "a".repeat(64),
        signingSecret: { ...instanceSecret, hint: "••••aaaa", usingInstanceSecret: false },
      });
    }

    return json(response({ webhookMissing: ["WEBHOOK_SIGNING_SECRET"] }));
  });

  screen = await mount(
    <Notifications monitorId="monitor-1" projectId="p1" />,
    "/projects/p1/monitors/monitor-1/notifications",
  );

  // Refused before there is anything to sign with.
  expect(input("Enable webhook").disabled).toBe(true);

  await act(async () => {
    button("Generate a secret").click();
  });
  await settle();

  expect(screen.container.textContent).toContain("a".repeat(64));
  expect(screen.container.textContent).toContain("Copy this now. It is not shown again.");
  // The switch is usable now, with no reload.
  expect(input("Enable webhook").disabled).toBe(false);
  // One POST, and nothing fetched the value back.
  expect(calls.filter((call) => call.includes("signing-secret"))).toEqual([
    "POST /api/notifications/signing-secret",
  ]);
});

it("warns that regenerating stops existing receivers verifying", async () => {
  vi.stubGlobal("fetch", async () =>
    json(
      response({
        signingSecret: { ...instanceSecret, hint: "••••beef", usingInstanceSecret: false },
      }),
    ),
  );

  screen = await mount(
    <Notifications monitorId="monitor-1" projectId="p1" />,
    "/projects/p1/monitors/monitor-1/notifications",
  );

  expect(screen.container.textContent).toContain("••••beef");
  expect(screen.container.textContent).toContain("Generate a new secret");
  expect(screen.container.textContent).toContain("stops every receiver configured with the old");
});

it("says why a secret cannot be stored on an instance with no encryption key", async () => {
  const blocker = "This instance has no ENCRYPTION_KEY, so a signing secret cannot be stored.";
  vi.stubGlobal("fetch", async () =>
    json(
      response({
        webhookMissing: ["WEBHOOK_SIGNING_SECRET"],
        signingSecret: {
          ...instanceSecret,
          usingInstanceSecret: false,
          canStore: false,
          storeBlocker: blocker,
        },
      }),
    ),
  );

  screen = await mount(
    <Notifications monitorId="monitor-1" projectId="p1" />,
    "/projects/p1/monitors/monitor-1/notifications",
  );

  expect(screen.container.textContent).toContain(blocker);
  expect(button("Generate a secret").disabled).toBe(true);
});
