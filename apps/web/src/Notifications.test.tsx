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
function response(extra = {}) {
  return {
    settings,
    smtpMissing: [],
    webhookMissing: [],
    emailError: null,
    webhookError: null,
    nextDigestAt: null,
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
