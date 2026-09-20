/**
 * One monitor's reads: the row, and what its polls did. US-265.
 */
import {
  maxPollRunsRead,
  maxStageRunsRead,
  queryPerformance,
  readPollRuns,
  readStageRuns,
  stageRuns,
} from "@signalscout/pipeline";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ownedMonitor, sessionUserId } from "../auth.js";
import { leadsOf } from "../leads.js";
import type { ApiServer } from "../server.js";
import {
  activityPageSchema,
  monitorSchema,
  pollRunSchema,
  problemSchema,
  toPollRunResponse,
  toStageRunResponse,
} from "./schemas.js";
import { type MonitorContext, readResponse } from "./shared.js";

const leadGroupSchema = z.object({
  value: z.string(),
  label: z.string(),
  source: z.string().nullable(),
  matches: z.number(),
  averageScore: z.number(),
  bestScore: z.number(),
  strong: z.number(),
});

const leadsSchema = z.object({
  floor: z.number(),
  platforms: z.array(leadGroupSchema),
  channels: z.array(leadGroupSchema),
  kinds: z.array(leadGroupSchema),
  intents: z.array(leadGroupSchema),
});

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

  /**
   * Everything this monitor has done, in one list. US-266.
   *
   * The polls and the stages after them, merged and ordered by time, because
   * that is how a person reads a history: the poll collected 72 posts, the
   * filter kept 12 of them, the classifier matched 3, the notifier sent 1.
   * Read as two lists on two screens, those four facts are four separate
   * questions.
   *
   * Merged here and not in the browser. Two requests would render half a
   * history while the other half was in flight, and the page would reorder
   * itself under somebody reading it.
   *
   * `before` pages it: the screen hands back the oldest `at` it holds. Each
   * table is asked for a whole page past that cursor, because either kind may
   * fill the top of a page — a monitor that has just polled four times has no
   * stage rows yet, and one classifying a backlog has little else — and the
   * merged page is cut to `limit`. `more` is true when either table had a row
   * beyond the cut.
   *
   * The two tables keep different amounts: `poll_runs` holds 200 rows per
   * monitor and `stage_runs` holds 800. So the bottom of a long list thins out
   * to polls alone rather than ending. `stagesRecordedSince` is where that
   * happens, so the screen can say the stages are gone rather than absent.
   */
  app.route({
    method: "GET",
    url: "/api/monitors/:id/activity",
    schema: {
      params: z.object({ id: z.uuid() }),
      querystring: z.object({
        limit: z.coerce.number().int().min(1).max(maxStageRunsRead).optional(),
        before: z.iso.datetime().optional(),
      }),
      response: { 200: activityPageSchema, 404: problemSchema },
    },
    handler: async (request, reply) => {
      if (!(await ownedMonitor(db, request, request.params.id))) {
        return reply.code(404).send({ message: "No monitor has that id." });
      }

      const limit = request.query.limit ?? maxStageRunsRead;
      const before = request.query.before ? new Date(request.query.before) : undefined;
      const userId = sessionUserId(request);

      const [polls, stages, [floor]] = await Promise.all([
        readPollRuns(db, userId, request.params.id, Math.min(limit, maxPollRunsRead), before),
        readStageRuns(db, userId, request.params.id, limit, before),
        db
          .select({ since: sql<Date | null>`min(${stageRuns.startedAt})` })
          .from(stageRuns)
          .where(and(eq(stageRuns.monitorId, request.params.id), eq(stageRuns.userId, userId))),
      ]);

      const entries = [
        ...polls.map((run) => ({
          kind: "poll" as const,
          at: run.startedAt.toISOString(),
          poll: toPollRunResponse(run),
        })),
        ...stages.map((run) => ({
          kind: "stage" as const,
          at: run.startedAt.toISOString(),
          stage: toStageRunResponse(run),
        })),
      ].sort((left, right) => right.at.localeCompare(left.at));

      const since = floor?.since ? new Date(floor.since) : null;

      return {
        entries: entries.slice(0, limit),
        stagesRecordedSince: since ? since.toISOString() : null,
        more:
          entries.length > limit ||
          polls.length >= Math.min(limit, maxPollRunsRead) ||
          stages.length >= limit,
      };
    },
  });

  /**
   * Which of this monitor's phrases and channels earn their keep. US-267.
   *
   * Its own route rather than fields on the monitor, for the reason the polls
   * route is its own: the list screen wants one line per monitor and this
   * wants one line per input of one monitor. It is read when somebody asks.
   *
   * An input a monitor searches but that has never returned a post is not
   * here, because the rows are written by what came back. The screen holds the
   * monitor's own query plan, so it can show a phrase with nothing beside it
   * and say so — which is the answer a person acts on.
   *
   * The floor is in the answer. Every count of matches is at or above the
   * monitor's `min_score`, and a statistic nobody can reproduce is worse than
   * no statistic.
   */
  app.route({
    method: "GET",
    url: "/api/monitors/:id/queries",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: {
        200: z.object({
          floor: z.number(),
          inputs: z.array(
            z.object({
              kind: z.enum(["query", "channel"]),
              value: z.string(),
              posts: z.number(),
              matches: z.number(),
              bestScore: z.number().nullable(),
              lastFoundAt: z.string().nullable(),
              lastMatchedAt: z.string().nullable(),
            }),
          ),
        }),
        404: problemSchema,
      },
    },
    handler: async (request, reply) => {
      const monitor = await ownedMonitor(db, request, request.params.id);
      if (!monitor) return reply.code(404).send({ message: "No monitor has that id." });

      const inputs = await queryPerformance(db, sessionUserId(request), request.params.id);

      return {
        floor: monitor.minScore,
        inputs: inputs.map((input) => ({
          kind: input.kind,
          value: input.value,
          posts: input.posts,
          matches: input.matches,
          bestScore: input.bestScore,
          lastFoundAt: input.lastFoundAt ? input.lastFoundAt.toISOString() : null,
          lastMatchedAt: input.lastMatchedAt ? input.lastMatchedAt.toISOString() : null,
        })),
      };
    },
  });

  /**
   * Where this monitor's leads come from. US-267.
   *
   * Four groupings in one answer, because they are read together: a platform
   * that produces little is a different decision when its channels are all
   * weak than when one of them carries it. `leads.ts` says what each is for.
   */
  app.route({
    method: "GET",
    url: "/api/monitors/:id/leads",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: { 200: leadsSchema, 404: problemSchema },
    },
    handler: async (request, reply) => {
      const leads = await leadsOf(db, sessionUserId(request), request.params.id);
      if (!leads) return reply.code(404).send({ message: "No monitor has that id." });

      return leads;
    },
  });
}
