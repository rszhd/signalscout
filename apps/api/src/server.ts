import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import {
  type AiConfig,
  type AiEnvironment,
  type Auth,
  aiConfigFromEnvironment,
  builtInSources,
  type ConnectorDefinition,
  createAuth,
  createProjectDescriber,
  createQueryGenerator,
  type Database,
  draftConfigFromEnvironment,
  type Env,
  type JobSender,
  type Logger,
  needsApiKey,
  type ProjectDescriber,
  type QueryGenerator,
  readAiEnvironment,
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
import { registerAuthRoutes, type SessionResolver } from "./auth.js";
import { registerConnectionRoutes } from "./connections.js";
import { registerDraftRoutes, registerReplyPromptRoutes } from "./drafts.js";
import { registerEstimateRoutes } from "./estimates.js";
import { registerMatchRoutes } from "./matches.js";
import { registerModelRoutes } from "./models.js";
import { registerMonitorRoutes } from "./monitors.js";
import { registerNotificationRoutes } from "./notifications.js";
import { registerPricingRoutes } from "./pricing.js";
import { registerProjectRoutes } from "./projects.js";

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
  storedCredentials?: (userId: string) => Promise<ReadonlySet<string>> | ReadonlySet<string>;
  /**
   * How the monitor form writes its queries. Undefined builds one from the
   * environment, which is null when no model key is set. A test passes one
   * backed by a stub, because no test spends money.
   */
  queryGenerator?: QueryGenerator | null;
  /**
   * The project describer. US-050.
   *
   * Injectable for the same reason the query generator is: a test drives every
   * outcome — a refusal, a timeout, a missing key — without a model and
   * without spending anything.
   */
  describer?: ProjectDescriber | null;
  /**
   * The auth instance, or null for a build that has no `AUTH_SECRET`.
   *
   * Undefined builds one from the environment. Null is what a test passes when
   * it wants the gate without the login routes behind it.
   */
  auth?: Auth | null;
  /**
   * How a request becomes a person.
   *
   * Injected by every test that is about something other than the login. The
   * gate that *calls* it is never injected: a test that replaced the gate
   * would be asserting nothing about the thing US-017 exists to guarantee.
   */
  session?: SessionResolver;
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
/**
 * The project describer, or null when this deployment has no model key.
 *
 * Null rather than a throw, for `queryGeneratorFor`'s reason: drafting the
 * four answers from a document is a convenience, and refusing to boot over one
 * would take the whole UI away.
 */
export function describerForEnvironment(
  env: AiEnvironment,
  logger: Logger,
): ProjectDescriber | null {
  if (needsApiKey(env.AI_PROVIDER) && !env.AI_API_KEY) {
    logger.warn(
      { provider: env.AI_PROVIDER },
      "no model key: a project cannot be drafted from a document",
    );
    return null;
  }

  return createProjectDescriber({ config: aiConfigFromEnvironment(env) });
}

/**
 * The model a draft is written with, or null when this deployment has none.
 *
 * Null rather than a throw, for the same reason as the two above: a draft is a
 * button a person may never press, and refusing to boot over a missing key
 * would take the inbox away with it. The route says so in words a person can
 * act on.
 */
export function draftConfigForEnvironment(env: AiEnvironment, logger: Logger): AiConfig | null {
  // The draft's own settings, which fall back to the classifier's. US-070.
  // The key is checked on the provider that will actually be called, because a
  // draft on a second provider needs that provider's key and not this one's.
  const config = draftConfigFromEnvironment(env);

  if (needsApiKey(config.provider) && !config.apiKey) {
    logger.warn({ provider: config.provider }, "no model key: replies cannot be drafted");
    return null;
  }

  return config;
}

/**
 * The auth instance, or null when this deployment has no `AUTH_SECRET`.
 *
 * Null rather than a throw *here*, so that `buildServer` stays a function a
 * test can call without describing a whole instance. `startApi` is what
 * refuses to boot, because a running instance with no login is the failure
 * US-017 exists to prevent and a warning in a log is not a lock.
 */
export function authFor(env: Env, db: Database, logger: Logger): Auth | null {
  if (!env.AUTH_SECRET) {
    logger.warn("no AUTH_SECRET: this build has no login");
    return null;
  }

  return createAuth({
    db,
    secret: env.AUTH_SECRET,
    baseUrl: env.AUTH_URL,
    logger,
    trustedOrigins: trustedOrigins(env),
    signup: env.AUTH_SIGNUP,
  });
}

/**
 * The Vite dev server, which is a different origin from the API it proxies to.
 *
 * `pnpm dev` runs the UI on 5173 and proxies `/api` to 3000 with
 * `changeOrigin`, so the request reaches Fastify with the host rewritten and
 * the browser's own `Origin: http://localhost:5173` untouched. Better Auth
 * compares them and refuses — `403 INVALID_ORIGIN` — so every sign-in on a
 * developer's machine fails while production is fine.
 *
 * Both spellings, because a person types whichever they type and the two are
 * different origins to a browser.
 */
export const viteDevOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];

