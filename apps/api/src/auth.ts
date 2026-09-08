/**
 * The session gate, and the login routes behind it.
 *
 * Correctness-critical. The failure shape is the one US-017 was written for:
 * an instance on a public address whose inbox, verdicts and provider keys are
 * readable by whoever finds the port. A route that forgets to ask for a
 * session is not a bug anybody sees — it works.
 *
 * So no route asks. The gate is one `onRequest` hook on the root instance,
 * every API route is behind it, and what is *not* behind it is a written list
 * of three entries. `auth.test.ts` walks the routes this build registers and
 * checks each one against that list, which is what the ticket means by
 * enumerating rather than sampling.
 *
 * **The static UI is open and the API is closed.** A person who is not signed
 * in still has to be able to load the page that signs them in, and the bundle
 * carries no monitor, no match and no key — everything it shows, it fetches.
 * Putting the login form behind the login is the one way to lock the owner out
 * of their own instance.
 */
import {
  type Auth,
  accountExists,
  type Database,
  getMonitor,
  type Logger,
  type Monitor,
  type SignupMode,
} from "@intentwatch/core";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ApiServer } from "./server.js";

/** What a route knows about the person asking. A text id, and no more. */
export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

/**
 * How a request is turned into a person, or into nobody.
 *
 * Injected for the reason every other seam in `buildServer` is injected: a
 * test that is about the inbox should not have to be about cookies. The gate
 * itself is never injected — a test that replaced *that* would assert nothing.
 */
export type SessionResolver = (request: FastifyRequest) => Promise<SessionUser | null>;

declare module "fastify" {
  interface FastifyRequest {
    /** The signed-in person, set by the gate. Absent only on an open route. */
    sessionUser?: SessionUser;
  }
  interface FastifyInstance {
    /**
     * Every route this build registers.
     *
     * Recorded rather than derived, because Fastify's route table is not a
     * public API and `printRoutes` is a picture rather than a list. The gate is
     * the reason it exists: a claim about *every* route needs something to
     * count.
     */
    registeredRoutes: { method: string; url: string }[];
  }
}

/**
 * The paths that answer without a session, and why each one does.
 *
 * Three entries, and adding a fourth should be hard. Every one of them is a
 * decision that some part of this instance is readable by a stranger.
 */
export const openApiPaths: readonly string[] = [
  /**
   * A container health check and a load balancer have no cookie, and this is
   * the probe `docker compose` is configured with. It answers whether the
   * process is up and which worker mode it runs in — no monitor, no match, no
   * key. Closing it would make an unreachable instance and a signed-out one
   * look the same to whatever restarts it.
   */
  "/api/health",
  /**
   * Whether this instance still needs its first account. The login screen asks
   * before it decides whether to show a sign-up form, so it is asked by
   * somebody who by definition has no session. It answers one boolean about
   * the instance and nothing about a person.
   */
  "/api/auth-status",
];

/** The prefix the login itself lives under. Open, because it *is* the login. */
export const authBasePath = "/api/auth";

/** The message a signed-out request gets. One sentence, and no detail. */
export const signedOutMessage = "Sign in to use IntentWatch.";

export interface AuthRoutesOptions {
  readonly db: Database;
  readonly logger: Logger;
  /** Null when this build has no auth instance, which only a test describes. */
  readonly auth: Auth | null;
  /** Overridden by tests that are about something else. */
  readonly session?: SessionResolver;
  /** Set when a proxy rewrites the host. `AUTH_URL`. */
  readonly baseUrl?: string | undefined;
  /**
   * Whether a stranger may register. `AUTH_SIGNUP`, closed by default.
   *
   * The gate does not read it — a person is signed in or they are not, whatever
   * the setting. Only the status route below does, so the screen knows whether
   * to offer the way to a new account. The refusal itself lives in
   * `createAuth`'s hook, where every path that creates a user passes.
   */
  readonly signup?: SignupMode;
}

/**
 * The id of the person this request belongs to.
 *
 * A function rather than a field read, so a route that reaches for a user on a
 * path the gate does not cover fails loudly here instead of writing a row
 * owned by `undefined`.
 */
export function sessionUserId(request: FastifyRequest): string {
  const found = request.sessionUser?.id;

  if (!found) {
    throw new Error(
      "This route read a user without a session. Either it is on the open list by mistake, " +
        "or the gate did not run.",
    );
  }

  return found;
}

/** Is this path answered without a session? */
export function isOpenPath(path: string): boolean {
  return (
    !path.startsWith("/api/") ||
    path === authBasePath ||
    path.startsWith(`${authBasePath}/`) ||
    openApiPaths.includes(path)
  );
}

/** Fastify's header bag as the `Headers` the auth library reads. */
function headersOf(request: FastifyRequest): Headers {
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const one of value) headers.append(name, one);
    } else if (value !== undefined) {
      headers.append(name, value);
    }
  }

  return headers;
}

/**
 * The address the browser used, which is not always the one Fastify sees.
 *
 * A session cookie is marked `Secure` on https and not on http, so reading the
 * scheme from the socket behind a TLS proxy would issue a cookie the browser
 * declines to send back — a login that succeeds and then does nothing.
 */
function requestUrl(request: FastifyRequest, baseUrl: string | undefined): URL {
  if (baseUrl) return new URL(request.url, baseUrl);

  const forwarded = request.headers["x-forwarded-proto"];
  const protocol = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  const host = request.headers.host ?? "localhost";

  return new URL(request.url, `${protocol ?? request.protocol}://${host}`);
}

