import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import {
  aiConfigFromEnvironment,
  builtInSources,
  type ConnectorDefinition,
  createQueryGenerator,
  type Database,
  type Env,
  type JobSender,
  type Logger,
  needsApiKey,
  type QueryGenerator,
  storedCredentialNames,
} from "@intentwatch/core";
import Fastify, {
  type FastifyInstance,
  type RawReplyDefaultExpression,
  type RawRequestDefaultExpression,
  type RawServerDefault,
} from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";
import { registerConnectionRoutes } from "./connections.js";
import { registerEstimateRoutes } from "./estimates.js";
import { registerMatchRoutes } from "./matches.js";
import { registerMonitorRoutes } from "./monitors.js";
import { registerNotificationRoutes } from "./notifications.js";

/**
 * Where the built UI lives. In the image and in a local `pnpm build` this is
 * `apps/web/dist`, two levels up from the API's own build output.
 */
export function resolveWebDist(env: Env): string {
  return env.WEB_DIST_PATH ?? new URL("../../web/dist", import.meta.url).pathname;
}

/**
 * The Fastify instance this app builds: our own pino logger, and Zod as the
 * type provider. Naming it keeps the type out of every signature that passes
 * the server around.
 */
export type ApiServer = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  Logger,
  ZodTypeProvider
>;

export interface BuildServerOptions {
  env: Env;
  logger: Logger;
  db: Database;
  /**
   * The connectors this build ships. Injected so a test can describe a source
   * without one existing, and so nothing here has to build a source runtime:
   * the API reads credential fields and never searches.
   */
  sources?: readonly ConnectorDefinition[];
  /** Where the source keys live when they are not in the database. */
  environment?: Record<string, string | undefined>;
  /**
   * Where `ENCRYPTION_KEY` is read from, kept apart from the provider keys
   * above so a test can describe an instance that cannot store one.
   */
  encryption?: Record<string, string | undefined>;
  /**
   * Which credentials the database holds, as `source:field` names.
   *
   * A function and not a set, and US-023 is why. `startApi` used to read the
   * names once at boot and hand them over, which was correct while nothing
   * could write one. The connections screen writes one, and a snapshot taken
   * at boot then tells the monitor form a key is missing until the process
   * restarts. This is read per request instead: one small table, and the one
   * answer both screens get. US-004, US-023.
   */
  storedCredentials?: () => Promise<ReadonlySet<string>> | ReadonlySet<string>;
  /**
   * How the monitor form writes its queries. Undefined builds one from the
   * environment, which is null when no model key is set. A test passes one
   * backed by a stub, because no test spends money.
   */
  queryGenerator?: QueryGenerator | null;
  /**
   * How the cost test reaches the worker. Null when this deployment has no
   * queue to send to; the route says so rather than writing a run nothing
   * will pick up. `start.ts` passes the worker's own queue when there is one.
   */
  jobs?: JobSender | null;
}

/**
 * The generator this deployment can use, or null.
 *
 * Null rather than a throw. A self-hoster with no model key still has a
 * working product: they type the queries themselves, and the form says so.
 * Refusing to boot would take the whole UI away over an optional feature.
 */
export function queryGeneratorFor(env: Env, logger: Logger): QueryGenerator | null {
  if (needsApiKey(env.AI_PROVIDER) && !env.AI_API_KEY) {
    logger.warn(
      { provider: env.AI_PROVIDER },
      "no AI_API_KEY: the monitor form cannot write queries, and posts are not scored",
    );
    return null;
  }

  return createQueryGenerator({ config: aiConfigFromEnvironment(env) });
}

/**
 * Build the Fastify instance without listening, so a test can drive it with
 * `inject` and no port.
 */
export async function buildServer({
  env,
  logger,
  db,
  sources = builtInSources,
  environment,
  encryption,
  storedCredentials,
  queryGenerator,
  jobs = null,
}: BuildServerOptions): Promise<ApiServer> {
  const app = Fastify({ loggerInstance: logger }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.route({
    method: "GET",
    url: "/api/health",
    schema: {
      response: {
        200: z.object({
          status: z.literal("ok"),
          workerInProcess: z.boolean(),
        }),
      },
    },
    handler: async () => ({ status: "ok" as const, workerInProcess: env.WORKER_IN_PROCESS }),
  });

  await registerMatchRoutes(app, { db });
  await registerNotificationRoutes(app, { db, env });

  await registerConnectionRoutes(app, { db, sources, environment, encryption, logger });

  await registerMonitorRoutes(app, {
    db,
    sources,
    environment,
    storedCredentials: storedCredentials ?? (() => storedCredentialNames(db)),
    queryGenerator: queryGenerator === undefined ? queryGeneratorFor(env, logger) : queryGenerator,
  });

  await registerEstimateRoutes(app, { db, sources, jobs });

  const webDist = resolveWebDist(env);

  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });

    // The UI is a single-page app. Anything that is not an API route or a
    // real file is the app's own route, so hand back index.html.
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ message: "Not found" });
      }
      return reply.sendFile("index.html");
    });
  } else {
    logger.warn({ webDist }, "no built UI found; serving the API only");
  }

  return app;
}