/**
 * Which origins may sign in, besides this instance's own address.
 *
 * The dev server is added only when NODE_ENV says development. A production
 * build that trusted localhost would accept a login posted from a page on the
 * user's own machine, which is the shape this check exists to refuse.
 */
export function trustedOrigins(env: Env): string[] {
  const configured = (env.AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "");

  return env.NODE_ENV === "development" ? [...configured, ...viteDevOrigins] : configured;
}

/**
 * The model settings for one person: the instance's, with theirs over the top.
 *
 * US-068. Every model call the API makes — writing a monitor's queries,
 * drafting a project from a document, drafting a reply — is paid for by
 * whoever pressed the button, so each is built per request rather than once at
 * registration.
 *
 * Per request and not cached, unlike the worker's. A route already costs a
 * database round trip and this is one small read; the worker's cache exists
 * because a poll would otherwise decrypt a key fifty times. The consequence is
 * the good one: a key pasted on the Models screen works on the very next
 * request, with no restart.
 */
export function aiEnvironmentFor(
  db: Database,
  env: Env,
): (userId: string) => Promise<AiEnvironment> {
  return (userId) => readAiEnvironment(db, userId, env);
}

export function queryGeneratorForEnvironment(
  env: AiEnvironment,
  logger: Logger,
): QueryGenerator | null {
  if (needsApiKey(env.AI_PROVIDER) && !env.AI_API_KEY) {
    logger.warn(
      { provider: env.AI_PROVIDER },
      "no model key: the monitor form cannot write queries, and posts are not scored",
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
  describer,
  auth,
  session,
  jobs = null,
}: BuildServerOptions): Promise<ApiServer> {
  const app = Fastify({ loggerInstance: logger }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // First, and it has to be first: its `onRoute` hook only records the routes
  // registered after it, and the count is what `auth.test.ts` checks the open
  // list against.
  await registerAuthRoutes(app, {
    db,
    logger,
    auth: auth === undefined ? authFor(env, db, logger) : auth,
    session,
    baseUrl: env.AUTH_URL,
    signup: env.AUTH_SIGNUP,
  });

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
  /**
   * How a route reaches the model the person asking pays for. US-068.
   *
   * The `describer`, `queryGenerator` and draft config options below stay what
   * they were — an override a test passes, including `null` for "this
   * deployment has none". Only the *fallback* changed: it used to read the
   * environment once and now reads the person's settings over it.
   */
  const aiFor = aiEnvironmentFor(db, env);

  await registerProjectRoutes(app, {
    db,
    describer,
    describerFor: async (userId) => describerForEnvironment(await aiFor(userId), logger),
  });
  await registerNotificationRoutes(app, { db, env });

  await registerConnectionRoutes(app, { db, sources, environment, encryption, logger });
  await registerPricingRoutes(app, { db, sources, environment });
  await registerModelRoutes(app, { db, env, encryption });
  await registerDraftRoutes(app, {
    db,
    aiFor: async (userId) => draftConfigForEnvironment(await aiFor(userId), logger),
  });
  await registerReplyPromptRoutes(app, { db });

  await registerMonitorRoutes(app, {
    db,
    sources,
    environment,
    storedCredentials: storedCredentials ?? ((userId: string) => storedCredentialNames(db, userId)),
    queryGenerator,
    queryGeneratorFor: async (userId) => queryGeneratorForEnvironment(await aiFor(userId), logger),
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
