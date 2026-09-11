/**
 * The pure halves of `pnpm preview`.
 *
 * The script spawns four processes and cannot be asserted here, but three of
 * its decisions can, and each of the three was a live failure before it was a
 * function: a password compared wrongly, a request sent to the wrong server,
 * and a header Vite refuses. The fourth is reading someone else's log format,
 * which is the part most likely to break without warning. US-118.
 */
import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { makePassword, portsInUse, tunnelUrlFrom } from "./preview.mjs";
import { authorised, headersFor, routeFor } from "./preview-proxy.mjs";

/** The header a browser sends once the person has typed the password. */
function basic(user, password) {
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

describe("authorised", () => {
  it("accepts the password", () => {
    expect(authorised(basic("preview", "s3cret"), "preview:s3cret")).toBe(true);
  });

  it("refuses a wrong password of the same length", () => {
    expect(authorised(basic("preview", "s3cres"), "preview:s3cret")).toBe(false);
  });

  it("refuses a wrong password of a different length", () => {
    expect(authorised(basic("preview", "s3"), "preview:s3cret")).toBe(false);
  });

  it("refuses a right password under a wrong user", () => {
    expect(authorised(basic("someone", "s3cret"), "preview:s3cret")).toBe(false);
  });

  it("refuses a request with no header at all", () => {
    expect(authorised(undefined, "preview:s3cret")).toBe(false);
  });

  it("refuses a scheme that is not Basic", () => {
    expect(authorised("Bearer s3cret", "preview:s3cret")).toBe(false);
  });
});

describe("routeFor", () => {
  it("sends the API to the API", () => {
    expect(routeFor("/api/auth-status")).toBe("api");
    expect(routeFor("/api/auth/sign-in/email")).toBe("api");
  });

  it("sends the app to Vite", () => {
    expect(routeFor("/")).toBe("vite");
    expect(routeFor("/projects/7/monitors")).toBe("vite");
    expect(routeFor("/@vite/client")).toBe("vite");
  });

  /**
   * The trailing slash is the whole point. Without it a screen route that
   * merely starts with the letters would be answered by the API, which would
   * return 404 for a page that exists.
   */
  it("does not claim a path that only starts with the same letters", () => {
    expect(routeFor("/api-keys")).toBe("vite");
  });
});

describe("headersFor", () => {
  const incoming = {
    host: "adequate-married-floral-mai.trycloudflare.com",
    origin: "https://adequate-married-floral-mai.trycloudflare.com",
    authorization: basic("preview", "s3cret"),
    cookie: "session=abc",
  };

  it("tells Vite a host it allows", () => {
    const sent = headersFor(incoming, { target: "vite", vitePort: 5174 });

    expect(sent.host).toBe("localhost:5174");
    expect(sent.origin).toBe("http://localhost:5174");
  });

  it("leaves the host alone for the API, which does not check it", () => {
    const sent = headersFor(incoming, { target: "api", vitePort: 5174 });

    expect(sent.host).toBe("adequate-married-floral-mai.trycloudflare.com");
    expect(sent.origin).toBe("https://adequate-married-floral-mai.trycloudflare.com");
  });

  it("invents no origin where the request had none", () => {
    const sent = headersFor({ host: "x" }, { target: "vite", vitePort: 5174 });

    expect(sent.origin).toBeUndefined();
  });

  /** The site password is this proxy's business and no further. */
  it("does not pass the site password upstream", () => {
    expect(headersFor(incoming, { target: "api", vitePort: 5174 }).authorization).toBeUndefined();
  });

  it("keeps the cookie, which is how the app knows who is signed in", () => {
    expect(headersFor(incoming, { target: "api", vitePort: 5174 }).cookie).toBe("session=abc");
  });

  it("says https, because that is what the browser used", () => {
    expect(headersFor(incoming, { target: "vite", vitePort: 5174 })["x-forwarded-proto"]).toBe(
      "https",
    );
  });
});

describe("tunnelUrlFrom", () => {
  /** Captured from cloudflared 2026.9.0 on 2026-09-11, trimmed to three lines. */
  const log = [
    "2026-09-11T07:19:11Z INF Requesting new quick Tunnel on trycloudflare.com...",
    "2026-09-11T07:19:17Z INF |  Your quick Tunnel has been created! Visit it at:  |",
    "2026-09-11T07:19:17Z INF |  https://adequate-married-floral-mai.trycloudflare.com   |",
  ].join("\n");

  it("finds the address", () => {
    expect(tunnelUrlFrom(log)).toBe("https://adequate-married-floral-mai.trycloudflare.com");
  });

  it("answers null while the tunnel is still opening", () => {
    expect(tunnelUrlFrom(log.split("\n")[0])).toBe(null);
  });
});

describe("makePassword", () => {
  it("is long enough to be worth typing once", () => {
    expect(makePassword()).toHaveLength(14);
  });

  /**
   * A password is read off one screen and typed into another, often a phone.
   * Slashes and plus signs are the characters that go wrong there, and in a
   * shell.
   */
  it("holds only characters that survive being retyped", () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      expect(makePassword()).toMatch(/^[A-Za-z0-9]{14}$/);
    }
  });

  it("is different every time", () => {
    expect(new Set([makePassword(), makePassword(), makePassword()]).size).toBe(3);
  });
});

describe("portsInUse", () => {
  /** Hold a port the way a preview left running holds one. */
  function hold() {
    return new Promise((resolve) => {
      const server = createServer();
      server.listen(0, "127.0.0.1", () =>
        resolve({
          port: server.address().port,
          release: () => new Promise((done) => server.close(done)),
        }),
      );
    });
  }

  it("names the port something else holds", async () => {
    const taken = await hold();

    expect(await portsInUse([taken.port])).toEqual([taken.port]);

    await taken.release();
  });

  it("says nothing about a free port", async () => {
    const taken = await hold();
    const port = taken.port;
    await taken.release();

    expect(await portsInUse([port])).toEqual([]);
  });

  /**
   * All three, not the first one only. A person who has to free one port, run,
   * and read the next complaint has been told the truth three times slowly.
   */
  it("names every busy port in one answer", async () => {
    const first = await hold();
    const second = await hold();
    const free = await hold();
    const freePort = free.port;
    await free.release();

    expect(await portsInUse([first.port, freePort, second.port])).toEqual([
      first.port,
      second.port,
    ]);

    await first.release();
    await second.release();
  });
});
