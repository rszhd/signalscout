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

export interface NotificationTransport {
  email: ((to: string, subject: string, text: string, id: string) => Promise<void>) | null;
  webhook: ((url: string, body: string, id: string) => Promise<void>) | null;
}

export async function processNotifications(
  db: Database,
  monitorId: string,
  transport: NotificationTransport,
  now = new Date(),
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
        .select({ name: monitors.name })
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
      const subject = `IntentWatch: ${selected.length} ${selected.length === 1 ? "match" : "matches"} for ${monitor.name}`;
      const text = `${subject}\n\n${selected.map((row) => `Score: ${row.score}\n${row.excerpt}\n${row.reasons.join("\n")}\n${row.url}`).join("\n\n")}\n`;
      const attempts = delivery.attempts + 1;
      try {
        if (delivery.channel === "email") {
          if (!transport.email) throw new Error("SMTP is unavailable");
          await transport.email(config.emailTo, subject, text, delivery.id);
        } else {
          if (!transport.webhook) throw new Error("Webhook signing is unavailable");
          await transport.webhook(config.webhookUrl, JSON.stringify(payload), delivery.id);
        }
      } catch {
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
              webhookError: disabled
                ? "Webhook disabled after repeated delivery failures. Check the receiver, then save settings to enable it again."
                : "Webhook delivery failed. A retry is scheduled.",
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
