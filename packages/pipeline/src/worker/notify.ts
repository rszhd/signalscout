import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { monitors } from "../db/schema.js";
import { recordStageRun } from "../monitors/stage-runs.js";
import {
  type NotificationTransport,
  notificationMonitorIds,
  processNotifications,
} from "../notifications/deliver.js";
import type { NotifyPayload } from "./queues.js";
import { notifyQueue } from "./queues.js";
import type { Step, StepContext } from "./steps.js";

export interface NotifyStepOptions {
  /** Where this instance answers, for the email's "open the inbox" button. US-094. */
  readonly appUrl?: string | undefined;
  /**
   * The secret an account's webhook deliveries are signed with. US-096.
   *
   * A function of the owner, because one worker process serves every account
   * and each may hold its own. Resolved per delivery rather than cached, so a
   * secret regenerated on the screen signs the next attempt — unlike the model
   * clients, which are cached for the life of the process and say so.
   */
  readonly signingSecretFor?: ((userId: string) => Promise<string | null>) | undefined;
}

export function createNotifyStep(
  transport: NotificationTransport,
  options: NotifyStepOptions = {},
): Step<NotifyPayload> {
  return async ({ monitorId, walkId }, { db, logger }) => {
    const startedAt = new Date();
    const pass = await processNotifications(db, monitorId, transport, startedAt, options);

    /**
     * A pass that did nothing writes nothing. US-201.
     *
     * Every other stage writes a row for its silent exits, and this one must
     * not: `enqueueNotifications` sweeps every monitor that has settings, on a
     * schedule, whether or not anything has matched. The dev instance holds
     * sixteen thousand of those jobs against nine polls. A row for each would
     * be a history of the sweep rather than of the monitor.
     */
    if (pass.planned === 0 && pass.sent === 0) return;

    const [monitor] = await db
      .select({ userId: monitors.userId })
      .from(monitors)
      .where(eq(monitors.id, monitorId))
      .limit(1);

    if (!monitor) return;

    try {
      await recordStageRun(db, {
        monitorId,
        userId: monitor.userId,
        stage: "notify",
        // Null on the sweep, which is the truth: `enqueueNotifications` is not
        // a stage of a collection. US-203.
        walkId: walkId ?? null,
        startedAt,
        finishedAt: new Date(),
        outcome: pass.sent > 0 ? "done" : "failed",
        itemsIn: pass.planned,
        itemsOut: pass.sent,
        detail: { stage: "notify", deliveries: pass.planned },
        // Planned and sent nothing means every channel refused or failed. The
        // outbox holds them and the next pass tries again; the row is what
        // says the attempt happened at all.
        stopReason: pass.sent > 0 ? null : "error",
      });
    } catch (cause) {
      logger.warn({ monitorId, err: cause }, "the notifier's own history row was not written");
    }
  };
}

export async function enqueueNotifications(db: Database, boss: StepContext["boss"]) {
  for (const { monitorId } of await notificationMonitorIds(db)) {
    await boss.send(notifyQueue, { monitorId, matchIds: [] }, { singletonKey: monitorId });
  }
}
