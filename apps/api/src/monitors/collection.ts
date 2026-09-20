/**
 * The list, and creating a monitor. US-265.
 *
 * The list reads every count in bulk, one statement per kind, because a query
 * per card is the shape that reads fine with three monitors and stops the
 * page with thirty.
 */
import {
  budgetStates,
  checkBudget,
  classifiedPostCounts,
  createMonitor,
  filterDropCounts,
  lastCollections,
  latestPollRuns,
  listMonitors,
  matchCounts,
  noFilterDrops,
  noMatchCounts,
  notificationIssues,
  noVerdicts,
  setBudget,
  verdictCounts,
} from "@signalscout/pipeline";
import { z } from "zod";
import { sessionUser, sessionUserId } from "../auth.js";
import type { ApiServer } from "../server.js";
import { createBody, monitorSchema, problemSchema } from "./schemas.js";
import {
  filterSettings,
  type MonitorContext,
  readResponse,
  replySettings,
  switchedOffSources,
  toResponse,
} from "./shared.js";

export function registerCollectionRoutes(app: ApiServer, context: MonitorContext): void {
  const { db, options, currentEnvironment } = context;

  app.route({
    method: "GET",
    url: "/api/monitors",
    schema: { response: { 200: z.array(monitorSchema) } },
    handler: async (request) => {
      const runtime = await currentEnvironment(sessionUserId(request));

      // One read for every monitor's spend, rather than one per row. The
      // screen that shows this is a list, and a per-row query here would be
      // the list's cost growing with the number of monitors.
      const rows = await listMonitors(db, sessionUserId(request));
      const [states, drops, read, verdicts, found, collected, notifications, polls] =
        await Promise.all([
          budgetStates(db),
          filterDropCounts(db),
          classifiedPostCounts(db),
          verdictCounts(db),
          // One statement for every row's match count, for the reason the
          // spend above is one. US-109.
          matchCounts(db),
          lastCollections(db),
          notificationIssues(db),
          // One statement for the whole list, for the reason the spend above is
          // one: a query per card is the shape that reads fine with three
          // monitors and stops the page with thirty.
          latestPollRuns(
            db,
            sessionUserId(request),
            rows.map((monitor) => monitor.id),
          ),
        ]);

      return Promise.all(
        rows.map(async (monitor) =>
          // A monitor created between the two reads is not in the map. Its
          // spend is read on its own rather than defaulted to zero: this is a
          // bill page, and a zero nothing measured is the failure US-013 is
          // about. A missing drop count is different — it means this monitor
          // has dropped nothing, which is what zero says.
          toResponse(monitor, runtime, {
            state: states.get(monitor.id) ?? (await checkBudget(db, monitor.id)),
            dropped: drops.get(monitor.id) ?? noFilterDrops,
            read: read.get(monitor.id) ?? 0,
            verdicts: verdicts.get(monitor.id) ?? noVerdicts,
            matches: found.get(monitor.id) ?? noMatchCounts,
            collected: collected.get(monitor.id) ?? [],
            notificationProblems: notifications.get(monitor.id) ?? [],
            lastPoll: polls.get(monitor.id) ?? null,
          }),
        ),
      );
    },
  });

  app.route({
    method: "POST",
    url: "/api/monitors",
    schema: {
      body: createBody,
      response: { 201: monitorSchema, 422: problemSchema },
    },
    handler: async (request, reply) => {
      const off = switchedOffSources(options.sources, request.body.sources);
      if (off) return reply.code(422).send({ message: off });

      const person = sessionUser(request);
      const runtime = await currentEnvironment(person.id);

      const { monitor, missing } = await createMonitor(
        db,
        {
          ...request.body,
          ...filterSettings(request.body),
          ...replySettings(request.body),
          userId: person.id,
        },
        {
          ...runtime,
          // US-093. A monitor is told how to reach its owner as it is created,
          // rather than staying silent until somebody visits a screen they
          // have no reason to visit. The rule is in core; these are its two
          // inputs.
          notificationDefaults: {
            canSendEmail: options.canSendEmail === true,
            emailTo: person.email,
          },
        },
      );

      if (request.body.budget) await setBudget(db, monitor.id, request.body.budget);

      if (missing.length > 0) {
        // Created, and paused, because four answers somebody just typed are
        // not thrown away over a key they can paste in a minute. The response
        // says which one, and the monitor stays off until it is set.
        request.log.warn(
          { monitorId: monitor.id, missing: missing.map((one) => one.environmentVariable) },
          "monitor created but not started: a credential is missing",
        );
      }

      return reply.code(201).send(await readResponse(db, monitor, runtime));
    },
  });
}
