import { createHmac } from "node:crypto";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import type { NotificationEnv } from "../config/env.js";
import { assertPublicHost, type ResolveHost, resolveHost } from "./address-guard.js";
import type { NotificationTransport } from "./deliver.js";

/**
 * What this deployment cannot do yet, as the list of variables to set.
 *
 * `hasAccountSecret` is US-096: an account with a signing secret of its own can
 * enable a webhook on an instance whose environment has none, so the answer is
 * per account and not per instance. Absent means "ask about the instance
 * alone", which is what a caller describing the build rather than a person
 * wants.
 */
export function notificationReadiness(env: NotificationEnv, hasAccountSecret = false) {
  const smtpMissing: string[] = [];
  if (!env.SMTP_HOST) smtpMissing.push("SMTP_HOST");
  if (!env.SMTP_FROM) smtpMissing.push("SMTP_FROM");
  if (env.SMTP_USER && !env.SMTP_PASSWORD) smtpMissing.push("SMTP_PASSWORD");
  if (env.SMTP_PASSWORD && !env.SMTP_USER) smtpMissing.push("SMTP_USER");
  return {
    smtpMissing,
    webhookMissing:
      hasAccountSecret || env.WEBHOOK_SIGNING_SECRET ? [] : ["WEBHOOK_SIGNING_SECRET"],
  };
}

interface TransportOptions {
  fetch?: typeof fetch;
  /**
   * Whether a webhook may reach an address inside this machine's network.
   * US-097.
   *
   * False on a self-hosted instance, where the network is the owner's own and a
   * receiver on it is the normal case — refusing it would break a working
   * deployment on upgrade. True where signup is open: a tenant choosing an
   * internal address there has a trusted process fetch it for them.
   */
  guardAddresses?: boolean;
  /** How a hostname becomes addresses. Injected so a test needs no DNS. */
  resolveHost?: ResolveHost;
  now?: () => Date;
  mailer?: (
    options: SMTPTransport.Options,
  ) => Pick<ReturnType<typeof nodemailer.createTransport>, "sendMail">;
}

export function createNotificationTransport(
  env: NotificationEnv,
  options: TransportOptions = {},
): NotificationTransport {
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
  const resolve = options.resolveHost ?? resolveHost;
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
    /**
     * Always present, and the secret arrives with the delivery. US-096.
     *
     * It used to be captured once at worker start, which made "can this
     * instance sign?" a property of the process. It is a property of the
     * **account** now — one may hold its own secret on an instance whose
     * environment has none — so the caller resolves it per delivery and this
     * function refuses when there is nothing to sign with.
     */
    webhook: async (url, body, id, signingSecret) => {
      if (!signingSecret) throw new Error("Webhook signing is unavailable");

      const timestamp = String(Math.floor((options.now?.() ?? new Date()).getTime() / 1000));
      const signature = createHmac("sha256", signingSecret)
        .update(`${timestamp}.${body}`)
        .digest("hex");
      let parsed: URL;

      try {
        parsed = new URL(url);
        if (parsed.protocol !== "https:" || parsed.username || parsed.password)
          throw new Error("Invalid URL");
      } catch {
        throw new Error("Webhook delivery failed");
      }

      /**
       * Refused before the request, and outside the catch below. US-097.
       *
       * A private address is a decision about the URL and not a receiver that
       * went down, and the two send a person to different places — so this
       * error keeps its own words rather than becoming the generic "Webhook
       * delivery failed".
       */
      if (options.guardAddresses) await assertPublicHost(parsed.hostname, resolve);

      try {
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
    },
  };
}
