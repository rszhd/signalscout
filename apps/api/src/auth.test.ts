/**
 * The session gate, against real Postgres.
 *
 * Correctness-critical, and written before the gate it asserts. Two of these
 * cases are the ticket's own words: every route except the login needs a
 * session, *enumerated* rather than sampled, and signup closes after the first
 * account.
 *
 * The enumeration matters more than it looks. A sample of five routes passes
 * for ever while the sixth, added next month, quietly serves an inbox to
 * anybody. This walks what the build actually registered.
 */
import { randomUUID } from "node:crypto";
import {
  accountExists,
  createAuth,
  createDatabase,
  createLogger,
  type Database,
  feedback,
  loadEnv,
  matches,
  monitors,
  posts,
  projects,
  readProviderChoices,
  replyPrompts,
  replyVoicePresets,
  sourceProviders,
  unclaimedUserId,
  users,
} from "@signalscout/core";
import { createTestDatabase, type TestDatabase } from "@signalscout/core/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authBasePath, isOpenPath, openApiPaths, signedOutMessage } from "./auth.js";
import { type ApiServer, buildServer, trustedOrigins, viteDevOrigins } from "./server.js";
import { asUser } from "./testing.js";

const logger = createLogger({ level: "silent", name: "test" });
const secret = "a-test-secret-that-is-long-enough-to-pass";
const password = "a-long-enough-password";

