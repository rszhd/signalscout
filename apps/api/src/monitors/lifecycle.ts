/**
 * Changing a monitor: edit, pause, resume, the budget, and delete. US-265.
 *
 * A resume that cannot start answers 409 with the missing credential named,
 * because "check your credentials" is not a sentence anybody can act on.
 */
import {
  clearBudget,
  deleteMonitor,
  describeMissingCredentials,
  exhaustedBehaviours,
  pauseMonitor,
  resumeMonitor,
  setBudget,
  updateMonitor,
} from "@signalscout/pipeline";
import { z } from "zod";
import { ownedMonitor, sessionUserId } from "../auth.js";
import type { ApiServer } from "../server.js";
import { monitorSchema, problemSchema, updateBody } from "./schemas.js";
import {
  filterSettings,
  type MonitorContext,
  readResponse,
  replySettings,
  switchedOffSources,
} from "./shared.js";

export function registerLifecycleRoutes(app: ApiServer, context: MonitorContext): void {
  const { db, options, currentEnvironment } = context;

  app.route({
    method: "PATCH",
    url: "/api/monitors/:id",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: updateBody,
      response: { 200: monitorSchema, 404: problemSchema, 422: problemSchema },
    },
    handler: async (request, reply) => {
      if (!(await ownedMonitor(db, request, request.params.id))) {
        return reply.code(404).send({ message: "No monitor has that id." });
      }

      const off = switchedOffSources(options.sources, request.body.sources);
      if (off) return reply.code(422).send({ message: off });

      const monitor = await updateMonitor(db, request.params.id, {
        ...request.body,
        ...filterSettings(request.body),
        ...replySettings(request.body),
      });
      if (!monitor) return reply.code(404).send({ message: "No monitor has that id." });

      return readResponse(db, monitor, await currentEnvironment(sessionUserId(request)));
    },
  });

  app.route({
    method: "POST",
    url: "/api/monitors/:id/pause",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: { 200: monitorSchema, 404: problemSchema },
    },
    handler: async (request, reply) => {
      if (!(await ownedMonitor(db, request, request.params.id))) {
        return reply.code(404).send({ message: "No monitor has that id." });
      }

      const monitor = await pauseMonitor(db, request.params.id);
      if (!monitor) return reply.code(404).send({ message: "No monitor has that id." });

      return readResponse(db, monitor, await currentEnvironment(sessionUserId(request)));
    },
  });

  app.route({
    method: "POST",
    url: "/api/monitors/:id/resume",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: { 200: monitorSchema, 404: problemSchema, 409: problemSchema },
    },
    handler: async (request, reply) => {
      // Read now, not at boot. A key stored on the connections screen a moment
      // ago is what makes this resume the one that succeeds.
      const runtime = await currentEnvironment(sessionUserId(request));

      if (!(await ownedMonitor(db, request, request.params.id))) {
        return reply.code(404).send({ message: "No monitor has that id." });
      }

      const result = await resumeMonitor(db, request.params.id, runtime);
      if (!result) return reply.code(404).send({ message: "No monitor has that id." });

      if (result.status === "blocked") {
        // "and" inside one provider, "or" between providers. A platform two
        // providers fetch needs one account, and a sentence that joined them
        // with "and" would send a person to open the second one.
        const names = describeMissingCredentials(result.missing);

        return reply.code(409).send({
          message:
            `This monitor cannot start until ${names} ` +
            `${result.missing.length === 1 ? "is" : "are"} set.`,
          missingCredentials: [...result.missing],
        });
      }

      return readResponse(db, result.monitor, runtime);
    },
  });

  /**
   * Set this monitor's monthly cap, or replace the one it has.
   *
   * `PUT`, because one monitor has one budget and sending it twice must leave
   * one cap. The amount is micro-dollars, the unit the whole product counts
   * in; the screen turns what a person typed in dollars into this.
   *
   * A cap of zero is allowed. "This monitor may spend nothing" is a real thing
   * to ask for, and it is the fastest way to stop a monitor billing while
   * keeping everything it has already collected.
   */
  app.route({
    method: "PUT",
    url: "/api/monitors/:id/budget",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({
        monthlyCapMicros: z.number().int().min(0),
        onExhausted: z.enum(exhaustedBehaviours).default("pause"),
      }),
      response: { 200: monitorSchema, 404: problemSchema },
    },
    handler: async (request, reply) => {
      const monitor = await ownedMonitor(db, request, request.params.id);
      if (!monitor) return reply.code(404).send({ message: "No monitor has that id." });

      await setBudget(db, monitor.id, request.body);

      return readResponse(db, monitor, await currentEnvironment(sessionUserId(request)));
    },
  });

  /**
   * Remove the cap. The recorded usage stays.
   *
   * Deleting the spend with the cap would erase the answer to "what did this
   * month cost", which is the question the ledger exists to answer. A monitor
   * with no cap goes on recording every unit it spends.
   *
   * This does not resume a monitor the cap paused. Removing a limit and
   * starting to spend again are two decisions, and the second one is a
   * person's.
   */
  app.route({
    method: "DELETE",
    url: "/api/monitors/:id/budget",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: { 200: monitorSchema, 404: problemSchema },
    },
    handler: async (request, reply) => {
      const monitor = await ownedMonitor(db, request, request.params.id);
      if (!monitor) return reply.code(404).send({ message: "No monitor has that id." });

      await clearBudget(db, monitor.id);

      return readResponse(db, monitor, await currentEnvironment(sessionUserId(request)));
    },
  });

  app.route({
    method: "DELETE",
    url: "/api/monitors/:id",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: { 204: z.null(), 404: problemSchema },
    },
    handler: async (request, reply) => {
      if (!(await ownedMonitor(db, request, request.params.id))) {
        return reply.code(404).send({ message: "No monitor has that id." });
      }

      const deleted = await deleteMonitor(db, request.params.id);
      if (!deleted) return reply.code(404).send({ message: "No monitor has that id." });

      return reply.code(204).send(null);
    },
  });
}