/** Copy an auth `Response` onto a Fastify reply, `set-cookie` included. */
async function sendResponse(reply: FastifyReply, response: Response): Promise<void> {
  const cookies = response.headers.getSetCookie();

  response.headers.forEach((value, name) => {
    // Handled below. `forEach` folds several `set-cookie` lines into one
    // comma-joined string, and a browser reads that as a single broken cookie.
    if (name.toLowerCase() !== "set-cookie") reply.header(name, value);
  });

  if (cookies.length > 0) reply.header("set-cookie", cookies);

  reply.status(response.status);
  await reply.send(response.body ? Buffer.from(await response.arrayBuffer()) : null);
}

export async function registerAuthRoutes(
  app: ApiServer,
  { db, logger, auth, session, baseUrl, signup = "closed" }: AuthRoutesOptions,
): Promise<void> {
  app.decorate("registeredRoutes", [] as { method: string; url: string }[]);
  app.decorateRequest("sessionUser", undefined);

  // Registered before every other route, so it sees all of them. An `onRoute`
  // hook only fires for routes added after it.
  app.addHook("onRoute", (route) => {
    for (const method of [route.method].flat()) {
      app.registeredRoutes.push({ method, url: route.url });
    }
  });

  /**
   * The session, from the cookie the login set.
   *
   * `getSession` reads the `sessions` row and not only the cookie, so a signed
   * out or expired session is refused by the server rather than by the browser
   * agreeing to forget something.
   */
  const resolve: SessionResolver =
    session ??
    (async (request) => {
      if (!auth) return null;

      const found = await auth.api.getSession({ headers: headersOf(request) });
      if (!found) return null;

      return { id: found.user.id, email: found.user.email, name: found.user.name };
    });

  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0] ?? "";

    if (isOpenPath(path)) return;

    const user = await resolve(request);

    if (!user) {
      return reply.code(401).send({ message: signedOutMessage });
    }

    request.sessionUser = user;
  });

  /**
   * What the login screen needs to know before it draws itself.
   *
   * Two questions, because since US-066 they have different answers.
   * `firstRun` is whether this instance has any account at all — it decides
   * between "set this up" and "sign in", and it stops being true the moment an
   * owner exists. `signUpOpen` is whether anybody may register right now:
   * always true on the first run, and after that only where the setting says
   * so.
   *
   * Neither says anything about who the owner is.
   */
  app.route({
    method: "GET",
    url: "/api/auth-status",
    schema: {
      response: {
        200: z.object({
          firstRun: z.boolean(),
          signUpOpen: z.boolean(),
          signedIn: z.boolean(),
          /**
           * Who is asking, or null. US-069.
           *
           * This route is open, because the login screen has to reach it before
           * anybody is signed in. So it answers with an account only when the
           * request carries that account's own session cookie — a signed-out
           * visitor learns nothing about who else uses this instance.
           */
          account: z.object({ name: z.string(), email: z.email() }).nullable(),
        }),
      },
    },
    handler: async (request) => {
      const firstRun = !(await accountExists(db));
      const user = await resolve(request);

      return {
        firstRun,
        signUpOpen: firstRun || signup === "open",
        signedIn: user !== null,
        account: user ? { name: user.name, email: user.email } : null,
      };
    },
  });

  if (!auth) {
    logger.warn("no AUTH_SECRET: the login routes are not mounted");
    return;
  }

  /**
   * Better Auth's own endpoints, under one catch-all.
   *
   * Inside a plugin scope of its own, because the body has to reach the
   * library unparsed and a content type parser is encapsulated by Fastify.
   * Registering that parser on the root instance would take JSON parsing away
   * from every other route in the process.
   */
  await app.register(
    async (scope) => {
      // `application/json` by name as well as the catch-all: Fastify's own
      // JSON parser is inherited from the root, and a catch-all only covers
      // types nothing else claims. Without this line the library is handed a
      // parsed object where it expects the bytes, and every sign-in is a 400.
      for (const type of ["application/json", "application/x-www-form-urlencoded", "*"]) {
        scope.addContentTypeParser(type, { parseAs: "buffer" }, (_request, body, done) => {
          done(null, body);
        });
      }

      scope.route({
        method: ["GET", "POST"],
        url: "/*",
        handler: async (request, reply) => {
          const url = requestUrl(request, baseUrl);
          const hasBody = request.method !== "GET" && request.method !== "HEAD";

          const response = await auth.handler(
            new Request(url, {
              method: request.method,
              headers: headersOf(request),
              body: hasBody ? (request.body as Buffer | undefined) : undefined,
            }),
          );

          await sendResponse(reply, response);
        },
      });
    },
    { prefix: authBasePath },
  );
}

/**
 * The monitor with this id, if it belongs to the person asking.
 *
 * The gate above answers "is this somebody?"; this answers "is this theirs?",
 * and every route addressed by a monitor id needs both. It is `undefined`
 * rather than a refusal for the same reason the routes already answer 404 on
 * an unknown id: a monitor somebody else owns and a monitor that does not
 * exist are the same fact to the person asking, and telling them apart would
 * confirm the id of a row they cannot read.
 *
 * `getMonitor` stays unscoped underneath, because the worker polls every
 * monitor on the instance and has no session to poll it with.
 */
export async function ownedMonitor(
  db: Database,
  request: FastifyRequest,
  id: string,
): Promise<Monitor | undefined> {
  const monitor = await getMonitor(db, id);
  return monitor && monitor.userId === sessionUserId(request) ? monitor : undefined;
}
