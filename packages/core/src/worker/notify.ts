import type { Database } from "../db/client.js";
import {
  type NotificationTransport,
  notificationMonitorIds,
  processNotifications,
} from "../notifications/deliver.js";
import type { NotifyPayload } from "./queues.js";
import { notifyQueue } from "./queues.js";
import type { Step, StepContext } from "./steps.js";

export function createNotifyStep(transport: NotificationTransport): Step<NotifyPayload> {
  return async ({ monitorId }, { db }) => processNotifications(db, monitorId, transport);
}

export async function enqueueNotifications(db: Database, boss: StepContext["boss"]) {
  for (const { monitorId } of await notificationMonitorIds(db)) {
    await boss.send(notifyQueue, { monitorId, matchIds: [] }, { singletonKey: monitorId });
  }
}
