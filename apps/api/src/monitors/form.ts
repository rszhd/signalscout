/**
 * The form's routes: its options, and the queries a model writes for a set
 * of answers before any monitor exists. US-265.
 *
 * A query generation the model refused answers 422 and one that never reached
 * the model answers 502, because the person's next action differs: the first
 * is about the prompt or the answers, the second is about a key, a network or
 * an outage.
 */
import {
  canFetchRepliesFor,
  groupByPlatform,
  notOfferedReason,
  platforms,
  recordModelCall,
  signalList,
  startBlockers,
} from "@signalscout/pipeline";
import { z } from "zod";
import { sessionUserId } from "../auth.js";
import type { ApiServer } from "../server.js";
import {
  defaultQueryWords,
  generateBody,
  missingCredentialSchema,
  problemSchema,
  queriesResponse,
} from "./schemas.js";
import type { MonitorContext } from "./shared.js";

export function registerFormRoutes(app: ApiServer, context: MonitorContext): void {
  const { db, options, generatorFor, currentEnvironment } = context;
  const { sources } = options;

  /**
   * Everything the form needs to render itself.
   *
   * The signals come from `signalList`, which is the same file both prompts
   * read. A form with its own copy of the labels is how a checkbox and a
   * prompt end up meaning different things.
   */
  app.route({
    method: "GET",
    url: "/api/monitor-options",
    schema: {
      response: {
        200: z.object({
          signals: z.array(z.object({ id: z.string(), label: z.string(), hint: z.string() })),
          sources: z.array(
            z.object({
              id: z.string(),
              displayName: z.string(),
              /**
               * How a query has to be written for this platform. US-027: the
               * form asks for one list per platform and holds each to its own
               * rule, so it has to be able to say what the rule is.
               */
              search: z.object({ maxQueryWords: z.number(), note: z.string() }),
              /** Empty when the platform can be collected. */
              missingCredentials: z.array(missingCredentialSchema),
              ready: z.boolean(),
              /**
               * Whether the connector that would run here reads replies.
               *
               * Per platform and per deployment, not per build. A build ships
               * two Reddit connectors and only one of them reads replies, so
               * an instance holding the other one's key must be told that
               * ticking the box will give it nothing.
               */
              canFetchReplies: z.boolean(),
            }),
          ),
          /** False when no model key is set, so the form can say why. */
          canGenerateQueries: z.boolean(),
        }),
      },
    },
    handler: async (request) => {
      const runtime = await currentEnvironment(sessionUserId(request));

      return {
        signals: signalList.map(({ id, label, hint }) => ({ id, label, hint })),
        /**
         * One row per platform, not per connector.
         *
         * US-026, and it is the whole of what this form knows about providers.
         * A person ticks networks to watch; which account fetches them is one
         * row on the connections screen, chosen once for every monitor. Two
         * Reddit connectors listed here would put Reddit on the form twice and
         * make the person pick a scraper.
         *
         * The price is gone from this response for the same reason. It belongs
         * to the pair, and two providers do not agree about it, so a figure
         * printed beside a platform would be one provider's arithmetic on the
         * other's bill. The cost test reads it from the connector that took
         * the sample.
         */
        sources: groupByPlatform(sources).map(({ platform }) => {
          const missing = startBlockers([platform.id], runtime);
          const replies = canFetchRepliesFor([platform.id], runtime);

          return {
            id: platform.id,
            displayName: platform.displayName,
            search: {
              maxQueryWords: platform.search?.maxQueryWords ?? defaultQueryWords,
              note: platform.search?.note ?? "",
            },
            // What is still to be set, from whichever providers are blocked.
            // Each entry names its provider, so a platform two providers fetch
            // can be shown as needing one account or the other, never both.
            missingCredentials: missing,
            ready: missing.length === 0,
            canFetchReplies: replies[platform.id] === true,
          };
        }),
        canGenerateQueries: (await generatorFor(sessionUserId(request))) !== null,
      };
    },
  });

  /**
   * Write the queries for a set of answers, before any monitor exists.
   *
   * This spends money on the user's key, so the call is recorded whatever it
   * returned. The row carries no monitor id, because there is no monitor yet:
   * a person may generate three times and create nothing, and those three
   * calls are still on the bill.
   */
  app.route({
    method: "POST",
    url: "/api/monitors/queries",
    schema: {
      body: generateBody,
      response: {
        200: z.object({
          queries: queriesResponse,
          subreddits: z.array(z.string()),
          model: z.string(),
          estimatedCostMicros: z.number().nullable(),
        }),
        422: problemSchema,
        502: problemSchema,
        503: problemSchema,
      },
    },
    handler: async (request, reply) => {
      const generator = await generatorFor(sessionUserId(request));

      if (!generator) {
        return reply.code(503).send({
          message:
            "No model is configured, so queries cannot be written. Set AI_API_KEY, " +
            "or AI_PROVIDER=ollama to run a local model. You can still type the " +
            "queries yourself.",
        });
      }

      /**
       * Write for the platforms this monitor watches, and for no others.
       *
       * A monitor that watches one platform must not be billed for queries it
       * will never run, and a plan written for a platform nobody ticked is a
       * list a person has to read and delete. An empty list means the form has
       * not asked the question yet, so every platform is written for: that is
       * the old behaviour, and it is what an older client still gets.
       */
      const wanted = request.body.sources;
      // A switched-off platform is never written for, whether it was asked for
      // or the body asked for all of them. Queries for a platform this build
      // will not poll are model tokens spent on a list nobody can use. US-053.
      const offered = platforms.filter(
        (platform) => notOfferedReason(options.sources, platform.id) === null,
      );
      const wantedPlatforms =
        wanted.length === 0
          ? offered
          : offered.filter((platform) => wanted.some((id) => id === platform.id));

      const outcome = await generator.generate(request.body, wantedPlatforms);

      await recordModelCall(db, {
        purpose: "query_generation",
        outcome: outcome.status === "generated" ? "scored" : outcome.status,
        call: outcome.call,
        userId: sessionUserId(request),
        error: outcome.status === "generated" ? null : outcome.error,
      });

      if (outcome.status === "rejected") {
        request.log.warn({ err: outcome.error }, "the model wrote an unusable set of queries");
        return reply.code(422).send({
          message:
            `${generator.model} did not write a usable set of queries. ` +
            "Try again, or make the answers more specific. You can also type the queries yourself.",
        });
      }

      if (outcome.status === "failed") {
        request.log.error({ err: outcome.error }, "the model could not be reached");
        return reply.code(502).send({
          message: `${generator.model} could not be reached: ${outcome.error}`,
        });
      }

      // BUG-383: a line that broke a rule is left out rather than refusing the
      // plan. The log is where somebody finds out the model keeps doing it.
      if (outcome.dropped.length > 0) {
        request.log.info({ dropped: outcome.dropped }, "the model wrote queries the plan left out");
      }

      return {
        // Copied into plain arrays: the plan is readonly and the response
        // schema is not, and a cast here would hide the next shape change.
        queries: Object.fromEntries(
          Object.entries(outcome.plan.queries).map(([platform, list]) => [platform, [...list]]),
        ),
        subreddits: [...outcome.plan.subreddits],
        model: generator.model,
        estimatedCostMicros: outcome.call.estimatedCostMicros ?? null,
      };
    },
  });
}
