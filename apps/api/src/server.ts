import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import {
  type AiConfig,
  type AiEnvironment,
  type Auth,
  aiConfigFromEnvironment,
  type BillingProvider,
  type BillingSettings,
  billingSettingsFrom,
  builtInSources,
  type ConnectorDefinition,
  createAuth,
  createNotificationTransport,
  createProjectDescriber,
  createQueryGenerator,
  type Database,
  draftConfigFromEnvironment,
  type Env,
  emailVerificationRequired,
  type JobSender,
  type Logger,
  machineKeysUsable,
  needsApiKey,
  notificationReadiness,
  type ProjectDescriber,
  providerKeyEnvironment,
  type QueryGenerator,
  readAiEnvironment,
  type SendEmail,
  storedCredentialNames,
  withoutMachineModelKeys,
} from "@signalscout/core";
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
import { registerBillingGate, registerBillingRoutes } from "./billing.js";
import { registerConnectionRoutes } from "./connections.js";
import { registerDraftRoutes, registerReplyPromptRoutes } from "./drafts.js";
import { registerEstimateRoutes } from "./estimates.js";
import { registerMatchRoutes } from "./matches.js";
import { type ModelRoutesOptions, registerModelRoutes } from "./models.js";
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
   * How the Models screen's Test button reaches a provider.
   *
   * Injected so the suite can answer without one: AGENTS.md's rule is that no
   * test here spends money, and this is the one route whose purpose is a
   * billed call.
   */
  modelProbe?: ModelRoutesOptions["probe"];
  /**
   * Whether this deployment has a working mailer, for a new monitor's
   * notification defaults. US-093.
   *
   * Derived from `env` unless a test says otherwise, so a deployment never has
   * to state it twice and a test can describe an instance with a mail server
   * without describing the mail server.
   */
  canSendEmail?: boolean;
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
  /**
   * What this deployment charges, or null for one that does not. US-072.
   *
   * Undefined reads the environment, which is `off` unless it says otherwise.
   * Null is what a test passes for "this instance is free", and it is the same
   * shape `auth` uses.
   */
  billingSettings?: BillingSettings | null;
  /**
   * The payment provider. Injected by every test that reaches these routes,
   * because no test spends money and no test needs the network.
   */
  billing?: BillingProvider;
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
    billing: env.BILLING_MODE,
    sendEmail: verificationSenderFor(env),
  });
}

/**
 * How a verification link leaves this instance, or undefined. US-092.
 *
 * US-016's transport, and not a second one. There is one mail server in a
 * deployment, configured once, and a mailer of this file's own would be a
 * second set of SMTP settings that can disagree with the first about the port,
 * the TLS mode or the from address.
 *
 * `emailVerificationRequired` throws when the mode asks for verification that
 * cannot be sent, so `undefined` here always means "this deployment does not
 * verify" and never "it wanted to and could not". `startApi` asks the same
 * question before anything starts, so the message arrives at boot rather than
 * at the first registration.
 */
export function verificationSenderFor(env: Env): SendEmail | undefined {
  if (!emailVerificationRequired(env)) return undefined;

  const send = createNotificationTransport(env).email;

  // Unreachable while the check above and `notificationReadiness` agree about
  // what a working mailer needs. Written out rather than asserted away,
  // because the two lists live in different files and the failure this would
  // hide is the one the ticket exists to prevent.
  if (!send) {
    throw new Error(
      'AUTH_EMAIL_VERIFICATION is "required" but the SMTP settings do not build a mailer.',
    );
  }

  return send;
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
  // On an instance taking registrations the machine's model keys are nobody's
  // to spend, so the account's own settings are laid over an environment that
  // has none. US-081, and `config/machine-keys.ts` holds the reasoning.
  const instance = machineKeysUsable(env.AUTH_SIGNUP) ? env : withoutMachineModelKeys(env);

  return (userId) => readAiEnvironment(db, userId, instance);
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
  modelProbe,
  storedCredentials,
  queryGenerator,
  describer,
  auth,
  session,
  jobs = null,
  billingSettings,
  billing,
  canSendEmail,
}: BuildServerOptions): Promise<ApiServer> {
  const app = Fastify({ loggerInstance: logger }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  /**
   * What this deployment charges, read before the routes so the login status
   * route and the paywall below both get the same answer. Null is a build that
   * does not charge.
   */
  const settings =
    billingSettings === undefined
      ? billingSettingsFrom({
          BILLING_MODE: env.BILLING_MODE,
          STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
          STRIPE_PRICE_ID: env.STRIPE_PRICE_ID,
          STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET,
          APP_URL: env.APP_URL,
        })
      : billingSettings;

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
    billing: settings?.mode ?? "off",
  });

  /**
   * The paywall, immediately after the session gate and before every route it
   * covers. Order is the whole design: it reads the person the gate just set,
   * and a Fastify `onRequest` hook only sees requests to routes registered
   * after it — which is also why the billing routes below register later.
   *
   * `off` registers nothing at all.
   */
  registerBillingGate(app, { db, mode: settings?.mode ?? "off" });

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

  await registerBillingRoutes(app, { db, logger, settings, billing });

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
  await registerNotificationRoutes(app, { db, env, encryption, signup: env.AUTH_SIGNUP });

  // The provider keys an account may spend. Empty where signup is open, which
  // every reader of it then answers correctly with no branch of its own.
  const providerKeys = providerKeyEnvironment(env.AUTH_SIGNUP, environment);

  await registerConnectionRoutes(app, {
    db,
    sources,
    environment: providerKeys,
    encryption,
    logger,
  });
  await registerPricingRoutes(app, { db, sources, environment: providerKeys });
  await registerModelRoutes(app, {
    db,
    // The same environment with the machine's model keys taken out where they
    // are nobody's to spend, so the screen's "this instance's key" is offered
    // only where there is one to offer. US-081.
    env: machineKeysUsable(env.AUTH_SIGNUP) ? env : { ...env, ...withoutMachineModelKeys(env) },
    encryption,
    ...(modelProbe ? { probe: modelProbe } : {}),
  });
  await registerDraftRoutes(app, {
    db,
    aiFor: async (userId) => draftConfigForEnvironment(await aiFor(userId), logger),
  });
  await registerReplyPromptRoutes(app, { db });

  await registerMonitorRoutes(app, {
    db,
    sources,
    environment,
    // US-093: whether a new monitor's email notifications can be switched on.
    // The same list the notification screen and its save route read, asked
    // once here so the monitor routes never see the SMTP settings.
    canSendEmail: canSendEmail ?? notificationReadiness(env).smtpMissing.length === 0,
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
