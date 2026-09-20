/**
 * One monitor's reads: the row, and what its polls did. US-265.
 */
import { maxPollRunsRead, readPollRuns } from "@signalscout/pipeline";
import { z } from "zod";
import { ownedMonitor, sessionUserId } from "../auth.js";
import type { ApiServer } from "../server.js";
import { monitorSchema, pollRunSchema, problemSchema, toPollRunResponse } from "./schemas.js";
import { type MonitorContext, readResponse } from "./shared.js";

export function registerDetailRoutes(app: ApiServer, context: MonitorContext): void {
  const { db, currentEnvironment } = context;

  app.route({
    method: "GET",
    url: "/api/monitors/:id",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: { 200: monitorSchema, 404: problemSchema },
    },
    handler: async (request, reply) => {
      const monitor = await ownedMonitor(db, request, request.params.id);
      if (!monitor) return reply.code(404).send({ message: "No monitor has that id." });

      return readResponse(db, monitor, await currentEnvironment(sessionUserId(request)));
    },
  });

  /**
   * What this monitor's recent polls did. US-104.
   *
   * Its own route rather than more fields on the monitor, because the list
   * screen wants one poll per monitor and this screen wants many polls of one
   * monitor. `lastPoll` on the monitor answers the first; this answers the
   * second, and only when somebody asks.
   *
   * A monitor that is not this account's answers 404 and not an empty list.
   * The two are different sentences, and `readPollRuns` cannot tell them apart
   * on purpose — it answers with nothing either way — so the check is here,
   * where the reply is chosen.
   */
  app.route({
    method: "GET",
    url: "/api/monitors/:id/polls",
    schema: {
      params: z.object({ id: z.uuid() }),
      querystring: z.object({
        limit: z.coerce.number().int().min(1).max(maxPollRunsRead).optional(),
      }),
      response: { 200: z.array(pollRunSchema), 404: problemSchema },
    },
    handler: async (request, reply) => {
      if (!(await ownedMonitor(db, request, request.params.id))) {
        return reply.code(404).send({ message: "No monitor has that id." });
      }

      const runs = await readPollRuns(
        db,
        sessionUserId(request),
        request.params.id,
        request.query.limit ?? maxPollRunsRead,
      );

      return runs.map(toPollRunResponse);
    },
  });
}
