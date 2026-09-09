import { createHmac } from "node:crypto";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import type { NotificationEnv } from "../config/env.js";
import type { NotificationTransport } from "./deliver.js";

export function notificationReadiness(env: NotificationEnv) {
  const smtpMissing: string[] = [];
  if (!env.SMTP_HOST) smtpMissing.push("SMTP_HOST");
  if (!env.SMTP_FROM) smtpMissing.push("SMTP_FROM");
  if (env.SMTP_USER && !env.SMTP_PASSWORD) smtpMissing.push("SMTP_PASSWORD");
  if (env.SMTP_PASSWORD && !env.SMTP_USER) smtpMissing.push("SMTP_USER");
  return {
    smtpMissing,
    webhookMissing: env.WEBHOOK_SIGNING_SECRET ? [] : ["WEBHOOK_SIGNING_SECRET"],
  };
}

interface TransportOptions {
  fetch?: typeof fetch;
  now?: () => Date;
  mailer?: (
    options: SMTPTransport.Options,
  ) => Pick<ReturnType<typeof nodemailer.createTransport>, "sendMail">;
}

export function createNotificationTransport(
  env: NotificationEnv,
  options: TransportOptions = {},
): NotificationTransport {
  const signingSecret = env.WEBHOOK_SIGNING_SECRET;
  const readiness = notificationReadiness(env);
  const mailer = readiness.smtpMissing.length
    ? null
    : (options.mailer ?? nodemailer.createTransport)({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        requireTLS: !env.SMTP_SECURE,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
  const fetcher = options.fetch ?? globalThis.fetch;
  return {
    email: mailer
      ? async (to, subject, text, id, html) => {
          try {
            const result = await mailer.sendMail({
              from: env.SMTP_FROM,
              to,
              subject,
              // Both parts, never one. US-094: the text is the message and the
              // HTML is a presentation of it, so a text-only client and a
              // screen reader lose nothing, and a multipart message scores
              // better with a spam filter than an HTML-only one.
              text,
              ...(html === undefined ? {} : { html }),
              messageId: `<${id}@signalscout.local>`,
            });
            if (!result.accepted?.length || result.rejected?.length)
              throw new Error("Recipient rejected");
          } catch {
            throw new Error("SMTP delivery failed");
          }
        }
      : null,
    webhook: signingSecret
      ? async (url, body, id) => {
          const timestamp = String(Math.floor((options.now?.() ?? new Date()).getTime() / 1000));
          const signature = createHmac("sha256", signingSecret)
            .update(`${timestamp}.${body}`)
            .digest("hex");
          try {
            const parsed = new URL(url);
            if (parsed.protocol !== "https:" || parsed.username || parsed.password)
              throw new Error("Invalid URL");
            const response = await fetcher(url, {
              method: "POST",
              body,
              redirect: "error",
              signal: AbortSignal.timeout(15_000),
              headers: {
                "content-type": "application/json",
                "x-signalscout-id": id,
                "x-signalscout-timestamp": timestamp,
                "x-signalscout-signature": `v1=${signature}`,
              },
            });
            await response.body?.cancel();
            if (!response.ok) throw new Error("Receiver rejected the delivery");
          } catch {
            throw new Error("Webhook delivery failed");
          }
        }
      : null,
  };
}
