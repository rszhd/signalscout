/**
 * Correctness-critical: duplicate delivery and hidden content leaving the app.
 * notifications.test.ts pins concurrent planning and visibility on every retry.
 *
 * Durable planning and bounded delivery retries. The settings row lock serializes
 * planners and senders across processes. A crash after acceptance but before
 * commit can still duplicate a send: receivers deduplicate the delivery id.
 */
import { and, asc, eq, gte, inArray, lt, lte, notExists, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import {
  notificationDeliveries as deliveries,
  notificationItems as items,
  matches,
  monitors,
  posts,
  notificationSettings as settings,
} from "../db/schema.js";
import { PrivateAddressError } from "./address-guard.js";
import { matchEmail } from "./match-email.js";

export interface NotificationTransport {
  email:
    | ((
        to: string,
        subject: string,
        text: string,
        id: string,
        /** The dressed version. US-094. Absent means send the text alone. */
        html?: string,
      ) => Promise<void>)
    | null;
  /**
   * Post one delivery, signed with the secret the caller resolved. US-096.
   *
   * The secret is an argument rather than something the transport captured at
   * startup, because it belongs to the **account** now: one may hold its own on
   * an instance whose environment has none, and every account on a hosted
   * instance must not sign with the same value. Null or undefined means nothing
   * can sign this one, and the transport refuses rather than sending unsigned.
   */
  webhook: (url: string, body: string, id: string, signingSecret: string | null) => Promise<void>;
}

export async function processNotifications(
  db: Database,
  monitorId: string,
  transport: NotificationTransport,
  now = new Date(),
  {
    appUrl,
    signingSecretFor,
  }: {
    /**
     * Where this instance answers, for the "open the inbox" button. US-094.
     *
     * Optional, and the template renders without it. `APP_URL` is required only
     * for Stripe, so a self-hosted deployment may not have set one — and a
     * button pointing nowhere is worse than no button. A match still links to
     * its own post, which needs nothing configured.
     */
    readonly appUrl?: string | undefined;
    /**
     * The secret this account's webhook deliveries are signed with. US-096.
     *
     * Injected rather than read here, because resolving it needs the encryption
     * key and the process environment, and neither belongs in a file that
     * writes delivery rows. Absent means no webhook can be signed, which is the
     * state every caller before US-096 was in when the environment had no
     * secret.
     */
    readonly signingSecretFor?: ((userId: string) => Promise<string | null>) | undefined;
  } = {},
) {
  // Commit the outbox before calling a remote service. A crash during delivery
  // leaves the original delivery id available to the next attempt.
  await db.transaction(async (tx) => {
    const [config] = await tx
      .select()
      .from(settings)
      .where(eq(settings.monitorId, monitorId))
      .for("update");
    if (!config) return;
    const digestDue = config.nextDigestAt <= now;
    for (const channel of ["email", "webhook"] as const) {
      if (channel === "email" ? !config.emailEnabled : !config.webhookEnabled) continue;
      const kinds = channel === "email" ? (["match", "digest"] as const) : [config.webhookMode];
      for (const kind of kinds) {
        if (kind === "digest" && !digestDue) continue;
        const floor =
          channel === "email" && kind === "match" ? config.immediateScore : config.minScore;
        if (floor === null) continue;
        const rows = await tx
          .select({ id: matches.id })
          .from(matches)
          .where(
            and(
              eq(matches.monitorId, monitorId),
              eq(matches.hidden, false),
              gte(matches.score, floor),
              gte(matches.createdAt, config.enabledSince),
              lt(matches.createdAt, now),
              notExists(
                tx
                  .select({ id: items.matchId })
                  .from(items)
                  .where(
                    and(
                      eq(items.matchId, matches.id),
                      eq(items.channel, channel),
                      eq(items.kind, kind),
                    ),
                  ),
              ),
            ),
          )
          .orderBy(asc(matches.createdAt), asc(matches.id));
        // Bound a single message. A large digest is several numbered deliveries,
        // each with its own receipt and retry state.
        const size = kind === "match" ? 1 : 100;
        for (let offset = 0; offset < rows.length; offset += size) {
          const [delivery] = await tx
            .insert(deliveries)
            .values({
              monitorId,
              revision: config.revision,
              channel,
              kind,
              createdAt: now,
              nextAttemptAt: now,
            })
            .returning();
          if (!delivery) throw new Error("Notification delivery was not created.");
          await tx
            .insert(items)
            .values(
              rows
                .slice(offset, offset + size)
                .map((row) => ({ deliveryId: delivery.id, matchId: row.id, channel, kind })),
            );
        }
      }
    }
    // Plan even when a transport is unavailable. The pending outbox preserves
    // that channel's digest without changing the other channel's interval.
    if (digestDue) {
      await tx
        .update(settings)
        .set({ nextDigestAt: new Date(now.getTime() + config.digestHours * 3_600_000) })
        .where(eq(settings.monitorId, monitorId));
    }
  });

  const availableChannels = (["email", "webhook"] as const).filter(
    (channel) => transport[channel] !== null,
  );
  if (!availableChannels.length) return;
  for (let count = 0; count < 50; count++) {
    const worked = await db.transaction(async (tx) => {
      const [config] = await tx
        .select()
        .from(settings)
        .where(eq(settings.monitorId, monitorId))
        .for("update");
      if (!config) return false;
      const [delivery] = await tx
        .select()
        .from(deliveries)
        .where(
          and(
            eq(deliveries.monitorId, monitorId),
            eq(deliveries.status, "pending"),
            inArray(deliveries.channel, availableChannels),
            lte(deliveries.nextAttemptAt, now),
          ),
        )
        .orderBy(asc(deliveries.nextAttemptAt), asc(deliveries.id))
        .limit(1)
        .for("update");
      if (!delivery) return false;
      const enabled = delivery.channel === "email" ? config.emailEnabled : config.webhookEnabled;
      if (delivery.revision !== config.revision || !enabled) {
        await tx
          .update(deliveries)
          .set({ status: "skipped" })
          .where(eq(deliveries.id, delivery.id));
        return true;
      }
      const sender = transport[delivery.channel];
      if (!sender) {
        await tx
          .update(deliveries)
          .set({ nextAttemptAt: new Date(now.getTime() + 60_000) })
          .where(eq(deliveries.id, delivery.id));
        return true;
      }
      const [monitor] = await tx
        // The owner comes back too, because a webhook is signed with *their*
        // secret now and not the instance's. US-096.
        .select({ name: monitors.name, userId: monitors.userId })
        .from(monitors)
        .where(eq(monitors.id, monitorId));
      if (!monitor) return false;
      const selected = await tx
        .select({
          id: matches.id,
          score: matches.score,
          reasons: matches.reasons,
          source: posts.source,
          url: posts.url,
          excerpt: posts.excerpt,
          author: posts.author,
          postedAt: posts.postedAt,
        })
        .from(items)
        .innerJoin(matches, eq(items.matchId, matches.id))
        .innerJoin(posts, eq(matches.postId, posts.id))
        .where(
          and(
            eq(items.deliveryId, delivery.id),
            eq(matches.monitorId, monitorId),
            eq(matches.hidden, false),
          ),
        )
        .orderBy(asc(matches.createdAt), asc(matches.id));
      if (!selected.length) {
        await tx
          .update(deliveries)
          .set({ status: "skipped" })
          .where(eq(deliveries.id, delivery.id));
        return true;
      }
      const payload = {
        version: 1,
        id: delivery.id,
        type: delivery.kind === "digest" ? "matches.digest" : "match.created",
        createdAt: delivery.createdAt.toISOString(),
        monitor: { id: monitorId, name: monitor.name },
        matches: selected,
      };
      // US-094. The subject and the plain text are what they always were —
      // somebody's mail filter is written against that subject — and the HTML
      // is built beside them.
      const { subject, text, html } = matchEmail({
        monitorName: monitor.name,
        matches: selected,
        kind: delivery.kind === "digest" ? "digest" : "match",
        appUrl,
        now,
      });
      const attempts = delivery.attempts + 1;
      try {
        if (delivery.channel === "email") {
          if (!transport.email) throw new Error("SMTP is unavailable");
          await transport.email(config.emailTo, subject, text, delivery.id, html);
        } else {
          // Resolved per delivery, so a secret regenerated on the screen
          // signs the next attempt. The transport refuses a null rather than
          // sending something no receiver can verify.
          const secret = signingSecretFor ? await signingSecretFor(monitor.userId) : null;
          await transport.webhook(config.webhookUrl, JSON.stringify(payload), delivery.id, secret);
        }
      } catch (error) {
        /**
         * One error is kept in full, and every other one is not. US-097.
         *
         * A refused address is **our** sentence about the URL somebody typed,
         * so it carries no provider text and a person can act on it: the
         * receiver is not down, the address is not allowed. Anything else is
         * discarded, because a provider's own words can echo passwords, signed
         * URLs, message content or an SMTP authentication response.
         */
        const refusedAddress = error instanceof PrivateAddressError ? error.message : null;

        // Do not retain provider text or errors: these can echo passwords,
        // signed URLs, message content, or SMTP authentication responses.
        await tx
          .update(deliveries)
          .set({
            attempts,
            status: attempts >= 5 ? "failed" : "pending",
            nextAttemptAt: new Date(now.getTime() + 30_000 * 2 ** (attempts - 1)),
          })
          .where(eq(deliveries.id, delivery.id));
        if (delivery.channel === "webhook") {
          const failures = config.webhookFailures + 1;
          const disabled = failures >= 5 || attempts >= 5;
          await tx
            .update(settings)
            .set({
              webhookFailures: failures,
              webhookEnabled: !disabled,
              webhookError:
                refusedAddress ??
                (disabled
                  ? "Webhook disabled after repeated delivery failures. Check the receiver, then save settings to enable it again."
                  : "Webhook delivery failed. A retry is scheduled."),
            })
            .where(eq(settings.monitorId, monitorId));
        } else {
          await tx
            .update(settings)
            .set({
              emailError:
                attempts >= 5
                  ? "Email delivery failed after five attempts. Check SMTP settings; this delivery will not be retried."
                  : "Email delivery failed. A retry is scheduled.",
            })
            .where(eq(settings.monitorId, monitorId));
        }
        return true;
      }
      await tx
        .update(deliveries)
        .set({ status: "sent", attempts, sentAt: now })
        .where(eq(deliveries.id, delivery.id));
      await tx
        .update(settings)
        .set(
          delivery.channel === "email"
            ? { emailError: null }
            : { webhookError: null, webhookFailures: 0 },
        )
        .where(eq(settings.monitorId, monitorId));
      return true;
    });
    if (!worked) break;
  }
}

/** Sweep settings too: a lost classify-to-notify enqueue must not lose a match. */
export async function notificationMonitorIds(db: Database) {
  return db
    .select({ monitorId: settings.monitorId })
    .from(settings)
    .where(
      sql`${settings.emailEnabled} OR ${settings.webhookEnabled} OR EXISTS (SELECT 1 FROM notification_deliveries d WHERE d.monitor_id = ${settings.monitorId} AND d.status = 'pending')`,
    );
}
