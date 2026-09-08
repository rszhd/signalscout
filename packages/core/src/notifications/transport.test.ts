import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { SendMailOptions } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import { expect, it, vi } from "vitest";
import { loadNotificationEnv } from "../config/env.js";
import { createNotificationTransport, notificationReadiness } from "./transport.js";

it("reports missing SMTP settings while leaving webhooks independent", () => {
  const env = loadNotificationEnv({});
  expect(notificationReadiness(env).smtpMissing).toEqual(["SMTP_HOST", "SMTP_FROM"]);
  expect(createNotificationTransport(env).email).toBeNull();
  expect(createNotificationTransport(env).webhook).toBeNull();
});
it("sends signed JSON with a timestamp and stable delivery id and refuses redirects", async () => {
  const fetcher = vi.fn(
    async (_url: string | URL | Request, _options?: RequestInit) =>
      new Response(null, { status: 204 }),
  );
  const key = "test-signing-secret-at-least-32-characters";
  const transport = createNotificationTransport(
    loadNotificationEnv({ WEBHOOK_SIGNING_SECRET: key }),
    { fetch: fetcher, now: () => new Date("2026-09-05T00:00:00Z") },
  );
  assert(transport.webhook);
  await transport.webhook("https://receiver.example/hook", '{"version":1}', "delivery-1");
  const options = fetcher.mock.calls[0]?.[1] as RequestInit;
  expect(options.redirect).toBe("error");
  expect(options.body).toBe('{"version":1}');
  const headers = options.headers as Record<string, string>;
  expect(headers["x-signalscout-id"]).toBe("delivery-1");
  expect(headers["x-signalscout-timestamp"]).toBe("1788566400");
  expect(headers["x-signalscout-signature"]).toBe(
    `v1=${createHmac("sha256", key).update('1788566400.{"version":1}').digest("hex")}`,
  );
  fetcher.mockImplementation(async () => new Response("private receiver details", { status: 500 }));
  await expect(
    transport.webhook("https://receiver.example/hook", "{}", "delivery-1"),
  ).rejects.toThrow("Webhook delivery failed");
});
it("configures implicit TLS for Resend and sends a stable message id", async () => {
  const sendMail = vi.fn(async (_message: SendMailOptions) => ({
    accepted: ["owner@example.com"],
    rejected: [],
  }));
  const factory = vi.fn((_options: SMTPTransport.Options) => ({ sendMail }));
  const transport = createNotificationTransport(
    loadNotificationEnv({
      SMTP_HOST: "smtp.resend.com",
      SMTP_PORT: "465",
      SMTP_SECURE: "true",
      SMTP_USER: "resend",
      SMTP_PASSWORD: "test-api-key",
      SMTP_FROM: "alerts@example.com",
    }),
    { mailer: factory },
  );
  assert(transport.email);
  await transport.email("owner@example.com", "A match", "Message body", "delivery-1");
  expect(factory.mock.calls[0]?.[0]).toMatchObject({
    host: "smtp.resend.com",
    port: 465,
    secure: true,
    auth: { user: "resend", pass: "test-api-key" },
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  expect(sendMail.mock.calls[0]?.[0]).toMatchObject({
    from: "alerts@example.com",
    to: "owner@example.com",
    messageId: "<delivery-1@signalscout.local>",
    text: "Message body",
  });
});
