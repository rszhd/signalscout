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
  createDatabase,
  createLogger,
  type Database,
  feedback,
  loadEnv,
  matches,
  monitors,
  posts,
  projects,
  replyPrompts,
  unclaimedUserId,
  users,
} from "@intentwatch/core";
import { createTestDatabase, type TestDatabase } from "@intentwatch/core/testing";
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

  it("keeps the login and the health check open, and nothing else", async () => {
    expect(openApiPaths).toEqual(["/api/health", "/api/auth-status"]);
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
        });

        await signUp(open);

        // The first run is over and registration is still offered. Those are
        // two different questions, which is why the route answers both.
        expect((await open.inject({ method: "GET", url: "/api/auth-status" })).json()).toEqual({
          firstRun: false,
          signUpOpen: true,
          signedIn: false,
          account: null,
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

      expect(voices).toEqual([{ name: "Older voice", userId: owner?.id }]);

      // And the screens show them, which is the thing a person would notice.
      const cookie = jarOf(created.headers["set-cookie"]);
      const listed = await app.inject({
        method: "GET",
        url: "/api/projects",
        headers: { cookie },
      });

      expect(listed.statusCode).toBe(200);
      expect(listed.json().projects).toHaveLength(1);
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
