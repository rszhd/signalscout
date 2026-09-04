import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import type { Env, Logger } from "@intentwatch/core";
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
}

/**
 * Build the Fastify instance without listening, so a test can drive it with
 * `inject` and no port.
 */
export async function buildServer({ env, logger }: BuildServerOptions): Promise<ApiServer> {
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
