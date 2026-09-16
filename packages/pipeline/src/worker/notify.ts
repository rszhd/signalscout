import type { Database } from "../db/client.js";
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
  return async ({ monitorId }, { db }) =>
    processNotifications(db, monitorId, transport, new Date(), options);
}

export async function enqueueNotifications(db: Database, boss: StepContext["boss"]) {
  for (const { monitorId } of await notificationMonitorIds(db)) {
    await boss.send(notifyQueue, { monitorId, matchIds: [] }, { singletonKey: monitorId });
  }
}
