import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import {
  aiConfigFromEnvironment,
  builtInSources,
  createQueryGenerator,
  type Database,
  type Env,
  type Logger,
  needsApiKey,
  type QueryGenerator,
  type SourceDescriptor,
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
import { registerMatchRoutes } from "./matches.js";
import { registerMonitorRoutes } from "./monitors.js";

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
  sources?: readonly SourceDescriptor[];
  /** Where the source keys live until US-004 encrypts them. */
  environment?: Record<string, string | undefined>;
  /**
   * How the monitor form writes its queries. Undefined builds one from the
   * environment, which is null when no model key is set. A test passes one
   * backed by a stub, because no test spends money.
   */
  queryGenerator?: QueryGenerator | null;
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
  queryGenerator,
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

  await registerMonitorRoutes(app, {
    db,
    sources,
    environment,
    queryGenerator: queryGenerator === undefined ? queryGeneratorFor(env, logger) : queryGenerator,
  });

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
