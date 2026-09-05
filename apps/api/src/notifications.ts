import {
  type Database,
  getMonitor,
  type NotificationEnv,
  notificationDefaults,
  notificationInputSchema,
  notificationReadiness,
  readNotificationSettings,
  saveNotificationSettings,
} from "@intentwatch/core";
import { z } from "zod";
import type { ApiServer } from "./server.js";

export async function registerNotificationRoutes(
  app: ApiServer,
  { db, env }: { db: Database; env: NotificationEnv },
) {
  const params = z.object({ id: z.uuid() });
  const problem = z.object({ message: z.string() });
  const response = z.object({
    settings: notificationInputSchema,
    smtpMissing: z.array(z.string()),
    webhookMissing: z.array(z.string()),
    emailError: z.string().nullable(),
    webhookError: z.string().nullable(),
    nextDigestAt: z.string().nullable(),
  });
  async function read(id: string) {
    const row = await readNotificationSettings(db, id);
    return {
      settings: notificationInputSchema.parse(row ?? notificationDefaults),
      ...notificationReadiness(env),
      emailError: row?.emailError ?? null,
      webhookError: row?.webhookError ?? null,
      nextDigestAt: row?.nextDigestAt.toISOString() ?? null,
    };
  }
  app.route({
    method: "GET",
    url: "/api/monitors/:id/notifications",
    schema: { params, response: { 200: response, 404: problem } },
    handler: async (request, reply) => {
      if (!(await getMonitor(db, request.params.id)))
        return reply.code(404).send({ message: "No monitor has that id." });
      return read(request.params.id);
    },
  });
  app.route({
    method: "PUT",
    url: "/api/monitors/:id/notifications",
    schema: {
      params,
      body: notificationInputSchema,
      response: { 200: response, 404: problem, 409: problem },
    },
    handler: async (request, reply) => {
      if (!(await getMonitor(db, request.params.id)))
        return reply.code(404).send({ message: "No monitor has that id." });
      const ready = notificationReadiness(env);
      const missing = [
        ...(request.body.emailEnabled ? ready.smtpMissing : []),
        ...(request.body.webhookEnabled ? ready.webhookMissing : []),
      ];
      if (missing.length)
        return reply.code(409).send({
          message: `Set ${missing.join(", ")} and restart the API and worker before enabling notifications.`,
        });
      await saveNotificationSettings(db, request.params.id, request.body);
      return read(request.params.id);
    },
  });
}