describe("the session gate", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("api_auth");
    ({ db, close } = createDatabase(database.url));
  });

  afterAll(async () => {
    await close();
    await database.drop();
  });

  async function server(): Promise<ApiServer> {
    const env = loadEnv({ DATABASE_URL: database.url, AUTH_SECRET: secret });
    return buildServer({ env, logger, db, queryGenerator: null });
  }

  /** Empty every table this file writes, so each case starts on a clean instance. */
  async function clear(): Promise<void> {
    await db.delete(feedback);
    await db.delete(matches);
    await db.delete(posts);
    await db.delete(replyPrompts);
    await db.delete(monitors);
    await db.delete(projects);
    await db.delete(users);
  }

  /** The cookie header a browser would send back, from a `set-cookie` reply. */
  function jarOf(header: string | string[] | undefined): string {
    const all = Array.isArray(header) ? header : header ? [header] : [];
    return all.map((one) => one.split(";")[0]).join("; ");
  }

  async function signUp(app: ApiServer, email = "owner@example.com") {
    return app.inject({
      method: "POST",
      url: `${authBasePath}/sign-up/email`,
      payload: { email, password, name: "The owner" },
    });
  }

  it("refuses every API route this build registers, except the ones on the open list", async () => {
    await clear();
    const app = await server();

    try {
      const guarded = app.registeredRoutes.filter(
        (route) => route.url.startsWith("/api/") && !isOpenPath(route.url),
      );

      // A build with no API routes would pass every assertion below and prove
      // nothing at all, which is the way this test fails silently.
      expect(guarded.length).toBeGreaterThan(10);

      for (const route of guarded) {
        // A route with parameters still has to answer the gate, and the gate
        // runs before any of them are read, so any value serves.
        const url = route.url.replace(/:[^/]+/g, "00000000-0000-0000-0000-000000000000");
        const response = await app.inject({ method: route.method as "GET", url });

        expect(
          { url: route.url, method: route.method, status: response.statusCode },
          `${route.method} ${route.url} answered without a session`,
        ).toEqual({ url: route.url, method: route.method, status: 401 });
      }
    } finally {
      await app.close();
    }
  });

  it("says why, in a sentence, rather than only with a number", async () => {
    await clear();
    const app = await server();

    try {
      const response = await app.inject({ method: "GET", url: "/api/monitors" });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ message: signedOutMessage });
    } finally {
      await app.close();
    }
  });

  it("keeps the login, the health check and Stripe's webhook open, and nothing else", async () => {
    /**
     * The list, spelled out, so a fourth entry cannot be added without changing
     * this line and saying why. US-072 added the webhook: Stripe has no cookie
     * and never will, and the signature over the body is the gate there — a
     * stronger check than a session rather than a weaker one.
     */
    expect(openApiPaths).toEqual(["/api/health", "/api/auth-status", "/api/billing/webhook"]);
    expect(isOpenPath(`${authBasePath}/sign-in/email`)).toBe(true);
    expect(isOpenPath("/api/monitors")).toBe(false);
    // The UI has to load before anybody can sign in through it.
    expect(isOpenPath("/index.html")).toBe(true);
  });

  it("creates one account on the first run, and closes signup behind it", async () => {
    await clear();
    const app = await server();

    try {
      const before = await app.inject({ method: "GET", url: "/api/auth-status" });
      expect(before.json()).toEqual({
        firstRun: true,
        signUpOpen: true,
        signedIn: false,
        account: null,
        onboarded: false,
        // US-072: this build charges nobody, which is the self-hosted default.
        billingMode: "off",
      });

      const first = await signUp(app);
      console.log("SIGNUP", first.statusCode, first.body);
      expect(first.statusCode).toBe(200);
      expect(await accountExists(db)).toBe(true);

      const second = await signUp(app, "someone-else@example.com");
      expect(second.statusCode).toBe(403);
      expect(second.body).toContain("already has an account");

      // Refused, not merely reported as refused.
      expect(await db.select().from(users)).toHaveLength(1);

      const after = await app.inject({ method: "GET", url: "/api/auth-status" });
      expect(after.json()).toEqual({
        firstRun: false,
        signUpOpen: false,
        signedIn: false,
        account: null,
        onboarded: false,
        billingMode: "off",
      });
    } finally {
      await app.close();
    }
  });

  /**
   * Whether a stranger may register. US-066.
   *
   * US-017 shipped one account and closed signup behind it. The owner reversed
   * that on 2026-09-08 — there is a cloud version, and a cloud version needs
   * registration — so it is a setting now, and both of its values are asserted
   * here rather than only the new one.
   *
   * The default is the old behaviour on purpose. Every instance running today
   * is self-hosted, and a version bump that silently began accepting
   * registrations would hand somebody's inbox and their provider keys to
   * whoever found the address.
   */
  describe("whether signup is open", () => {
    async function serverWith(signup: string): Promise<ApiServer> {
      const env = loadEnv({
        DATABASE_URL: database.url,
        AUTH_SECRET: secret,
        AUTH_SIGNUP: signup,
      });

      return buildServer({ env, logger, db, queryGenerator: null });
    }

    it("is closed when nothing says otherwise", async () => {
      await clear();
      const app = await server();

      try {
        await signUp(app);

        const second = await signUp(app, "someone-else@example.com");
        expect(second.statusCode).toBe(403);
        expect(await db.select().from(users)).toHaveLength(1);
      } finally {
        await app.close();
      }
    });

    it("lets a second person register when it is open", async () => {
      await clear();
      const app = await serverWith("open");

      try {
        expect((await signUp(app)).statusCode).toBe(200);

        const second = await signUp(app, "someone-else@example.com");
        expect(second.statusCode).toBe(200);
        expect(await db.select().from(users)).toHaveLength(2);
      } finally {
        await app.close();
      }
    });

    it("tells the screen it may offer a new account, once there is an owner", async () => {
      await clear();
      const open = await serverWith("open");

      try {
        expect((await open.inject({ method: "GET", url: "/api/auth-status" })).json()).toEqual({
          firstRun: true,
          signUpOpen: true,
          signedIn: false,
          account: null,
          onboarded: false,
          billingMode: "off",
        });

        await signUp(open);

        // The first run is over and registration is still offered. Those are
        // two different questions, which is why the route answers both.
        expect((await open.inject({ method: "GET", url: "/api/auth-status" })).json()).toEqual({
          firstRun: false,
          signUpOpen: true,
          signedIn: false,
          account: null,
          onboarded: false,
          billingMode: "off",
        });
      } finally {
        await open.close();
      }
    });

    /**
     * The one that would be worst to get wrong.
     *
     * With signup closed there can be no second account, so "only the first
     * account claims the older rows" was true by accident. With it open there
     * can be, and a stranger who registers inheriting the owner's monitors is
     * the worst bug a shared instance could have.
     */
    it("gives the older rows to the first account and to no one after it", async () => {
      await clear();
      await db.insert(projects).values({
        userId: unclaimedUserId,
        name: "Older than the accounts",
        product: "A test runner",
        idealCustomer: "QA leads",
        problem: "Flaky tests",
      });

      const app = await serverWith("open");

      try {
        await signUp(app, "owner@example.com");
        const [owner] = await db.select({ id: users.id }).from(users);

        const second = await signUp(app, "someone-else@example.com");
        expect(second.statusCode).toBe(200);

        const owned = await db.select({ userId: projects.userId }).from(projects);
        expect(owned).toEqual([{ userId: owner?.id }]);

        // And the second person's inbox is empty, which is the same fact seen
        // from the screen.
        const theirs = jarOf(second.headers["set-cookie"]);
        const listed = await app.inject({
          method: "GET",
          url: "/api/projects",
          headers: { cookie: theirs },
        });

        expect(listed.json().projects).toEqual([]);
      } finally {
        await app.close();
      }
    });
  });

  /**
   * The route is open, so what it says about a person matters. US-069.
   *
   * The login screen has to reach it before anybody is signed in, so it cannot
   * be behind the gate. It therefore answers with an account only when the
   * request carries that account's own cookie — a stranger who finds the port
   * learns whether the instance is set up, and nothing about who set it up.
   */
  /**
   * An address is proven before an account is used. US-092.
   *
   * Against real Postgres and the real auth library, because everything worth
   * asserting here is the library's own behaviour under our settings: whether a
   * session is created, whether a link is sent, and what the second attempt
   * does. A stub in front of it would assert our stub.
   *
   * Nothing sends mail. `sendEmail` is captured, which is also how the test
   * gets the link — a person opening it is the only way through this path.
   */
  describe("when an address has to be verified", () => {
    /** Every link this instance sent, newest last. */
    let sent: { to: string; subject: string; text: string; url: string }[];

    async function verifyingServer(): Promise<ApiServer> {
      sent = [];
      const env = loadEnv({
        DATABASE_URL: database.url,
        AUTH_SECRET: secret,
        AUTH_SIGNUP: "open",
      });

      return buildServer({
        env,
        logger,
        db,
        queryGenerator: null,
        auth: createAuth({
          db,
          secret,
          signup: "open",
          sendEmail: async (to, subject, text) => {
            // The link, as a person would copy it out of the message.
            const url = text.split("\n").find((line) => line.startsWith("http")) ?? "";
            sent.push({ to, subject, text, url });
          },
        }),
      });
    }

    /** The cookie header a browser would send back, from a reply. */
    function cookiesOf(reply: { headers: Record<string, unknown> }): string {
      return jarOf(reply.headers["set-cookie"] as string | string[] | undefined);
    }

    it("creates the account, sends a link, and signs nobody in", async () => {
      await clear();
      const app = await verifyingServer();

      try {
        const reply = await signUp(app);

        expect(reply.statusCode).toBe(200);
        expect(reply.json().token).toBeNull();
        expect(cookiesOf(reply)).toBe("");

        // The row exists. The account is real; it just cannot be used yet.
        const [account] = await db.select().from(users);
        expect(account?.email).toBe("owner@example.com");
        expect(account?.emailVerified).toBe(false);

        expect(sent).toHaveLength(1);
        expect(sent[0]?.to).toBe("owner@example.com");
        expect(sent[0]?.url).toContain("/api/auth/verify-email?token=");
      } finally {
        await app.close();
      }
    });

    it("refuses a sign-in until the link is opened, and sends a fresh one", async () => {
      await clear();
      const app = await verifyingServer();

      try {
        await signUp(app);
        sent = [];

        const reply = await app.inject({
          method: "POST",
          url: `${authBasePath}/sign-in/email`,
          payload: { email: "owner@example.com", password },
        });

        expect(reply.statusCode).toBe(403);
        // The code and not the sentence: the login screen reads this to tell
        // an unverified account from a wrong password, and the wording is the
        // library's to change.
        expect(reply.json().code).toBe("EMAIL_NOT_VERIFIED");
        expect(cookiesOf(reply)).toBe("");

        // The refusal is where a replacement link comes from. Without this
        // there is no way back for somebody whose first link expired.
        expect(sent).toHaveLength(1);
        expect(sent[0]?.to).toBe("owner@example.com");
      } finally {
        await app.close();
      }
    });

    it("verifies the address and signs the person in when the link is opened", async () => {
      await clear();
      const app = await verifyingServer();

      try {
        await signUp(app);
        const link = new URL(sent[0]?.url ?? "");

        const reply = await app.inject({
          method: "GET",
          url: `${link.pathname}${link.search}`,
        });

        // A redirect back to the application, carrying the session.
        expect(reply.statusCode).toBe(302);
        expect(cookiesOf(reply)).not.toBe("");

        const [account] = await db.select().from(users);
        expect(account?.emailVerified).toBe(true);

        // And the session it set is a session the gate accepts.
        const inbox = await app.inject({
          method: "GET",
          url: "/api/projects",
          headers: { cookie: cookiesOf(reply) },
        });
        expect(inbox.statusCode).toBe(200);
      } finally {
        await app.close();
      }
    });

    it("refuses a tampered link, and sends the person back with a reason", async () => {
      await clear();
      const app = await verifyingServer();

      try {
        await signUp(app);
        const link = new URL(sent[0]?.url ?? "");
        link.searchParams.set("token", `${link.searchParams.get("token")}x`);

        const reply = await app.inject({
          method: "GET",
          url: `${link.pathname}${link.search}`,
        });

        // Back to the login screen with a code it can turn into a sentence,
        // rather than a bare 401 page with nothing to do next.
        expect(reply.statusCode).toBe(302);
        expect(reply.headers.location).toContain("error=INVALID_TOKEN");

        const [account] = await db.select().from(users);
        expect(account?.emailVerified).toBe(false);
      } finally {
        await app.close();
      }
    });

    /**
     * An address already registered answers as though it were new.
     *
     * Deliberate, and it is the library's behaviour under this setting: an
     * answer that said "that address is taken" would tell a stranger which
     * addresses exist here, which is one of the three things the setting is for.
     * The screen shows one sentence for both, and it is true of both.
     */
    it("says nothing about whether an address is already registered", async () => {
      await clear();
      const app = await verifyingServer();

      try {
        await signUp(app);
        sent = [];

        const again = await signUp(app);

        expect(again.statusCode).toBe(200);
        expect(again.json().token).toBeNull();
        expect(await db.select().from(users)).toHaveLength(1);
        // And no second link, so the address's real owner is not mailed by
        // whoever guessed it.
        expect(sent).toHaveLength(0);
      } finally {
        await app.close();
      }
    });

    /**
     * A mail server that refuses. Measured live on 2026-09-09.
     *
     * The library awaits the send, swallows the error and logs "Failed to run
     * background task", which names neither mail nor the account. So the
     * person is told to check an inbox nothing reached, and the one signal an
     * operator gets says nothing they can act on.
     *
     * The request still answers 200, and that is deliberate: the account is
     * written before the send, so a refusal would report a failure that did
     * not happen and a second attempt meets the generic duplicate answer. The
     * log line is the whole repair, which is why it is asserted here.
     */
    it("says in the log when the link could not be sent", async () => {
      await clear();
      const lines: { message: string; email?: string }[] = [];
      const recording = {
        ...logger,
        error: (details: unknown, message?: string) => {
          lines.push({
            message: typeof details === "string" ? details : (message ?? ""),
            email: (details as { email?: string })?.email,
          });
        },
      } as unknown as typeof logger;

      const env = loadEnv({ DATABASE_URL: database.url, AUTH_SECRET: secret, AUTH_SIGNUP: "open" });
      const app = await buildServer({
        env,
        logger,
        db,
        queryGenerator: null,
        auth: createAuth({
          db,
          secret,
          signup: "open",
          logger: recording,
          sendEmail: async () => {
            throw new Error("SMTP delivery failed");
          },
        }),
      });

      try {
        const reply = await signUp(app);

        // The account exists and the caller is told to check their email, both
        // of which are true of a working instance too. Nothing here tells them
        // apart, which is the reason the log line has to.
        expect(reply.statusCode).toBe(200);
        expect(await db.select().from(users)).toHaveLength(1);

        const said = lines.find((line) => line.message.includes("verification email was not sent"));
        expect(said).toBeDefined();
        expect(said?.email).toBe("owner@example.com");
        // And it says what it costs, so nobody reads it as a retryable notice.
        expect(said?.message).toContain("cannot sign in");
      } finally {
        await app.close();
      }
    });

    /**
     * The default, stated as a test rather than as a comment.
     *
     * The self-hosted instance has no SMTP, and a version bump that began
     * requiring a link would refuse the owner of a machine they run for
     * themselves.
     */
    it("is off unless the deployment asks for it", async () => {
      await clear();
      const app = await server();

      try {
        const reply = await signUp(app);

        expect(reply.statusCode).toBe(200);
        expect(reply.json().token).not.toBeNull();
        expect(jarOf(reply.headers["set-cookie"])).not.toBe("");
      } finally {
        await app.close();
      }
    });
  });

  it("names the account only to a request carrying its session", async () => {
    await clear();
    const app = await server();

    try {
      const created = await signUp(app);
      const cookie = jarOf(created.headers["set-cookie"]);

      const anonymous = await app.inject({ method: "GET", url: "/api/auth-status" });
      expect(anonymous.json().account).toBeNull();

      const mine = await app.inject({
        method: "GET",
        url: "/api/auth-status",
        headers: { cookie },
      });
      expect(mine.json().account).toEqual({ name: "The owner", email: "owner@example.com" });
    } finally {
      await app.close();
    }
  });

  it("has no default account and no default password", async () => {
    await clear();
    const app = await server();

    try {
      expect(await db.select().from(users)).toHaveLength(0);

      const guessed = await app.inject({
        method: "POST",
        url: `${authBasePath}/sign-in/email`,
        payload: { email: "admin@example.com", password: "admin" },
      });

      expect(guessed.statusCode).toBeGreaterThanOrEqual(400);
    } finally {
      await app.close();
    }
  });

  it("lets the account it created through, and reads its own id", async () => {
    await clear();
    const app = await server();

    try {
      const created = await signUp(app);
      const cookie = jarOf(created.headers["set-cookie"]);
      expect(cookie).not.toBe("");

      const listed = await app.inject({
        method: "GET",
        url: "/api/monitors",
        headers: { cookie },
      });

      expect(listed.statusCode).toBe(200);

      const status = await app.inject({
        method: "GET",
        url: "/api/auth-status",
        headers: { cookie },
      });

      expect(status.json()).toEqual({
        firstRun: false,
        signUpOpen: false,
        signedIn: true,
        // US-069: the sidebar shows this, and only to a request carrying the
        // account's own cookie.
        account: { name: "The owner", email: "owner@example.com" },
        // US-105: a freshly created account has not set up yet.
        onboarded: false,
        billingMode: "off",
      });
    } finally {
      await app.close();
    }
  });

  /**
   * Where the login is allowed to be posted from.
   *
   * Found by running `pnpm dev` and failing to sign in. Vite serves the UI on
   * 5173 and proxies `/api` to 3000 with `changeOrigin`, so the request reaches
   * Fastify with the host rewritten to 3000 and the browser's own
   * `Origin: http://localhost:5173` untouched. Better Auth compares them and
   * answers **403 `INVALID_ORIGIN`** — every sign-in refused on a developer's
   * machine, while production, where one process serves both, is fine.
   *
   * The fix is a list and not a switch. Accepting any origin is what a
   * cross-site request forgery needs, and this check is what refuses it.
   */
  describe("which origins may sign in", () => {
    async function serverTrusting(origin: string): Promise<ApiServer> {
      const env = loadEnv({
        DATABASE_URL: database.url,
        AUTH_SECRET: secret,
        AUTH_TRUSTED_ORIGINS: origin,
      });

      return buildServer({ env, logger, db, queryGenerator: null });
    }

    it("accepts the origin it was told to trust", async () => {
      await clear();
      const app = await serverTrusting("http://localhost:5173");

      try {
        const created = await app.inject({
          method: "POST",
          url: `${authBasePath}/sign-up/email`,
          headers: { host: "localhost:3000", origin: "http://localhost:5173" },
          payload: { email: "owner@example.com", password, name: "The owner" },
        });

        expect(created.statusCode).toBe(200);
      } finally {
        await app.close();
      }
    });

    it("refuses one it was not, so another site cannot post the login", async () => {
      await clear();
      const app = await serverTrusting("http://localhost:5173");

      try {
        const forged = await app.inject({
          method: "POST",
          url: `${authBasePath}/sign-up/email`,
          headers: { host: "localhost:3000", origin: "http://elsewhere.example" },
          payload: { email: "owner@example.com", password, name: "The owner" },
        });

        expect(forged.statusCode).toBe(403);
        expect(forged.json().code).toBe("INVALID_ORIGIN");
        expect(await db.select().from(users)).toHaveLength(0);
      } finally {
        await app.close();
      }
    });

    it("adds the Vite dev server in development and nowhere else", () => {
      const development = loadEnv({ DATABASE_URL: database.url, NODE_ENV: "development" });
      const production = loadEnv({ DATABASE_URL: database.url, NODE_ENV: "production" });

      expect(trustedOrigins(development)).toEqual(viteDevOrigins);
      // A production build that trusted localhost would accept a login posted
      // by a page running on the person's own machine.
      expect(trustedOrigins(production)).toEqual([]);
    });

    it("keeps what the environment configured, in both modes", () => {
      const configured = { AUTH_TRUSTED_ORIGINS: "https://app.example, https://admin.example" };

      expect(trustedOrigins(loadEnv({ DATABASE_URL: database.url, ...configured }))).toEqual([
        "https://app.example",
        "https://admin.example",
        ...viteDevOrigins,
      ]);

      expect(
        trustedOrigins(
          loadEnv({ DATABASE_URL: database.url, NODE_ENV: "production", ...configured }),
        ),
      ).toEqual(["https://app.example", "https://admin.example"]);
    });
  });

  /**
   * Signing out is a row the server deletes, not a cookie the browser forgets.
   *
   * The `Origin` header is not decoration here. A signed-in browser carries the
   * cookie on every request, including one another site made it send, so a
   * state-changing endpoint has to know where the request came from. Both
   * halves are asserted: no origin is refused, the wrong origin is refused, and
   * the right one signs the person out for real.
   *
   * This case could not exist for the first few hours of US-017. Better Auth
   * turns the check off when `NODE_ENV` is `test`, so the branch was
   * unreachable and the refusal was a `curl` measurement written in a comment.
   * `advanced.disableOriginCheck: false` in `auth/auth.ts` is what made it
   * testable, and it also stops a deployment losing the check by accident.
   */
  it("invalidates the session on the server when a person signs out", async () => {
    await clear();
    const app = await server();

    try {
      const created = await signUp(app);
      const cookie = jarOf(created.headers["set-cookie"]);

      const noOrigin = await app.inject({
        method: "POST",
        url: `${authBasePath}/sign-out`,
        headers: { cookie },
      });
      expect(noOrigin.statusCode).toBe(403);
      expect(noOrigin.json().code).toBe("MISSING_OR_NULL_ORIGIN");

      const wrongOrigin = await app.inject({
        method: "POST",
        url: `${authBasePath}/sign-out`,
        headers: { cookie, origin: "http://elsewhere.example" },
      });
      expect(wrongOrigin.statusCode).toBe(403);

      // Still signed in: neither refusal ended the session.
      const between = await app.inject({
        method: "GET",
        url: "/api/monitors",
        headers: { cookie },
      });
      expect(between.statusCode).toBe(200);

      const out = await app.inject({
        method: "POST",
        url: `${authBasePath}/sign-out`,
        headers: { cookie, origin: "http://localhost" },
      });
      expect(out.statusCode).toBe(200);

      // The same cookie, sent again. A browser that kept it must not get in:
      // signing out has to be a row the server deleted, not a thing the
      // browser agreed to forget.
      const after = await app.inject({
        method: "GET",
        url: "/api/monitors",
        headers: { cookie },
      });

      expect(after.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("gives the first account the rows that existed before it", async () => {
    await clear();

    const [project] = await db
      .insert(projects)
      .values({
        userId: unclaimedUserId,
        name: "Older than the login",
        product: "A test runner",
        idealCustomer: "QA leads",
        problem: "Flaky tests",
      })
      .returning({ id: projects.id });

    await db.insert(replyPrompts).values({
      userId: unclaimedUserId,
      name: "Older voice",
      instruction: "Answer briefly.",
    });

    // A provider chosen before the login existed. BUG-010's migration leaves it
    // under `self-hosted`, and unlike the rows above nobody would see it go
    // missing: the poll reads the owner's choice, so an unclaimed row is an
    // instance holding two Reddit keys that refuses every Reddit collection.
    await db
      .insert(sourceProviders)
      .values({ userId: unclaimedUserId, source: "reddit", provider: "scrapecreators" });

    const app = await server();

    try {
      const created = await signUp(app);
      expect(created.statusCode).toBe(200);

      const [owner] = await db.select({ id: users.id }).from(users);
      const owned = await db.select({ id: projects.id, userId: projects.userId }).from(projects);

      expect(owned).toEqual([{ id: project?.id, userId: owner?.id }]);

      const voices = await db
        .select({ name: replyPrompts.name, userId: replyPrompts.userId })
        .from(replyPrompts);

      // The claimed voice, and the shipped ones beside it. Every row belongs
      // to the new account, and the person's own words are still there.
      expect(voices).toContainEqual({ name: "Older voice", userId: owner?.id });
      expect(voices).toHaveLength(1 + replyVoicePresets.length);

      // And the screens show them, which is the thing a person would notice.
      const cookie = jarOf(created.headers["set-cookie"]);
      const listed = await app.inject({
        method: "GET",
        url: "/api/projects",
        headers: { cookie },
      });

      expect(listed.statusCode).toBe(200);
      expect(listed.json().projects).toHaveLength(1);

      expect(await readProviderChoices(db, owner?.id ?? "")).toEqual({
        reddit: "scrapecreators",
      });
    } finally {
      await db.delete(sourceProviders);
      await app.close();
    }
  });

  /**
   * The library starts full. US-065's presets, saved rather than offered.
   *
   * Asserted here rather than on the screen, because the hook is what every
   * path that creates a user passes through — and a preset a person never
   * receives is a blank box, which is the screen this was written to answer.
   */
  it("gives a new account the shipped reply voices", async () => {
    await clear();
    const app = await server();

    try {
      expect((await signUp(app)).statusCode).toBe(200);

      const [owner] = await db.select({ id: users.id }).from(users);
      const rows = await db
        .select({
          userId: replyPrompts.userId,
          name: replyPrompts.name,
          instruction: replyPrompts.instruction,
        })
        .from(replyPrompts);
      const voices = rows
        .filter((row) => row.userId === owner?.id)
        .map(({ name, instruction }) => ({ name, instruction }));

      expect(voices.map((voice) => voice.name).sort()).toEqual(
        replyVoicePresets.map((preset) => preset.name).sort(),
      );
      // The words are the module's own, not a paraphrase of them.
      for (const preset of replyVoicePresets) {
        expect(voices).toContainEqual({ name: preset.name, instruction: preset.instruction });
      }
    } finally {
      await app.close();
    }
  });

  /**
   * The rows belong to an account, not to the instance.
   *
   * US-017 ships one account, so nothing a person can do today reaches this.
   * It is asserted anyway, because "a second user is a data change and not a
   * rewrite" is only true if the reads are already scoped — and the day a
   * second account exists is a bad day to find out they are not.
   */
  describe("what one account can see of another's", () => {
    /** A monitor owned by whoever is named, written straight into the table. */
    async function monitorFor(userId: string, name: string): Promise<string> {
      const [row] = await db
        .insert(monitors)
        .values({
          userId,
          name,
          product: "A test runner",
          idealCustomer: "QA leads",
          problem: "Flaky tests",
          sources: ["reddit"],
        })
        .returning({ id: monitors.id });

      if (!row) throw new Error("The monitor was not inserted.");
      return row.id;
    }

    async function serverAs(userId: string): Promise<ApiServer> {
      const env = loadEnv({ DATABASE_URL: database.url, AUTH_SECRET: secret });
      return buildServer({ session: asUser(userId), env, logger, db, queryGenerator: null });
    }

    it("lists only the monitors the person asking owns", async () => {
      await clear();
      const mine = await monitorFor("first-account", "Mine");
      const theirs = await monitorFor("second-account", "Theirs");

      const app = await serverAs("first-account");

      try {
        const listed = await app.inject({ method: "GET", url: "/api/monitors" });

        expect(listed.statusCode).toBe(200);
        expect(listed.json().map((row: { id: string }) => row.id)).toEqual([mine]);

        // And the other one is not merely absent from the list: asking for it
        // by id is a 404, the same answer an id that does not exist gets.
        const direct = await app.inject({ method: "GET", url: `/api/monitors/${theirs}` });
        expect(direct.statusCode).toBe(404);
      } finally {
        await app.close();
      }
    });

    it("refuses to pause, edit or delete a monitor somebody else owns", async () => {
      await clear();
      const theirs = await monitorFor("second-account", "Theirs");
      const app = await serverAs("first-account");

      try {
        for (const [method, url] of [
          ["POST", `/api/monitors/${theirs}/pause`],
          ["POST", `/api/monitors/${theirs}/resume`],
          ["DELETE", `/api/monitors/${theirs}`],
        ] as const) {
          const response = await app.inject({
            method,
            url,
            ...(method === "POST" ? { payload: {} } : {}),
          });

          expect({ url, status: response.statusCode }).toEqual({ url, status: 404 });
        }

        const edited = await app.inject({
          method: "PATCH",
          url: `/api/monitors/${theirs}`,
          payload: { name: "Taken over" },
        });
        expect(edited.statusCode).toBe(404);

        // Nothing was written on the way to any of those refusals.
        const [after] = await db.select({ name: monitors.name }).from(monitors);
        expect(after?.name).toBe("Theirs");
      } finally {
        await app.close();
      }
    });

    /** One match on that monitor, with the post it is about. */
    async function matchOn(monitorId: string): Promise<string> {
      const [post] = await db
        .insert(posts)
        .values({
          source: "reddit",
          externalId: `t3_${randomUUID()}`,
          url: "https://reddit.com/r/softwaretesting/comments/1",
          author: "someone",
          channel: "softwaretesting",
          title: "Our end-to-end suite fails at random",
          excerpt: "Different tests fail on every run and nobody trusts it.",
          postedAt: new Date(),
        })
        .returning({ id: posts.id });

      const [row] = await db
        .insert(matches)
        .values({
          monitorId,
          postId: post?.id ?? "",
          score: 71,
          relevance: 90,
          problemFit: 98,
          icpFit: 91,
          intent: 94,
          urgency: 70,
          intentType: "problem",
          reasons: ["A QA lead with no automation"],
        })
        .returning({ id: matches.id });

      if (!row) throw new Error("The match was not inserted.");
      return row.id;
    }

    it("refuses a verdict on a match in somebody else's inbox", async () => {
      await clear();
      const theirs = await monitorFor("second-account", "Theirs");
      const match = await matchOn(theirs);

      const app = await serverAs("first-account");

      try {
        // The id is known here, which is the case the check exists for: an
        // inbox that shows nothing is not the same as a route that refuses.
        const judged = await app.inject({
          method: "POST",
          url: `/api/matches/${match}/verdict`,
          payload: { verdict: "good" },
        });

        expect(judged.statusCode).toBe(404);
        expect(await db.select().from(feedback)).toHaveLength(0);

        const kept = await app.inject({
          method: "POST",
          url: `/api/matches/${match}/saved`,
          payload: { saved: true },
        });

        expect(kept.statusCode).toBe(404);
        const [after] = await db.select({ savedAt: matches.savedAt }).from(matches);
        expect(after?.savedAt).toBeNull();
      } finally {
        await app.close();
      }
    });

    it("keeps one account's inbox out of another's", async () => {
      await clear();
      await monitorFor("second-account", "Theirs");

      const app = await serverAs("first-account");

      try {
        const inbox = await app.inject({ method: "GET", url: "/api/matches" });

        expect(inbox.statusCode).toBe(200);
        expect(inbox.json().matches).toEqual([]);
      } finally {
        await app.close();
      }
    });
  });
});
